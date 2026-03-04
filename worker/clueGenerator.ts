import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";
import type { CluePair, Variation } from "./types.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const ALLOWED_ANSWER = /^[a-zA-Z0-9.-]?[a-zA-Z0-9_.-]*$/;
const MIN_PAIRS = 3;
const MIN_CHAR_LENGTH = 3;

function validatePairs(pairs: CluePair[]): CluePair[] {
  return pairs.filter(
    (p) =>
      p.clue &&
      p.answer &&
      p.clue.length >= MIN_CHAR_LENGTH &&
      p.answer.length >= MIN_CHAR_LENGTH &&
      ALLOWED_ANSWER.test(p.answer)
  );
}

export async function fetchUrlContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "NEAR-Crossword-Agent/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return "";
    const text = await res.text();
    // Trim to 50k chars
    return text.slice(0, 50000);
  } catch {
    return "";
  }
}

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  return [...new Set(text.match(urlRegex) || [])];
}

export async function generateClues(sourceContent: string): Promise<Variation[]> {
  // Fetch any URLs found in the content
  const urls = extractUrls(sourceContent);
  let augmentedContent = sourceContent;

  if (urls.length > 0) {
    const fetched = await Promise.all(
      urls.slice(0, 5).map(async (url) => {
        const content = await fetchUrlContent(url);
        return content ? `\n\n--- Content from ${url} ---\n${content}` : "";
      })
    );
    augmentedContent += fetched.join("");
  }

  // Trim total to 50k
  augmentedContent = augmentedContent.slice(0, 50000);

  const systemPrompt = `You are a crossword puzzle creator. Given source content about a topic, generate crossword clue/answer pairs.

Rules for answers:
- Only letters, digits, hyphens, periods, and underscores allowed
- No spaces in answers
- Each answer must be at least 3 characters
- Answers should be single words or compound terms (no phrases)
- Each clue must be at least 3 characters
- Clues should be engaging and educational

Return ONLY valid JSON with no markdown formatting. The format must be:
{
  "variations": [
    {
      "label": "A",
      "description": "Brief description of this variation's theme/approach",
      "pairs": [
        { "clue": "...", "answer": "..." }
      ]
    },
    {
      "label": "B",
      "description": "Brief description of this variation's theme/approach",
      "pairs": [
        { "clue": "...", "answer": "..." }
      ]
    }
  ]
}

Generate exactly 2 variations:
- Variation A: 7-10 word pairs, broader coverage of the topic
- Variation B: 5-7 word pairs, more focused/curated selection`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Generate crossword clue/answer pairs from this content:\n\n${augmentedContent}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try extracting JSON from markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new Error("Failed to parse AI response as JSON");
    }
  }

  const variations: Variation[] = parsed.variations.map((v: any) => ({
    label: v.label,
    description: v.description,
    pairs: validatePairs(v.pairs),
  }));

  // Ensure both variations have at least MIN_PAIRS
  for (const v of variations) {
    if (v.pairs.length < MIN_PAIRS) {
      throw new Error(
        `Variation ${v.label} has only ${v.pairs.length} valid pairs (minimum ${MIN_PAIRS})`
      );
    }
  }

  return variations;
}

export function formatVariationsMessage(variations: Variation[]): string {
  let msg = "Here are 2 crossword variations generated from your content:\n\n";

  for (const v of variations) {
    msg += `**Variation ${v.label}** (${v.pairs.length} words): ${v.description}\n`;
    for (const p of v.pairs) {
      msg += `  - "${p.clue}" → ${p.answer}\n`;
    }
    msg += "\n";
  }

  msg += "Please reply with:\n";
  msg += "- **A** or **B** to pick a variation\n";
  msg += "- **retry** to generate new variations\n";
  msg += '- Paste edited clue/answer pairs in "clue | answer" format (one per line)\n';
  msg += "- Also tell me: **How much NEAR** should the puzzle reward be? (minimum 5)\n";

  return msg;
}
