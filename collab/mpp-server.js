import { Mppx, tempo } from "mppx/server";

// pathUSD on Tempo Moderato testnet (hackathon default — free faucet, no setup)
const DEFAULT_CURRENCY = "0x20c0000000000000000000000000000000000000";

const CURRENCY = process.env.MPP_CURRENCY || DEFAULT_CURRENCY;
const RECIPIENT = process.env.MPP_RECIPIENT;
const IS_TESTNET = process.env.MPP_TESTNET !== "false";

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
