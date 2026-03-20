// Machine-readable pricing discovery for MPP-gated endpoints.
// Follows the pattern from mppx proxy's /discover endpoint.

export default function handler(req, res) {
  const isTestnet = process.env.MPP_TESTNET !== "false";
  const currency = process.env.MPP_CURRENCY || "0x20c0000000000000000000000000000000000000";
  const network = isTestnet ? "moderato" : "tempo";

  const accept = req.headers.accept || "";
  const wantsMarkdown = accept.includes("text/markdown");

  if (wantsMarkdown) {
    res.setHeader("Content-Type", "text/markdown");
    return res.status(200).send(`# NEAR Crossword — MPP Payment API

Network: Tempo ${network} (chain ${isTestnet ? 42431 : 4217})
Currency: pathUSD (${currency})

## Endpoints

### POST /api/mpp/create-puzzle — $1.00
Create a crossword puzzle with NEAR token reward.
Payment: HTTP 402 challenge, Tempo charge intent.

Body: \`{"clueAnswers": [{"clue": "...", "answer": "..."}], "rewardNear": "5"}\`
- Minimum 3 clue/answer pairs
- Reward minimum 5 NEAR

### POST /api/mpp/generate-clues — $0.10
AI-generate crossword clues from content (YouTube, PDF, or text).
Payment: HTTP 402 challenge, Tempo charge intent.

Body (one of):
- \`{"youtubeUrl": "https://youtube.com/watch?v=..."}\`
- \`{"pdfBase64": "..."}\`
- \`{"pastedText": "..."}\` (min 50 chars)

### GET /api/mpp/status — free
Check MPP configuration, pricing, and network info.

### GET /api/mpp/discover — free (this endpoint)
Machine-readable API pricing. Accept: application/json or text/markdown.
`);
  }

  return res.status(200).json({
    name: "NEAR Crossword",
    description: "Crossword puzzles with real crypto rewards, powered by Tempo MPP",
    network,
    chainId: isTestnet ? 42431 : 4217,
    currency,
    currencySymbol: "USD",
    endpoints: [
      {
        method: "POST",
        path: "/api/mpp/create-puzzle",
        description: "Create a crossword puzzle with NEAR token reward",
        price: "1.00",
        intent: "charge",
      },
      {
        method: "POST",
        path: "/api/mpp/generate-clues",
        description: "AI-generate crossword clues from content",
        price: "0.10",
        intent: "charge",
      },
      {
        method: "GET",
        path: "/api/mpp/status",
        description: "MPP configuration and pricing",
        price: null,
      },
    ],
  });
}
