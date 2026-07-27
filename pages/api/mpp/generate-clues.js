/**
 * The first-generation MPP endpoint is retired. Its client/server packages are
 * intentionally isolated from the browser while the compatible MPP × Intents
 * adapter is introduced behind the v2 service interface.
 */
export default function handler(req, res) {
  res.setHeader("Allow", "POST");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(410).json({
    error: "Legacy MPP clue generation has moved to the x402 v2 AI service.",
    code: "LEGACY_MPP_RETIRED",
    replacement: "/api/v2/ai/generate",
  });
}
