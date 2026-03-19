export default function handler(req, res) {
  const enabled = Boolean(process.env.MPP_RECIPIENT);

  return res.status(200).json({
    enabled,
    currency: process.env.MPP_CURRENCY || "0x20c000000000000000000000b9537d11c60e8b50",
    currencySymbol: "USDC",
    network: process.env.MPP_TESTNET === "true" ? "moderato" : "tempo",
    puzzlePrice: "1.00",
    aiGenerationPrice: "0.10",
  });
}
