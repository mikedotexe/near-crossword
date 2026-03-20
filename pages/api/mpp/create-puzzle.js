import { Mppx } from "mppx/server";
import { getMpp } from "../../../src/lib/mpp-server";
import { connect, keyStores, KeyPair, utils } from "near-api-js";
import { parseSeedPhrase } from "near-seed-phrase";
import { generateLayout } from "crossword-layout-generator";

// Price in USD to create a puzzle via MPP
const PUZZLE_CREATION_PRICE_USD = "1.00";

let nearConnection = null;

async function getNearConnection() {
  if (nearConnection) return nearConnection;

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(process.env.NEAR_PRIVATE_KEY);
  await keyStore.setKey(
    process.env.NEAR_NETWORK || "testnet",
    process.env.NEAR_ACCOUNT_ID,
    keyPair
  );

  nearConnection = await connect({
    networkId: process.env.NEAR_NETWORK || "testnet",
    nodeUrl:
      process.env.NEAR_NETWORK === "mainnet"
        ? "https://rpc.mainnet.near.org"
        : "https://rpc.testnet.near.org",
    keyStore,
  });

  return nearConnection;
}

// Must match generateNewPuzzleSeedPhrase in src/utils.js:
// iterate by clue number, across before down for each number.
function generateSeedPhrase(layoutResult) {
  // Build across/down maps keyed by position number
  const across = {};
  const down = {};
  let maxNum = 0;
  for (const item of layoutResult) {
    if (!item.position) continue;
    const num = item.position;
    if (num > maxNum) maxNum = num;
    if (item.orientation === "across") {
      across[num] = item.answer;
    } else {
      down[num] = item.answer;
    }
  }

  const words = [];
  for (let i = 1; i <= maxNum; i++) {
    if (across[i]) words.push(across[i]);
    if (down[i]) words.push(down[i]);
  }

  return words.map((w) => w.toLowerCase()).join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { clueAnswers, rewardNear } = req.body || {};

  if (
    !clueAnswers ||
    !Array.isArray(clueAnswers) ||
    clueAnswers.length < 3
  ) {
    return res
      .status(400)
      .json({ error: "At least 3 clue/answer pairs required" });
  }

  if (!rewardNear || Number(rewardNear) < 5) {
    return res
      .status(400)
      .json({ error: "Reward must be at least 5 NEAR" });
  }

  // Generate layout before charging — validates clues and produces the
  // positional data needed for seed phrase derivation and contract args.
  let layout;
  try {
    layout = generateLayout(clueAnswers);
  } catch (err) {
    return res
      .status(400)
      .json({ error: "Could not generate a crossword layout from these clues. Try different answers." });
  }

  if (!process.env.MPP_RECIPIENT) {
    return res
      .status(503)
      .json({ error: "MPP payments not configured on this server" });
  }

  // MPP payment verification via toNodeListener
  // On 402: writes challenge response and ends connection
  // On 200: sets Payment-Receipt header, we write the response body
  const mpp = getMpp();
  const paymentHandler = mpp.charge({
    amount: PUZZLE_CREATION_PRICE_USD,
    description: `Create crossword puzzle with ${rewardNear} NEAR reward`,
  });

  const nodeHandler = Mppx.toNodeListener(paymentHandler);
  const result = await nodeHandler(req, res);

  if (result.status === 402) return;

  // Payment verified — create the puzzle on NEAR
  // If NEAR credentials are not configured, return success with demo flag
  if (
    !process.env.NEAR_PRIVATE_KEY ||
    process.env.NEAR_PRIVATE_KEY === "ed25519:your-private-key-here"
  ) {
    return res.status(200).json({
      success: true,
      txHash: null,
      message: `MPP payment verified! Puzzle would be created on NEAR when server credentials are configured.`,
      paymentMethod: "tempo",
      demo: true,
    });
  }

  try {
    const near = await getNearConnection();
    const account = await near.account(process.env.NEAR_ACCOUNT_ID);

    // Reuse layout generated before payment (same positional data)
    const answers = [];
    layout.result.forEach((value) => {
      if (value.position) {
        answers.push({
          num: value.position,
          start: { x: value.startx, y: value.starty },
          direction: value.orientation === "down" ? "Down" : "Across",
          length: value.answer.length,
          clue: value.clue,
        });
      }
    });

    const dimensions = { x: layout.cols, y: layout.rows };
    const seedPhrase = generateSeedPhrase(layout.result);
    const { publicKey: answerPk } = parseSeedPhrase(seedPhrase);
    const depositYocto = utils.format.parseNearAmount(rewardNear);

    const txResult = await account.functionCall({
      contractId: process.env.NEAR_ACCOUNT_ID,
      methodName: "new_puzzle",
      args: {
        answer_pk: answerPk,
        dimensions,
        answers,
      },
      gas: "300000000000000",
      attachedDeposit: depositYocto,
    });

    const txHash = txResult.transaction.hash;

    return res.status(200).json({
      success: true,
      txHash,
      message: `Puzzle created on NEAR! Funded with ${rewardNear} NEAR via MPP payment.`,
      paymentMethod: "tempo",
    });
  } catch (err) {
    console.error("Failed to create puzzle on NEAR:", err);
    return res.status(500).json({
      error: "Payment received but puzzle creation failed. Contact support.",
      details: err.message,
    });
  }
}
