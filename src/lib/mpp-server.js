import { Mppx, tempo } from "mppx/server";

// USDC on Tempo mainnet (chain 4217)
const DEFAULT_CURRENCY = "0x20c000000000000000000000b9537d11c60e8b50";

const CURRENCY = process.env.MPP_CURRENCY || DEFAULT_CURRENCY;
const RECIPIENT = process.env.MPP_RECIPIENT;
const IS_TESTNET = process.env.MPP_TESTNET === "true";

let mppInstance = null;

export function getMpp() {
  if (mppInstance) return mppInstance;

  if (!RECIPIENT) {
    throw new Error(
      "MPP_RECIPIENT env var is required (Tempo address to receive payments)"
    );
  }

  mppInstance = Mppx.create({
    methods: [
      tempo({
        currency: CURRENCY,
        recipient: RECIPIENT,
        feePayer: true,
        ...(IS_TESTNET ? { testnet: true } : {}),
      }),
    ],
    secretKey: process.env.MPP_SECRET_KEY,
    realm: process.env.MPP_REALM || "crossword.xyz",
  });

  return mppInstance;
}
