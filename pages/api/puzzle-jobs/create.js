import { getSession } from "../../../src/lib/auth-helpers";
import { getPool } from "../../../src/lib/dbPool";

const YT_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/(watch|embed)|youtu\.be\/)/i;
const MAX_BASE64_SIZE = 25 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSession(req, res);
  if (!session) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { inputMode, pdfBase64, youtubeUrl, pastedText, tone, objective } = req.body;

  if (!["pdf", "youtube", "text"].includes(inputMode)) {
    return res.status(400).json({ error: "Invalid inputMode. Must be pdf, youtube, or text." });
  }

  if (inputMode === "pdf") {
    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      return res.status(400).json({ error: "pdfBase64 is required for PDF mode." });
    }
    if (pdfBase64.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: "PDF is too large. Maximum size is ~18MB." });
    }
  } else if (inputMode === "youtube") {
    if (!youtubeUrl || !YT_URL_RE.test(youtubeUrl)) {
      return res.status(400).json({ error: "A valid YouTube URL is required." });
    }
  } else if (inputMode === "text") {
    if (!pastedText || typeof pastedText !== "string" || pastedText.trim().length < 50) {
      return res.status(400).json({ error: "Pasted text must be at least 50 characters." });
    }
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO puzzle_jobs (user_id, user_email, input_mode, pdf_base64, youtube_url, pasted_text, tone, objective)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, status, created_at`,
    [
      session.user.id,
      session.user.email,
      inputMode,
      inputMode === "pdf" ? pdfBase64 : null,
      inputMode === "youtube" ? youtubeUrl.trim() : null,
      inputMode === "text" ? pastedText.trim() : null,
      tone || "Educational",
      objective || null,
    ]
  );

  return res.status(201).json({ job: rows[0] });
}

export const config = {
  api: { bodyParser: { sizeLimit: "25mb" } },
};
