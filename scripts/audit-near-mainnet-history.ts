import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import dotenv from "dotenv";

const transactionApi = "https://tx.main.fastnear.com";
const rpcApi = "https://rpc.mainnet.fastnear.com";
const defaultAccounts = ["crossword.puzzle.near", "shitzu.crossword.puzzle.near"];

interface ChainOutcome {
  block_height?: number;
  block_timestamp?: number | string;
  outcome?: {
    logs?: string[];
    status?: Record<string, unknown>;
  };
}

interface ReceiptAction {
  FunctionCall?: {
    method_name?: string;
    deposit?: string;
  };
  Transfer?: {
    deposit?: string;
  };
}

interface ReceiptEntry {
  receipt?: {
    receipt_id?: string;
    predecessor_id?: string;
    receiver_id?: string;
    receipt?: {
      Action?: {
        actions?: ReceiptAction[];
      };
    };
  };
  execution_outcome?: ChainOutcome;
}

interface TransactionRecord {
  transaction?: {
    hash?: string;
    execution_outcome?: ChainOutcome;
  };
  receipts?: ReceiptEntry[];
}

interface PuzzleEvent {
  puzzleKey: string;
  transactionHash: string;
  receiptId: string | null;
  blockHeight: number | null;
  timestamp: string | null;
}

interface ClaimEvent extends PuzzleEvent {
  rewardYoctoNear: bigint;
}

function successful(status: Record<string, unknown> | undefined) {
  return Boolean(
    status &&
    !("Failure" in status) &&
    ("SuccessValue" in status || "SuccessReceiptId" in status),
  );
}

function puzzleKey(log: string) {
  const match = log.match(/\[(\d+(?:,\s*\d+)*)\]/);
  return match ? match[1].replace(/\s+/g, "") : null;
}

function rewardAmount(log: string) {
  const match = log.match(/reward claimed:\s*(\d+)/i);
  return match ? BigInt(match[1]) : null;
}

function toIso(timestamp: number | string | undefined) {
  if (timestamp === undefined) return null;
  const numeric = Number(timestamp);
  return Number.isFinite(numeric) ? new Date(numeric / 1e6).toISOString() : null;
}

function yoctoNearToNear(value: bigint) {
  const raw = value.toString().padStart(25, "0");
  const whole = raw.slice(0, -24) || "0";
  const fraction = raw.slice(-24).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function uniqueByPuzzleKey<T extends PuzzleEvent>(events: T[]) {
  return [...new Map(events.map((event) => [event.puzzleKey, event])).values()];
}

function transactionHash(record: TransactionRecord) {
  return record.transaction?.hash || null;
}

async function postJson<T>(url: string, apiKey: string, body: unknown, attempt = 1): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
    return postJson<T>(url, apiKey, body, attempt + 1);
  }
  if (!response.ok) throw new Error(`FastNear request failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function accountTransactionHashes(accountId: string, apiKey: string) {
  const hashes: string[] = [];
  let resumeToken: string | undefined;

  do {
    const response = await postJson<{
      account_txs?: Array<{ transaction_hash?: string }>;
      resume_token?: string;
    }>(`${transactionApi}/v0/account`, apiKey, {
      account_id: accountId,
      desc: false,
      is_function_call: true,
      is_receiver: true,
      limit: 200,
      ...(resumeToken ? { resume_token: resumeToken } : {}),
    });
    hashes.push(...(response.account_txs || []).flatMap((row) => row.transaction_hash || []));
    resumeToken = response.resume_token || undefined;
  } while (resumeToken);

  return [...new Set(hashes)];
}

async function transactionRecords(hashes: string[], apiKey: string) {
  const records = new Map<string, TransactionRecord>();

  for (let index = 0; index < hashes.length; index += 20) {
    const response = await postJson<{
      transactions?: TransactionRecord[];
    } | TransactionRecord[]>(`${transactionApi}/v0/transactions`, apiKey, {
      tx_hashes: hashes.slice(index, index + 20),
    });
    const batch = Array.isArray(response) ? response : response.transactions || [];
    for (const record of batch) {
      const hash = transactionHash(record);
      if (hash) records.set(hash, record);
    }
  }

  return records;
}

function eventsForAccount(accountId: string, records: Map<string, TransactionRecord>) {
  const solves: PuzzleEvent[] = [];
  const claims: ClaimEvent[] = [];

  for (const [hash, record] of records) {
    for (const receipt of record.receipts || []) {
      if (receipt.receipt?.receiver_id !== accountId) continue;
      if (!successful(receipt.execution_outcome?.outcome?.status)) continue;

      const common = {
        transactionHash: hash,
        receiptId: receipt.receipt.receipt_id || null,
        blockHeight: receipt.execution_outcome?.block_height || null,
        timestamp: toIso(receipt.execution_outcome?.block_timestamp),
      };
      for (const log of receipt.execution_outcome?.outcome?.logs || []) {
        const key = puzzleKey(log);
        if (!key) continue;
        if (/Puzzle with pk .* solved, solver pk:/i.test(log)) {
          solves.push({ puzzleKey: key, ...common });
        }
        if (/Puzzle with pk: .* claimed, new account created:/i.test(log)) {
          const rewardYoctoNear = rewardAmount(log);
          if (rewardYoctoNear !== null) claims.push({ puzzleKey: key, rewardYoctoNear, ...common });
        }
      }
    }
  }

  return {
    solveEvents: solves,
    claimEvents: claims,
    solves: uniqueByPuzzleKey(solves),
    claims: uniqueByPuzzleKey(claims),
  };
}

function successfulValueLeavingContract(record: TransactionRecord, accountId: string) {
  let total = 0n;
  for (const receipt of record.receipts || []) {
    if (receipt.receipt?.predecessor_id !== accountId) continue;
    if (receipt.receipt.receiver_id === accountId) continue;
    if (!successful(receipt.execution_outcome?.outcome?.status)) continue;

    for (const action of receipt.receipt.receipt?.Action?.actions || []) {
      if (action.Transfer?.deposit) total += BigInt(action.Transfer.deposit);
      if (action.FunctionCall?.deposit) total += BigInt(action.FunctionCall.deposit);
    }
  }
  return total;
}

async function currentUnsolved(accountId: string, apiKey: string) {
  const response = await postJson<{
    result?: { block_height?: number; result?: number[] };
    error?: unknown;
  }>(rpcApi, apiKey, {
    jsonrpc: "2.0",
    id: "crossword-mainnet-audit",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: accountId,
      method_name: "get_unsolved_puzzles",
      args_base64: "e30=",
    },
  });
  if (response.error || !response.result?.result) throw new Error(`Unable to read ${accountId} state`);
  const decoded = JSON.parse(Buffer.from(response.result.result).toString("utf8")) as {
    puzzles?: unknown[];
  };
  return {
    count: decoded.puzzles?.length || 0,
    finalBlockHeight: response.result.block_height || null,
  };
}

function eventEvidence(events: PuzzleEvent[]) {
  const sorted = [...events].sort((left, right) =>
    (left.timestamp || "").localeCompare(right.timestamp || ""),
  );
  const select = (event: PuzzleEvent | undefined) => event ? {
    timestamp: event.timestamp,
    blockHeight: event.blockHeight,
    transactionHash: event.transactionHash,
    explorerUrl: `https://nearblocks.io/txns/${event.transactionHash}`,
  } : null;
  return { first: select(sorted[0]), last: select(sorted.at(-1)) };
}

async function auditAccount(accountId: string, apiKey: string) {
  const hashes = await accountTransactionHashes(accountId, apiKey);
  const records = await transactionRecords(hashes, apiKey);
  const events = eventsForAccount(accountId, records);
  const solvedKeys = new Set(events.solves.map((event) => event.puzzleKey));
  const claimedKeys = new Set(events.claims.map((event) => event.puzzleKey));
  const claimsWithoutSolve = events.claims.filter((claim) => !solvedKeys.has(claim.puzzleKey));
  const solvedWithoutClaim = events.solves.filter((solve) => !claimedKeys.has(solve.puzzleKey));
  const payoutMismatches = events.claims.filter((claim) => {
    const record = records.get(claim.transactionHash);
    return !record || successfulValueLeavingContract(record, accountId) !== claim.rewardYoctoNear;
  });
  const rewardPaid = events.claims.reduce((total, claim) => total + claim.rewardYoctoNear, 0n);
  const unsolved = await currentUnsolved(accountId, apiKey);

  return {
    accountId,
    accountExplorerUrl: `https://nearblocks.io/address/${accountId}`,
    indexedFunctionCallTransactions: hashes.length,
    retrievedTransactions: records.size,
    successfulSolveEvents: events.solveEvents.length,
    distinctSolvedPuzzles: events.solves.length,
    successfulClaimEvents: events.claimEvents.length,
    distinctPaidPuzzles: events.claims.length,
    rewardPaidNear: yoctoNearToNear(rewardPaid),
    solvedWithoutSuccessfulClaim: solvedWithoutClaim.length,
    currentUnsolvedPuzzles: unsolved.count,
    currentStateFinalBlockHeight: unsolved.finalBlockHeight,
    validation: {
      everySolveKeyIsDistinct: events.solveEvents.length === events.solves.length,
      everyClaimKeyIsDistinct: events.claimEvents.length === events.claims.length,
      everyClaimHasSolve: claimsWithoutSolve.length === 0,
      everyClaimMatchesSuccessfulOutboundValue: payoutMismatches.length === 0,
    },
    evidence: {
      solves: eventEvidence(events.solves),
      claims: eventEvidence(events.claims),
      solvedWithoutClaimTransactionHashes: solvedWithoutClaim.map((event) => event.transactionHash),
    },
    rewardPaidYoctoNear: rewardPaid.toString(),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "env-file": { type: "string" },
      account: { type: "string", multiple: true },
    },
  });
  const fileEnv = values["env-file"] ? dotenv.parse(readFileSync(values["env-file"])) : {};
  const apiKey = (process.env.FASTNEAR_API_KEY || fileEnv.FASTNEAR_API_KEY)?.trim();
  if (!apiKey) throw new Error("FASTNEAR_API_KEY is required");

  const accountIds = values.account?.length ? values.account : defaultAccounts;
  const internalResults = [];
  for (const accountId of accountIds) internalResults.push(await auditAccount(accountId, apiKey));

  const totalRewardPaid = internalResults.reduce(
    (total, result) => total + BigInt(result.rewardPaidYoctoNear),
    0n,
  );
  const accounts = internalResults;
  const validationPassed = accounts.every((account) =>
    Object.values(account.validation).every(Boolean),
  );
  const output = {
    generatedAt: new Date().toISOString(),
    network: "NEAR mainnet",
    methodology: "Distinct puzzle keys in successful solve/finalized-claim receipt logs; payouts cross-checked against successful outbound receipt value.",
    accounts,
    totals: {
      distinctSolvedPuzzles: accounts.reduce((total, account) => total + account.distinctSolvedPuzzles, 0),
      distinctPaidPuzzles: accounts.reduce((total, account) => total + account.distinctPaidPuzzles, 0),
      solvedWithoutSuccessfulClaim: accounts.reduce((total, account) => total + account.solvedWithoutSuccessfulClaim, 0),
      rewardPaidNear: yoctoNearToNear(totalRewardPaid),
      validationPassed,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  if (!validationPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Unknown audit error",
  }));
  process.exitCode = 1;
});
