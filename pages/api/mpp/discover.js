export default function handler(req, res) {
  const payload = {
    name: "Crossword Campaigns",
    description: "Fund with anything. Win anywhere.",
    legacyMppEndpointsRetired: true,
    replacements: {
      campaigns: "/api/v2/campaigns",
      aiGeneration: "/api/v2/ai/generate",
    },
  };

  if ((req.headers.accept || "").includes("text/markdown")) {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    return res.status(200).send(`# Crossword Campaigns

The legacy MPP endpoints are retired. Campaign prize principal is never funded
from the operator treasury.

- Campaign API: \`/api/v2/campaigns\`
- x402 AI API: \`/api/v2/ai/generate\`
`);
  }

  return res.status(200).json(payload);
}
