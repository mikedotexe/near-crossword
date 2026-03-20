export default function handler(req, res) {
  const enabled = Boolean(process.env.MPP_RECIPIENT);
  const isTestnet = process.env.MPP_TESTNET !== "false";
  const hasNearCreds =
    process.env.NEAR_PRIVATE_KEY &&
    process.env.NEAR_PRIVATE_KEY !== "ed25519:your-private-key-here";

  return res.status(200).json({
    enabled,
    currency: process.env.MPP_CURRENCY || "0x20c0000000000000000000000000000000000000",
    currencySymbol: "USD",
    network: isTestnet ? "moderato" : "tempo",
    explorer: isTestnet
      ? "https://explore.moderato.tempo.xyz"
      : "https://explore.tempo.xyz",
    puzzlePrice: "1.00",
    aiGenerationPrice: "0.10",
    demoMode: !hasNearCreds,
    nearNetwork: process.env.NEAR_NETWORK || "testnet",
  });
}
