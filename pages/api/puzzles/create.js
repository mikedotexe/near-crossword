export default function handler(req, res) {
  res.setHeader("Allow", "POST");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(410).json({
    error: "The unauthenticated legacy catalog write endpoint is retired.",
    code: "LEGACY_CATALOG_WRITE_RETIRED",
    replacement: "/api/v2/campaigns",
  });
}
