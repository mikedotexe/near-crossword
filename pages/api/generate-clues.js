export default function handler(req, res) {
  res.setHeader("Allow", "POST");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(410).json({
    error: "Unauthenticated legacy generation has been retired.",
    code: "LEGACY_AI_RETIRED",
    replacement: "/api/v2/ai/generate",
  });
}
