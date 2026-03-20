---
name: near-crossword
description: >
  Create and solve on-chain crossword puzzles with NEAR token rewards.
  Use when asked to create educational quizzes, gamified learning campaigns,
  or crypto reward puzzles on NEAR Protocol.
metadata:
  contract: configurable via NEXT_PUBLIC_CONTRACT_NAME
  networks: mainnet, testnet
  rpc_mainnet: https://rpc.mainnet.fastnear.com
  rpc_testnet: https://rpc.testnet.fastnear.com
---

# NEAR Crossword Puzzle Skill

## When to Use This Skill

Use this skill when a user wants to:
- Create a crossword puzzle with a NEAR token reward
- Query unsolved crossword puzzles on-chain
- Solve a crossword puzzle and claim its reward
- Build educational campaigns or gamified quizzes backed by crypto prizes
- Understand the puzzle lifecycle on the NEAR crossword contract

## Overview

NEAR Crossword is a blockchain-based puzzle platform. Creators publish crossword
puzzles to a NEAR smart contract with an attached NEAR deposit as a reward. The
first solver to fill in all answers correctly can claim the reward.

**Puzzle lifecycle:** Created (Unsolved) → Solved → Claimed

**Cryptographic verification:** The crossword answers, ordered by clue number
(across before down when they share a number), lowercased, and joined by spaces,
form a BIP-39 seed phrase. That seed phrase derives an ed25519 keypair. The
public key (`answer_pk`) is stored on-chain. When a solver fills in all answers
correctly and reconstructs the same seed phrase, they can sign a transaction with
the corresponding private key, proving they know the solution without revealing
the answers on-chain.

## Quick Reference

### View Methods (free, no signing)

| Method                 | Parameters | Returns          |
|------------------------|------------|------------------|
| `get_unsolved_puzzles` | none       | `UnsolvedPuzzles`|

### Change Methods (require signing + gas)

| Method                     | Parameters                                              | Deposit        |
|----------------------------|---------------------------------------------------------|----------------|
| `new_puzzle`               | `answer_pk`, `dimensions`, `answers`                    | reward amount  |
| `submit_solution`          | `solver_pk`                                             | 0              |
| `claim_reward`             | `crossword_pk`, `receiver_acc_id`, `memo`               | 0              |
| `claim_reward_new_account` | `crossword_pk`, `new_acc_id`, `new_pk`, `memo`          | 0              |

## Smart Contract Interface

### View Methods

#### `get_unsolved_puzzles`

Returns all unsolved puzzles with their clues, dimensions, reward amount, and
solution public key. No arguments required (pass `{}` / base64 `e30=`).

**Response type:** `UnsolvedPuzzles`

```json
{
  "puzzles": [
    {
      "solution_public_key": "ed25519:ABC123...",
      "status": "Unsolved",
      "reward": "5000000000000000000000000",
      "creator": "alice.testnet",
      "dimensions": { "x": 19, "y": 13 },
      "answer": [
        {
          "num": 1,
          "start": { "x": 0, "y": 2 },
          "direction": "Across",
          "length": 8,
          "clue": "The opposite of far"
        }
      ]
    }
  ],
  "creator_account": "testnet"
}
```

Note: `reward` is in yoctoNEAR (1 NEAR = 10^24 yoctoNEAR).

### Change Methods

#### `new_puzzle`

Creates a new crossword puzzle. Must be called with an attached deposit (the
reward). The caller must sign with a full-access key on their own account.

**Parameters:**

| Field        | Type               | Description                                     |
|--------------|--------------------|-------------------------------------------------|
| `answer_pk`  | `string`           | ed25519 public key derived from the answer seed phrase (e.g. `"ed25519:ABC..."`) |
| `dimensions` | `CoordinatePair`   | Grid size `{ "x": cols, "y": rows }`            |
| `answers`    | `Answer[]`         | Array of clue metadata (no actual answer text)   |

**Important:** The `answers` array sent to the contract must NOT include the
answer text. Strip the `answer` field from each entry before calling.

#### `submit_solution`

Called when a solver knows all answers. The transaction must be signed with the
private key derived from the answer seed phrase (proving knowledge of the
solution). The contract verifies that the signer's public key matches a stored
puzzle's `answer_pk`.

**Parameters:**

| Field       | Type     | Description                              |
|-------------|----------|------------------------------------------|
| `solver_pk` | `string` | The solver's own public key for claiming  |

**Signing:** Must be signed with the answer-derived key, NOT the solver's
regular account key. Use `near-seed-phrase` to parse the seed phrase into a
keypair and sign with that secret key.

#### `claim_reward`

Transfers the reward to an existing NEAR account. Must be signed with the
solver's key (the `solver_pk` from `submit_solution`).

**Parameters:**

| Field             | Type     | Description                     |
|-------------------|----------|---------------------------------|
| `crossword_pk`    | `string` | The puzzle's solution public key|
| `receiver_acc_id` | `string` | Existing NEAR account to pay   |
| `memo`            | `string` | Freeform memo text              |

#### `claim_reward_new_account`

Creates a new NEAR account and transfers the reward to it.

**Parameters:**

| Field          | Type     | Description                           |
|----------------|----------|---------------------------------------|
| `crossword_pk` | `string` | The puzzle's solution public key      |
| `new_acc_id`   | `string` | New account name to create            |
| `new_pk`       | `string` | Public key for the new account        |
| `memo`         | `string` | Freeform memo text                    |

## Data Structures

### `Answer`

```json
{
  "num": 1,
  "start": { "x": 0, "y": 2 },
  "direction": "Across",
  "length": 8,
  "clue": "The opposite of far"
}
```

- `num` (u8): Clue number
- `start` (CoordinatePair): Grid position, origin (0,0) is top-left
- `direction`: `"Across"` or `"Down"` (capitalized)
- `length` (u8): Number of characters in the answer
- `clue` (string): Human-readable clue text

### `CoordinatePair`

```json
{ "x": 19, "y": 13 }
```

### `PuzzleStatus`

One of:
- `"Unsolved"`
- `{ "Solved": { "solver_pk": "<public key bytes>" } }`
- `{ "Claimed": { "memo": "some text" } }`

### `UnsolvedPuzzles`

```json
{
  "puzzles": [ ...JsonPuzzle[] ],
  "creator_account": "testnet"
}
```

### `JsonPuzzle`

```json
{
  "solution_public_key": "ed25519:...",
  "status": "Unsolved",
  "reward": "5000000000000000000000000",
  "creator": "alice.testnet",
  "dimensions": { "x": 19, "y": 13 },
  "answer": [ ...Answer[] ]
}
```

## Puzzle Creation Flow

### Step 1: Prepare Clue/Answer Pairs

Create an array of objects with `clue` and `answer` fields:

```json
[
  { "clue": "The opposite of far", "answer": "near" },
  { "clue": "Distributed ledger technology", "answer": "blockchain" },
  { "clue": "Digital scarcity token", "answer": "nft" }
]
```

**Validation rules:**
- Minimum 3 valid pairs required
- Each clue and answer must be at least 3 characters
- Answers may only contain: letters, digits, hyphens, periods, underscores
- Underscore cannot be the first character

### Step 2: Generate Crossword Layout

Use `crossword-layout-generator` to arrange answers into a grid:

```js
import { generateLayout } from "crossword-layout-generator";

const layout = generateLayout(clueAnswerPairs);
// layout.rows — grid height
// layout.cols — grid width
// layout.result — array of placed words
```

Each item in `layout.result` with a truthy `position` field becomes an answer:

```js
const answers = layout.result
  .filter(item => item.position)
  .map(item => ({
    num: item.position,        // clue number
    start: { x: item.startx, y: item.starty },
    direction: item.orientation, // "across" or "down"
    length: item.answer.length,
    answer: item.answer,
    clue: item.clue,
  }));

const dimensions = { x: layout.cols, y: layout.rows };
```

### Step 3: Derive the Answer Public Key

Arrange answers by clue number (across before down when sharing a number),
lowercase them, and join with spaces to form the seed phrase:

```js
import { generateNewPuzzleSeedPhrase } from "./utils";
import { parseSeedPhrase } from "near-seed-phrase";

// mungedLayout has { across: { "1": { answer, clue, row, col }, ... }, down: { ... } }
const seedPhrase = generateNewPuzzleSeedPhrase(mungedLayout);
const { publicKey, secretKey } = parseSeedPhrase(seedPhrase);
// publicKey is the answer_pk to store on-chain
```

The seed phrase generation algorithm:
1. Find the highest clue number across both directions
2. For each number 1..max:
   - If an across clue exists with that number, append its answer
   - If a down clue exists with that number, append its answer
3. Lowercase all words and join with spaces

### Step 4: Prepare Contract Arguments

Strip the `answer` field and capitalize `direction` before sending to contract:

```js
const contractAnswers = answers.map(({ answer, direction, ...rest }) => ({
  ...rest,
  direction: direction === "down" ? "Down" : "Across",
}));
```

### Step 5: Call `new_puzzle`

Send a transaction with the reward as an attached deposit:

```js
{
  receiverId: "<contract-name>",
  actions: [{
    type: "FunctionCall",
    params: {
      methodName: "new_puzzle",
      args: {
        answer_pk: publicKey,    // from parseSeedPhrase
        dimensions: { x: cols, y: rows },
        answers: contractAnswers // answer text stripped
      },
      gas: "300000000000000",    // 300 TGas
      deposit: "<reward-in-yoctoNEAR>"
    }
  }]
}
```

## Solving and Claiming Flow

### Step 1: Query Unsolved Puzzles

Call `get_unsolved_puzzles` (see RPC examples below). Each puzzle includes
clues, grid dimensions, and the `solution_public_key`.

### Step 2: Fill In Answers

Use the clues and lengths to determine answers. The grid positions define where
each answer sits in the crossword.

### Step 3: Verify Solution Locally

Reconstruct the seed phrase from your answers (same ordering algorithm as
creation: by clue number, across before down). Parse it to get a keypair. If the
derived public key matches `solution_public_key`, the answers are correct.

### Step 4: Submit Solution

Sign a `submit_solution` transaction using the answer-derived secret key. Pass
your own public key as `solver_pk`:

```js
// Configure signing with the answer-derived secret key
{
  receiverId: "<contract-name>",
  actions: [{
    type: "FunctionCall",
    params: {
      methodName: "submit_solution",
      args: { solver_pk: "<your-public-key>" },
      gas: "300000000000000",
      deposit: "0"
    }
  }]
}
```

The contract adds a function-call access key for your `solver_pk` limited to
`claim_reward` and `claim_reward_new_account`.

### Step 5: Claim Reward

Sign with the solver's key to transfer the reward:

```js
// For existing account:
{
  methodName: "claim_reward",
  args: {
    crossword_pk: "<solution-public-key>",
    receiver_acc_id: "winner.near",
    memo: "Solved it!"
  },
  gas: "300000000000000",
  deposit: "0"
}

// For new account creation:
{
  methodName: "claim_reward_new_account",
  args: {
    crossword_pk: "<solution-public-key>",
    new_acc_id: "newuser.near",
    new_pk: "<solver-public-key>",
    memo: "Solved it!"
  },
  gas: "300000000000000",
  deposit: "0"
}
```

## RPC Examples

### Query Unsolved Puzzles

```bash
curl -X POST https://rpc.testnet.fastnear.com \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "near-crossword",
    "method": "query",
    "params": {
      "request_type": "call_function",
      "finality": "final",
      "account_id": "<contract-name>",
      "method_name": "get_unsolved_puzzles",
      "args_base64": "e30="
    }
  }'
```

`"e30="` is the base64 encoding of `{}` (empty args).

**Decoding the response:**

The result is a byte array at `json.result.result`. Decode it to a UTF-8 string
and parse as JSON:

```js
const decoded = response.result.result
  .map(charCode => String.fromCharCode(charCode))
  .join("");
const puzzles = JSON.parse(decoded);
```

### Construct a Transaction (new_puzzle example)

For change methods, construct a NEAR transaction with a `FunctionCall` action.
The arguments must be JSON-serialized and base64-encoded in the transaction's
`args` field. Use 300 TGas (`"300000000000000"`) for gas.

Transactions require signing with an ed25519 key and submitting via the
`broadcast_tx_commit` or `broadcast_tx_async` RPC method, or through a NEAR
SDK/wallet library.

## Seed Phrase Mechanics

The seed phrase is the core cryptographic mechanism linking crossword answers to
an on-chain public key.

### Generation (for puzzle creators)

Given a crossword with answers organized by direction and clue number:

```
across: { 1: "near", 3: "token" }
down:   { 1: "node", 2: "rpc" }
```

1. Find max clue number: `max(1, 3, 1, 2) = 3`
2. Iterate 1 to 3:
   - i=1: across[1] exists → "near"; down[1] exists → "node"
   - i=2: down[2] exists → "rpc"
   - i=3: across[3] exists → "token"
3. Result: `["near", "node", "rpc", "token"]`
4. Lowercase and join: `"near node rpc token"`

This seed phrase is parsed with `near-seed-phrase` (`parseSeedPhrase`) to derive
an ed25519 keypair. The public key becomes `answer_pk`.

### Verification (for solvers)

The same algorithm is applied to the solver's filled-in answers. If the derived
public key matches the puzzle's `solution_public_key`, the solution is correct.
The solver then uses the derived secret key to sign the `submit_solution`
transaction.

### Important Notes

- Answers are lowercased before joining
- Order is strictly: for each clue number, across first, then down
- The seed phrase must be valid BIP-39 — in practice, crossword answers that
  happen to form valid BIP-39 words work; the `near-seed-phrase` library handles
  the derivation
- The `parseSeedPhrase` function returns `{ publicKey, secretKey, seedPhrase }`

## Configuration

The contract name is set via the `NEXT_PUBLIC_CONTRACT_NAME` environment
variable. The network is set via `NEXT_PUBLIC_NEAR_ENV` (defaults to `testnet`).

| Network  | RPC Endpoint                        |
|----------|-------------------------------------|
| mainnet  | `https://rpc.mainnet.fastnear.com`  |
| testnet  | `https://rpc.testnet.fastnear.com`  |

## MPP Payment (Alternative to NEAR Wallet)

Puzzles can be created and AI clues generated using Tempo's Machine Payments
Protocol (HTTP 402) instead of connecting a NEAR wallet. The server accepts
dollar payments on the Tempo blockchain and funds the NEAR puzzle using its
own account.

### MPP Endpoints

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| GET | `/api/mpp/discover` | free | Machine-readable pricing (JSON or markdown) |
| GET | `/api/mpp/status` | free | MPP configuration and network info |
| POST | `/api/mpp/create-puzzle` | $1.00 | Create puzzle (402 challenge → Tempo payment → NEAR submission) |
| POST | `/api/mpp/generate-clues` | $0.10 | AI-generate clue/answer pairs from content |

### 402 Flow

1. Client sends POST without credentials
2. Server responds 402 with `WWW-Authenticate: Payment` header
3. Client signs a Tempo TIP-20 transfer
4. Client retries with `Authorization: Payment` header
5. Server verifies payment on-chain, returns 200 with `Payment-Receipt` header

### CLI Testing

```bash
npx mppx account create -a test && npx mppx account fund -a test
npx mppx http://localhost:3000/api/mpp/create-puzzle -a test -v \
  -J '{"clueAnswers":[{"clue":"Test","answer":"MPP"},{"clue":"Test2","answer":"NEAR"},{"clue":"Test3","answer":"TEMPO"}],"rewardNear":"5"}'
```

## Dependencies

- `crossword-layout-generator` — arranges clue/answer pairs into a crossword grid
- `near-seed-phrase` — derives ed25519 keypairs from BIP-39 seed phrases
- `@fastnear/api` — NEAR RPC and transaction utilities
- `@fastnear/wallet` — wallet connection and transaction signing
- `mppx` — Tempo Machine Payments Protocol client and server SDK
- `viem` — Tempo blockchain interactions (balance, faucet, transfers)
