export default function handler(req, res) {
  const requested = process.env.MPP_INTENTS_ENABLED === "true";
  const isTestnet = process.env.MPP_TESTNET !== "false";

  return res.status(200).json({
    // The compatible SDK line is installed, but this endpoint remains closed
    // until a shared atomic replay store and production route are configured.
    enabled: false,
    requested,
    readiness: requested
      ? "atomic-store-and-route-required"
      : "feature-disabled",
    legacyEndpointsRetired: true,
    adapter: "tempo-mpp-intents",
    currency: process.env.MPP_CURRENCY || "0x20c0000000000000000000000000000000000000",
    currencySymbol: "USD",
    network: isTestnet ? "moderato" : "tempo",
    explorer: isTestnet
      ? "https://explore.moderato.tempo.xyz"
      : "https://explore.tempo.xyz",
    puzzlePrice: null,
    aiGenerationPrice: null,
    demoMode: true,
    nearNetwork:
      process.env.V2_NEAR_NETWORK ||
      process.env.NEXT_PUBLIC_NEAR_NETWORK ||
      "testnet",
    replacement: "/api/v2/campaigns",
  });
}
