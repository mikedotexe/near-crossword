import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";
import { getSubtitles } from "youtube-caption-extractor";
import config from "./config.js";
import { sendJobCompleted } from "./emailService.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const ALLOWED_ANSWER = /^[a-zA-Z0-9.-]?[a-zA-Z0-9_.-]*$/;
const MIN_CHAR_LENGTH = 3;
const MIN_PAIRS = 3;
const MAX_RETRIES = 2;

function validatePairs(pairs: any[]): any[] {
  return pairs.filter(
    (p: any) =>
      p.clue &&
      p.answer &&
      p.clue.length >= MIN_CHAR_LENGTH &&
      p.answer.length >= MIN_CHAR_LENGTH &&
      ALLOWED_ANSWER.test(p.answer)
  );
}

function extractVideoId(url: string): string | null {
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

function buildPrompt(sourceLabel: string, toneText: string, objectiveLine: string): string {
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

async function processJob(job: any): Promise<void> {
  const toneText = job.tone || "educational";
  const objectiveLine = job.objective ? `Focus clues around: ${job.objective}` : "";

  let messageContent: any[];

  if (job.input_mode === "pdf") {
    const prompt = buildPrompt("attached PDF", toneText, objectiveLine);
    messageContent = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: job.pdf_base64 },
      },
      { type: "text", text: prompt },
    ];
  } else if (job.input_mode === "text") {
    const prompt = buildPrompt("following text", toneText, objectiveLine);
    messageContent = [
      { type: "text", text: `${job.pasted_text}\n\n${prompt}` },
    ];
  } else {
    // youtube
    const videoId = extractVideoId(job.youtube_url);
    if (!videoId) throw new Error("Invalid YouTube URL");

    const subtitles = await getSubtitles({ videoID: videoId, lang: "en" });
    if (!subtitles || subtitles.length === 0) {
      throw new Error("No English transcript available for this video.");
    }

    const transcript = subtitles.map((s: any) => s.text).join(" ");
    const prompt = buildPrompt("following video transcript", toneText, objectiveLine);
    messageContent = [
      { type: "text", text: `Video transcript:\n\n${transcript}\n\n${prompt}` },
    ];
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: messageContent }],
  });

  const text = response.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
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

  const variations = parsed.variations.map((v: any) => ({
    label: v.label,
    description: v.description,
    pairs: validatePairs(v.pairs),
  }));

  for (const v of variations) {
    if (v.pairs.length < MIN_PAIRS) {
      throw new Error(`Variation ${v.label} has only ${v.pairs.length} valid pairs (minimum ${MIN_PAIRS})`);
    }
  }

  // Success — store results
  await pool.query(
    `UPDATE puzzle_jobs
     SET status = 'completed', variations_json = $1, completed_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(variations), job.id]
  );

  // Send notification email
  await sendJobCompleted(job.user_email, job.id);
  console.log(`[async-jobs] Job ${job.id} completed, emailed ${job.user_email}`);
}

export async function processAsyncJobs(): Promise<void> {
  const { rows: jobs } = await pool.query(
    `UPDATE puzzle_jobs
     SET status = 'processing'
     WHERE id IN (
       SELECT id FROM puzzle_jobs
       WHERE status = 'pending'
       ORDER BY created_at
       LIMIT 3
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`
  );

  if (jobs.length === 0) return;
  console.log(`[async-jobs] Processing ${jobs.length} pending job(s)`);

  for (const job of jobs) {
    try {
      await processJob(job);
    } catch (err: any) {
      console.error(`[async-jobs] Job ${job.id} failed:`, err.message);
      const newRetry = (job.retry_count || 0) + 1;
      if (newRetry > MAX_RETRIES) {
        await pool.query(
          `UPDATE puzzle_jobs SET status = 'failed', error_message = $1, retry_count = $2 WHERE id = $3`,
          [err.message, newRetry, job.id]
        );
      } else {
        await pool.query(
          `UPDATE puzzle_jobs SET status = 'pending', retry_count = $1 WHERE id = $2`,
          [newRetry, job.id]
        );
      }
    }
  }
}
