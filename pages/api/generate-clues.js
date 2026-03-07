import Anthropic from "@anthropic-ai/sdk";
import { getSubtitles } from "youtube-caption-extractor";

const ALLOWED_ANSWER = /^[a-zA-Z0-9.-]?[a-zA-Z0-9_.-]*$/;
const MIN_CHAR_LENGTH = 3;
const MIN_PAIRS = 3;
const MAX_BASE64_SIZE = 25 * 1024 * 1024;

function validatePairs(pairs) {
  return pairs.filter(
    (p) =>
      p.clue &&
      p.answer &&
      p.clue.length >= MIN_CHAR_LENGTH &&
      p.answer.length >= MIN_CHAR_LENGTH &&
      ALLOWED_ANSWER.test(p.answer)
  );
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1);
    }
    if (parsed.pathname.startsWith("/embed/")) {
      return parsed.pathname.split("/embed/")[1].split(/[/?]/)[0];
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function buildPrompt(sourceLabel, toneText, objectiveLine) {
  return `You are a crossword puzzle creator. Read the ${sourceLabel} and generate crossword clue/answer pairs from its content.

Rules for answers:
- Only letters, digits, hyphens, periods, and underscores allowed
- No spaces in answers
- Each answer must be at least 3 characters
- Answers should be single words or compound terms (no phrases)
- Each clue must be at least 3 characters
- Clues should be engaging and ${toneText}
${objectiveLine}

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

Generate exactly 2 variations, each with exactly 12 pairs.
- Variation A: broader coverage of the content
- Variation B: focused on the most important key concepts`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
  }

  const { pdfBase64, youtubeUrl, pastedText, tone, objective } = req.body;

  const hasPdf = pdfBase64 && typeof pdfBase64 === "string";
  const hasYoutube = youtubeUrl && typeof youtubeUrl === "string";
  const hasText = pastedText && typeof pastedText === "string" && pastedText.trim().length >= 50;

  if (!hasPdf && !hasYoutube && !hasText) {
    return res.status(400).json({ error: "Provide pdfBase64, youtubeUrl, or pastedText." });
  }

  const toneText = tone || "educational";
  const objectiveLine = objective
    ? `Focus clues around: ${objective}`
    : "";

  let messageContent;

  if (hasPdf) {
    if (pdfBase64.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: "PDF is too large. Maximum size is ~18MB." });
    }
    const prompt = buildPrompt("attached PDF", toneText, objectiveLine);
    messageContent = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
      },
      { type: "text", text: prompt },
    ];
  } else if (hasText) {
    const prompt = buildPrompt("following text", toneText, objectiveLine);
    messageContent = [
      { type: "text", text: `${pastedText.trim()}\n\n${prompt}` },
    ];
  } else {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({ error: "Could not extract a video ID from the provided YouTube URL." });
    }

    let subtitles;
    try {
      subtitles = await getSubtitles({ videoID: videoId, lang: "en" });
    } catch (err) {
      return res.status(400).json({ error: `Failed to fetch transcript: ${err.message}` });
    }

    if (!subtitles || subtitles.length === 0) {
      return res.status(400).json({ error: "No English transcript available for this video." });
    }

    const transcript = subtitles.map((s) => s.text).join(" ");
    const prompt = buildPrompt("following video transcript", toneText, objectiveLine);
    messageContent = [
      { type: "text", text: `Video transcript:\n\n${transcript}\n\n${prompt}` },
    ];
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: messageContent }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    if (!parsed.variations || !Array.isArray(parsed.variations)) {
      throw new Error("Response missing variations array");
    }

    const variations = parsed.variations.map((v) => ({
      label: v.label,
      description: v.description,
      pairs: validatePairs(v.pairs),
    }));

    for (const v of variations) {
      if (v.pairs.length < MIN_PAIRS) {
        throw new Error(
          `Variation ${v.label} has only ${v.pairs.length} valid pairs (minimum ${MIN_PAIRS})`
        );
      }
    }

    return res.status(200).json({ variations });
  } catch (error) {
    console.error("generate-clues error:", error);
    return res.status(500).json({
      error: error.message || "Failed to generate clues.",
    });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "25mb" } },
};
