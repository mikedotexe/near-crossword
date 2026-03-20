NEAR Crossword
==================

Wallet Login (FastNear)
=======================

Crossword auth and transaction flows now use FastNear:

- `@fastnear/api` + `@fastnear/wallet` are used for wallet session restore/connect/tx.
- Wallet options are supplied by a bundled manifest in [src/fastnearWalletManifest.js](/Users/mikepurvis/other/near-crossword/src/fastnearWalletManifest.js).
- Wallet login support is limited to `mainnet` and `testnet`.
- Solve/claim local signing for `submit_solution`, `claim_reward`, and `claim_reward_new_account` now uses `@fastnear/api` local key mode (`near.state.update` + `near.sendTx`).
- `near-seed-phrase` is intentionally retained for crossword seed phrase compatibility.

Crossword Package Fork
======================

- The crossword UI package is now consumed from your fork package scope: `@crosswordxyz/react-crossword`.
- The app consumes the published npm package (`@crosswordxyz/react-crossword@^6.0.0`).
- The app imports the stable utility entrypoint `@crosswordxyz/react-crossword/util` (no private `dist/*` imports).

Runtime and Package Manager
===========================

- Node is pinned to `20.x` (see [.nvmrc](/Users/mikepurvis/other/near-crossword/.nvmrc)).
- Package manager is Yarn Berry (`4.x`) in compatibility mode via [/.yarnrc.yml](/Users/mikepurvis/other/near-crossword/.yarnrc.yml) with `nodeLinker: node-modules`.
- Dependency lockfile is [yarn.lock](/Users/mikepurvis/other/near-crossword/yarn.lock).
- `package-lock.json` is intentionally ignored.
- `near-cli` is intentionally **not** a project dependency. Install it globally for local deploy workflows.
- Frontend runtime now uses **Next.js** (`pages` router) instead of Parcel.
- FastNear packages are pinned to exact versions in `package.json`:
  `@fastnear/api@0.9.13`, `@fastnear/wallet@0.9.13`,
  `@fastnear/near-connect@0.10.6`, and `@fastnear/utils@0.9.13`.

Frontend Routes
================

The app uses native Next.js path routing:

- `/` marketing landing page
- `/play` live puzzle play flow
- `/create` wallet-gated puzzle creator flow
- `/ai-studio` AI-assisted clue generation (sync + async modes)
- `/login` sign in via Google OAuth or magic link email
- `/check-email` post-magic-link confirmation
- `/my-jobs` authenticated user's async AI Studio job dashboard
- `/claim` reward claim flow after solving
- `/claimed` claim success page
- `/empty` no-active-puzzle state

Legacy compatibility bridge:

- Old hash links like `/#/create` and `/#/play` are redirected to the new path routes.
- Hash redirect usage is tracked with the `hash_bridge_redirect` analytics event during migration.
- Default transition policy: keep this bridge for two release cycles, then remove once usage is negligible.

Authentication (Optional)
=========================

Optional sign-in via Google OAuth or magic link email, powered by NextAuth.js v4 with Postgres database sessions.

- **Unauthenticated users** retain the existing synchronous AI Studio flow (submit content, wait for clues).
- **Authenticated users** unlock async mode: submit a job in the background, leave the page, and get emailed when clues are ready.
- Auth state is shown in the top nav (email + sign out) and adds a "My Jobs" link.
- Sessions are stored in Postgres (30-day expiry). The custom PG adapter uses snake_case columns.
- All auth is optional — the app works fully without any NextAuth env vars configured.

Required env vars for auth:

- `NEXTAUTH_URL` — canonical app URL (e.g. `http://localhost:3000`)
- `NEXTAUTH_SECRET` — session encryption secret (`openssl rand -base64 32`)
- `NEXTAUTH_GOOGLE_CLIENT_ID` / `NEXTAUTH_GOOGLE_CLIENT_SECRET` — Google OAuth credentials
- `RESEND_API_KEY` — for magic link emails (falls back to console.log if missing)
- `NEXTAUTH_EMAIL_FROM` — sender address for magic link emails

Database migration `003_auth_and_async_jobs.sql` must be applied for auth and async jobs to work.

AI Studio
=========

AI Studio generates crossword clue/answer pairs from user-provided content (YouTube URL, PDF upload, or pasted text) using Claude.

**Sync mode** (default, no auth required): User submits content, waits ~10s for Claude to generate 2 variations, picks one, then proceeds to `/create`.

**Async mode** (requires sign-in): User checks "Submit in background and email me when ready", submits the job, and can leave. The worker picks up pending jobs from `puzzle_jobs`, calls Claude, stores results, and emails the user. Jobs are viewable at `/my-jobs` with auto-polling.

Draft state is persisted in localStorage (`aiCrosswordDraft`). Selected variations are passed to `/create` via localStorage (`aiGeneratedClues`).

NEAR AI env vars (for marketplace worker integration):

- `NEXT_PUBLIC_NEAR_AI_ENABLED` (`false` by default)
- `NEXT_PUBLIC_MARKET_NEAR_AI_URL` (`https://market.near.ai` by default)
- `NEXT_PUBLIC_NEAR_AI_AGENT_ID` (optional placeholder)

Next.js Client Env Vars
========================

For browser-side NEAR config in Next.js, use:

- `NEXT_PUBLIC_NEAR_ENV` (`testnet` by default)
- `NEXT_PUBLIC_CONTRACT_NAME` (contract account id)
- `NEXT_PUBLIC_NEAR_AI_ENABLED` (`false` by default)
- `NEXT_PUBLIC_MARKET_NEAR_AI_URL` (`https://market.near.ai` by default)
- `NEXT_PUBLIC_NEAR_AI_AGENT_ID` (optional placeholder)

Client env precedence:

- Frontend runtime uses `NEXT_PUBLIC_NEAR_ENV` only (with `testnet` default).
- Shell-only envs like `NEAR_ENV` and `CONTRACT_NAME` are not used by browser-side routing/query flows.
- Prefer `.env.local` for local app config (see [.env.example](/Users/mikepurvis/other/near-crossword/.env.example)).

Missing contract behavior:

- If the configured contract account is missing or does not expose crossword view methods, landing (`/`) still renders.
- Task routes (`/play`, `/claim`, `/create`) show a concise configuration warning with setup guidance.
- Non-recoverable RPC/network failures still surface as initialization errors.

Tempo MPP (Multi-Currency Payments)
=====================================

The app integrates Tempo's Machine Payments Protocol (MPP) to accept payments
in addition to NEAR. This enables a cross-chain payment flow: users pay with
Tempo tokens, and the server funds puzzles on NEAR using its own account.

**The app defaults to Tempo Moderato testnet** (chain ID 42431). Judges and
new users get free test funds automatically from the faucet — no MetaMask, no
API keys, no sign-up required. Transactions can be verified at
https://explore.moderato.tempo.xyz.

To switch to Tempo mainnet with real USDC, set `MPP_TESTNET=false` and
`NEXT_PUBLIC_MPP_TESTNET=false` and update `MPP_CURRENCY` to the mainnet
USDC address.

**How it works:**

```
  Browser (mppx client)              Server (mppx server)           Blockchains
  ─────────────────────              ────────────────────           ──────────
  1. POST /api/mpp/create-puzzle ──→ 2. No payment credential
                                        → 402 + WWW-Authenticate
  3. ← 402 Payment Required ←───────
  4. Auto-sign Tempo tx
     (TIP-20 transfer) ─────────────→                         ──→ 5. Tempo: verify
  6.                                    Payment verified             transfer
                                        → new_puzzle()         ──→ 7. NEAR: create
  8. ← 200 + Payment-Receipt ←──────                                puzzle on-chain
     + txHash
  9. Show cross-chain receipt
     (Tempo link + NEAR link)
```

1. User clicks "Pay with dollars" on the Create or AI Studio page
2. Browser generates an ephemeral Tempo account (stored in localStorage)
3. Account is automatically funded from the testnet faucet when balance is zero
4. When submitting, the API returns HTTP 402 with a `WWW-Authenticate: Payment` challenge
5. The mppx client auto-signs a Tempo transaction and retries with an `Authorization: Payment` credential
6. Server verifies the payment on-chain, then creates the puzzle on NEAR

**API Endpoints:**

- `GET /api/mpp/status` — check if MPP is enabled, see prices and currency
- `GET /api/mpp/discover` — machine-readable pricing (JSON or `Accept: text/markdown`)
- `POST /api/mpp/create-puzzle` — MPP-gated puzzle creation ($1.00)
- `POST /api/mpp/generate-clues` — MPP-gated AI generation ($0.10)

**Required env vars:**

- `MPP_RECIPIENT` — Tempo address to receive payments
- `MPP_SECRET_KEY` — HMAC key for challenge binding (`openssl rand -hex 32`)
- `MPP_CURRENCY` — TIP-20 token address (default: pathUSD on Moderato testnet)
- `MPP_TESTNET` — defaults to `true` (Moderato testnet); set `false` for mainnet
- `NEXT_PUBLIC_MPP_TESTNET` — client-side testnet flag (must match `MPP_TESTNET`)

**Demo (browser):**

```bash
yarn dev
# Open http://localhost:3000/create
# Click "Pay with dollars" → "Load sample clues" → "Generate Sample Puzzle" → "Pay & Publish"
# Open DevTools Network tab to see the HTTP 402 → 200 flow:
#   1. POST /api/mpp/create-puzzle → 402 (WWW-Authenticate: Payment ...)
#   2. POST /api/mpp/create-puzzle → 200 (Payment-Receipt header with tx reference)
```

**Demo (mppx CLI — recommended for judges):**

```bash
# Create a testnet account (one-time, stored in system keychain)
npx mppx account create -a judge
npx mppx account fund -a judge

# Check pricing
npx mppx http://localhost:3000/api/mpp/status -a judge

# Make a paid puzzle creation request — the CLI handles the full 402 flow:
#   1. Sends POST → gets 402 Payment Required
#   2. Auto-signs Tempo transaction
#   3. Retries with Payment credential → gets 200 + receipt
npx mppx http://localhost:3000/api/mpp/create-puzzle -a judge -v \
  -J '{"clueAnswers":[{"clue":"HTTP status for payment required","answer":"402"},{"clue":"Payment protocol","answer":"MPP"},{"clue":"Smart contract chain","answer":"NEAR"}],"rewardNear":"5"}'
```

**Demo (shell script):**

```bash
bash scripts/test-mpp-flow.sh
# Shows: status endpoint, 402 challenge parsing, Rust SDK verification
```

**Dependencies:** `mppx` (TypeScript SDK), `viem` (Tempo blockchain interactions)

Analytics Events
================

The frontend tracks funnel events via `src/lib/analytics.js`:

- `landing_cta_create_click`
- `landing_cta_play_click`
- `hash_bridge_redirect`
- `create_connect_wallet_click`
- `wallet_connect_success`
- `wallet_connect_cancel_or_fail`
- `create_preview_generate`
- `create_commit_initiated`
- `create_commit_success`
- `create_commit_cancel_or_fail`
- `play_view_loaded`
- `claim_submit`
- `claim_success`
- `ai_youtube_upload_start` / `ai_pdf_upload_start` / `ai_text_upload_start`
- `ai_pdf_upload_success` / `ai_pdf_upload_error`
- `ai_async_submit_success`
- `ai_variation_selected`
- `landing_mpp_create_click` / `landing_mpp_ai_click`
- `create_use_mpp_click`
- `create_commit_mpp_initiated` / `create_commit_mpp_success` / `create_commit_mpp_fail`
- `ai_mpp_generation_start` / `ai_mpp_generation_success`

How to play with this contract
===============================
1. Clone the repo.

```
git clone https://github.com/near-examples/near-crossword.git
cd near-crossword
```

2. Next, make sure you have NEAR CLI by running:

  ```
  near --version
  ```

  If you need to install `near-cli`:

  ```
  npm install near-cli -g
  ```

3. Build the smart contract

```
cd contract
./build.sh
```

4. Run `near dev-deploy` to deploy the contract to `testnet`.
5. Create a crossword, let's say that the answer to your crossword is "many clever words"
6. Answer for your crossword from now on will be a seed phrase! Let's generate key pair out of it.

   ```bash
   near generate-key randomAccountId.testnet --seedPhrase='many clever words'
   ```

   Now this key pair will be store on your machine under `~/.near-credentials/testnet/randomAccountId.json`

7. We should add your puzzle to our contract. To do that run
   
   ```bash
   near call <contract-account-id> new_puzzle '{"answer_pk":"<generated-pk>"}' --accountId=<signer-acc-id> --deposit=10
   ```
   Where:
      - `contract-account-id` - Account on which contract is stored. If you have used `near dev-deploy` in the first step it was autogenerated for you. It should look like `dev-<random-numbers>`.
      - `generate-pk` - Public key from JSON generated in the step #4
      - `accountId` - your existing testnet accountId (you can create one at https://wallet.testnet.near.org/)
      - `deposit` - reword for the person who will solve this puzzle
   
   After this call your puzzle will be added to the NEAR Crossword contract. Share your Crossword with friends, the person who will be able to solve it will be able to generate the same key pair and get the reward. Let's do that in the following steps.

8. Pretend that we have solved the puzzle and generated the very same key pair. This time it should be stored at `~/.near-credentials/testnet/<contract-id>.json`. We are using `<contract-id>` here because in the next step we will need to sign the transaction with this acc.

Attention! If you are using the same machine, your old key pair from `<dev-acc>` will be overwritten! Save it in some other place if you need it. Keys are stored in `~/.near-credentials/testnet/` folder.

To generate the new key:
```bash
near generate-key <crossword-contract-id> --seedPhrase='many clever words'
```

Also, we need to have another key that will be used later to get the reward. Let's generate it.

```bash
near generate-key keyToGetTheReward.testnet
```

7. Let's call `submit_solution` function to solve this puzzle.

```bash
near call <contract-id> submit_solution '{"solver_pk":"<PK from keyToGetTheReward.testnet>"}' --accountId=<contract-id>
```

Puzzle solved! Let's get our reward!

8. To get the reward we need to call the `claim_reward` function with the function call key that we have added in the previous step. Before that call we should prepare the keys:

```bash
cp ~/.near-credentials/testnet/keyToGetTheReward.testnet.json ~/.near-credentials/testnet/<contract-id>.json
```

And now we can claim our reward:

```bash
near call <contract-id> claim_reward '{"receiver_acc_id":"serhii.testnet", "crossword_pk":"<PK from randomAccountId account>", "memo":"Victory!"}' --accountId=<contract-id>
```

Quick Start
===========

To run this project locally:

1. Prerequisites: Make sure you've installed [Node.js] 20.x and global `near-cli`
2. Install dependencies: `yarn install`
3. Optional (recommended): copy [.env.example](/Users/mikepurvis/other/near-crossword/.env.example) to `.env.local` and set `NEXT_PUBLIC_CONTRACT_NAME`.
4. Run the local full-stack workflow (dev deploy + frontend): `yarn dev:full`
5. Or run frontend only: `yarn dev`
6. Build production frontend: `yarn build` and serve with `yarn start`
7. See `package.json` for a
   full list of `scripts` you can run with `yarn`)

Frontend-only quick start with explicit contract:

- `NEXT_PUBLIC_CONTRACT_NAME=<your-contract.testnet> NEXT_PUBLIC_NEAR_ENV=testnet yarn dev`

Now you'll have a local development environment backed by the NEAR TestNet!

Go ahead and play with the app and the code. As you make code changes, the app will automatically reload.

Exploring The Code
==================

1. The "backend" code lives in the `/contract` folder. See the README there for
   more info.
2. The frontend uses Next.js `pages` routes (`/pages/index.js`, `/pages/play.js`, etc.).
   Shared app state and transaction flow helpers live in `/src/lib/appFlow.js`.
3. Tests: there are different kinds of tests for the frontend and the smart
   contract. See `contract/README` for info about how it's tested. The frontend
   test script is currently a placeholder.

Deploy
======

Every smart contract in NEAR has its [own associated account][NEAR accounts]. When you run `yarn dev:full`, your smart contract gets deployed to NEAR TestNet with a throwaway account. When you're ready to make it permanent, here's how.

Step 0: Install near-cli (required for local deploy scripts)
-------------------------------------

[near-cli] is a command line interface (CLI) for interacting with the NEAR blockchain. This repo expects it to be installed globally:

    npm install -g near-cli

Ensure that it's installed with `near --version`

Step 1: Create an account for the contract
------------------------------------------

Each account on NEAR can have at most one contract deployed to it. If you've already created an account such as `your-name.testnet`, you can deploy your contract to `crossword.your-name.testnet`. Assuming you've already created an account on [NEAR Wallet], here's how to create `crossword.your-name.testnet`:

1. Authorize NEAR CLI, following the commands it gives you:

      near login

2. Create a subaccount (replace `YOUR-NAME` below with your actual account name):

      near create-account crossword.YOUR-NAME.testnet --masterAccount YOUR-NAME.testnet

Step 2: set contract name in code
---------------------------------

Set `NEXT_PUBLIC_CONTRACT_NAME` (and optionally `NEXT_PUBLIC_NEAR_ENV`) for the frontend, preferably in `.env.local`.

Example:

    NEXT_PUBLIC_CONTRACT_NAME=crossword.YOUR-NAME.testnet
    NEXT_PUBLIC_NEAR_ENV=testnet

Step 3: deploy!
---------------

Build frontend with:

    yarn build

Then serve the production app with:

    yarn start

Troubleshooting
===============

On Windows, if you're seeing an error containing `EPERM` it may be related to spaces in your path. Please see [this issue](https://github.com/zkat/npx/issues/209) for more details.


  [React]: https://reactjs.org/
  [create-near-app]: https://github.com/near/create-near-app
  [Node.js]: https://nodejs.org/en/download/package-manager/
  [jest]: https://jestjs.io/
  [NEAR accounts]: https://docs.near.org/docs/concepts/account
  [NEAR Wallet]: https://wallet.testnet.near.org/
  [near-cli]: https://github.com/near/near-cli
