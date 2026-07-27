import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "./errors";
import { objectValue, stringValue } from "./validation";

export interface AiGenerationInput {
  topic: string;
  tone: string;
  count: number;
}

export interface GeneratedClue {
  clue: string;
  answer: string;
}

export interface AiGenerator {
  generate(input: AiGenerationInput): Promise<GeneratedClue[]>;
}

export function parseAiGenerationInput(raw: unknown): AiGenerationInput {
  const body = objectValue(raw);
  const count = body.count ?? 8;
  if (!Number.isInteger(count) || (count as number) < 3 || (count as number) > 12) {
    throw new AppError(400, "INVALID_REQUEST", "count must be an integer from 3 to 12");
  }
  return {
    topic: stringValue(body.topic, "topic", { min: 3, max: 500 })!,
    tone: stringValue(body.tone ?? "clever", "tone", { min: 3, max: 80 })!,
    count: count as number,
  };
}

const allowedAnswer = /^[A-Z0-9_.-]{3,32}$/;

function parseGeneratedClues(raw: string, count: number): GeneratedClue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!fenced) throw new AppError(502, "AI_RESPONSE_INVALID", "AI response was not JSON");
    parsed = JSON.parse(fenced[1]);
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "entries" in parsed
      ? (parsed as { entries: unknown }).entries
      : null;
  if (!Array.isArray(values)) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "AI response is missing entries");
  }
  const entries = values.flatMap((value): GeneratedClue[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.clue !== "string" || typeof item.answer !== "string") return [];
    const answer = item.answer
      .normalize("NFKC")
      .toUpperCase()
      .replace(/[^A-Z0-9_.-]/g, "");
    const clue = item.clue.trim();
    if (!allowedAnswer.test(answer) || clue.length < 3 || clue.length > 300) return [];
    return [{ clue, answer }];
  });
  if (entries.length < count) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "AI returned too few safe clues");
  }
  return entries.slice(0, count);
}

export class AnthropicAiGenerator implements AiGenerator {
  async generate(input: AiGenerationInput): Promise<GeneratedClue[]> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AppError(503, "AI_NOT_CONFIGURED", "AI generation is not configured");
    }
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: process.env.V2_AI_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 2_048,
      messages: [
        {
          role: "user",
          content: `Create exactly ${input.count} crossword clue/answer pairs about the topic below.
Tone: ${input.tone}
Topic: ${input.topic}

Answers must be 3-32 characters, uppercase, contain no spaces, and use only A-Z, 0-9, _, . or -.
Return only JSON: {"entries":[{"clue":"...","answer":"..."}]}`,
        },
      ],
    });
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return parseGeneratedClues(text, input.count);
  }
}

export class DeterministicAiGenerator implements AiGenerator {
  async generate(input: AiGenerationInput): Promise<GeneratedClue[]> {
    const words = input.topic
      .normalize("NFKC")
      .toUpperCase()
      .match(/[A-Z0-9]{3,32}/g) ?? ["PUZZLE", "INTENT", "REWARD"];
    return Array.from({ length: input.count }, (_, index) => {
      const answer = words[index % words.length];
      return {
        answer,
        clue: `${input.tone} clue ${index + 1} about ${input.topic.slice(0, 80)}`,
      };
    });
  }
}
