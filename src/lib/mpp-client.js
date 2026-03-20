import { Mppx, tempo } from "mppx/client";
import { Receipt } from "mppx";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createClient, http } from "viem";
import { tempo as tempoChain, tempoModerato } from "viem/chains";
import { Actions } from "viem/tempo";

const STORAGE_KEY = "mpp_tempo_account";
// Defaults to testnet (Moderato). Only use mainnet when explicitly set to "false".
const IS_TESTNET = process.env.NEXT_PUBLIC_MPP_TESTNET !== "false";
export const TEMPO_EXPLORER = IS_TESTNET
  ? "https://explore.moderato.tempo.xyz"
  : "https://explore.tempo.xyz";
const CURRENCY = IS_TESTNET
  ? "0x20c0000000000000000000000000000000000000"   // pathUSD (testnet)
  : "0x20c000000000000000000000b9537d11c60e8b50";  // USDC (mainnet)

let mppClient = null;
let tempoAccount = null;
let viemClient = null;

function getOrCreateTempoAccount() {
  if (tempoAccount) return tempoAccount;

  // Try to restore from localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      tempoAccount = privateKeyToAccount(stored);
      return tempoAccount;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Generate new account
  const privateKey = generatePrivateKey();
  localStorage.setItem(STORAGE_KEY, privateKey);
  tempoAccount = privateKeyToAccount(privateKey);
  return tempoAccount;
}

function getViemClient() {
  if (viemClient) return viemClient;
  viemClient = createClient({
    chain: IS_TESTNET ? tempoModerato : tempoChain,
    pollingInterval: 1_000,
    transport: http(),
  });
  return viemClient;
}

export function getMppClient() {
  if (mppClient) return mppClient;

  const account = getOrCreateTempoAccount();
  mppClient = Mppx.create({
    methods: [tempo({ account })],
  });

  return mppClient;
}

export function getTempoAddress() {
  const account = getOrCreateTempoAccount();
  return account.address;
}

export async function getTempoBalance() {
  const account = getOrCreateTempoAccount();
  const client = getViemClient();

  try {
    const value = await Actions.token.getBalance(client, {
      account,
      token: CURRENCY,
    });
    return Number(value) / 1e6; // USDC has 6 decimals
  } catch {
    return 0;
  }
}

export async function fundTempoAccount() {
  const account = getOrCreateTempoAccount();
  const client = getViemClient();

  await Actions.faucet.fundSync(client, { account });
  return getTempoBalance();
}

export async function ensureFunded() {
  const balance = await getTempoBalance();
  if (balance > 0) return balance;
  return fundTempoAccount();
}

function extractReceipt(response) {
  try {
    const header = response.headers.get("payment-receipt");
    if (!header) return null;
    return Receipt.deserialize(header);
  } catch {
    return null;
  }
}

export async function createPuzzleWithMpp(clueAnswers, rewardNear) {
  const mpp = getMppClient();

  const res = await mpp.fetch("/api/mpp/create-puzzle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clueAnswers, rewardNear }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `Payment failed (${res.status})`);
  }

  const data = await res.json();
  const receipt = extractReceipt(res);
  return { ...data, receipt };
}

export async function generateCluesWithMpp(body) {
  const mpp = getMppClient();

  const res = await mpp.fetch("/api/mpp/generate-clues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `Payment failed (${res.status})`);
  }

  const data = await res.json();
  const receipt = extractReceipt(res);
  return { ...data, receipt };
}
