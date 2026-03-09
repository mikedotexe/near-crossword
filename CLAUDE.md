# NEAR Crossword Puzzle App

NEAR Protocol crossword puzzle app — users create crossword puzzles with NEAR token rewards, solvers earn those tokens.

## Architecture

Three components: Rust smart contract, Next.js frontend, TypeScript worker agent.

### Contract (`contract/src/`)
Rust, near-sdk 5.24.x with `legacy` feature, compiles to WASM.

- `lib.rs` — core puzzle CRUD, solve/claim flows
- `reservation.rs` — reserve/activate/cancel for scheduled puzzles
- `admin.rs` — owner/operator role checks
- `migration.rs` — one-time state migration from 3-field to 6-field struct
- `debugging.rs` — debug view methods

Storage prefixes `b"c"`, `b"u"`, `b"r"` are baked into on-chain state — **never change these**.

### Frontend (`pages/`, `src/`)
Next.js, React 18, styled-components.

- Routes: `/` (home), `/play` (solve), `/create` (manual), `/ai-studio` (AI-assisted), `/login`, `/check-email`, `/my-jobs`, `/claim`, `/claimed`
- Wallet: FastNear wallet integration
- Auth: NextAuth.js (Google OAuth + magic link email) with database sessions — optional, enables async AI Studio
- State: React context via `AppFlowProvider` in `src/lib/appFlow.js`; `SessionProvider` wraps the entire app in `_app.js`

### Auth (`pages/api/auth/`, `src/lib/`)
NextAuth.js v4 with database strategy (Postgres).

- `pages/api/auth/[...nextauth].js` — Google + Email providers, database session (30-day), custom sign-in pages
- `src/lib/pg-adapter.js` — custom NextAuth PG adapter using snake_case columns (ported from dashboard)
- `src/lib/auth-helpers.js` — `getSession(req, res)` wrapper for API routes
- Auth tables: `users`, `accounts`, `sessions`, `verification_tokens` (migration 003)
- Auth is fully optional — unauthenticated users retain the existing sync AI Studio flow
- Email provider sends via Resend (`RESEND_API_KEY`); falls back to console.log when key missing

### Worker (`worker/`)
TypeScript, polls market.near.ai for jobs + processes async puzzle jobs.

- `agent.ts` — main loop: discover jobs, bid, manage conversations, run scheduler, process async jobs
- `conversationHandler.ts` — state machine: GENERATING → AWAITING_CHOICE → PREVIEW → PAYMENT → COMMITTING/RESERVING → DELIVERED
- `chainSubmitter.ts` — NEAR RPC calls (new_puzzle, reserve_puzzle, activate_puzzle)
- `db.ts` — Postgres persistence (marketplace puzzles)
- `asyncJobProcessor.ts` — picks up `puzzle_jobs` rows, calls Claude, stores variations, emails user on completion
- `emailService.ts` — Resend emails (no-op when key missing); includes `sendJobCompleted` for async jobs
- `scheduler.ts` — activates reserved puzzles at scheduled time

### Async AI Studio Flow
Authenticated users can submit AI Studio jobs asynchronously:

1. User submits content (PDF/YouTube/text) via `/ai-studio` with "Submit in background" checked
2. Frontend POSTs to `/api/puzzle-jobs/create` → inserts row in `puzzle_jobs` table
3. Worker picks up pending jobs in `tick()` → calls Claude → stores `variations_json`
4. Worker emails user via `sendJobCompleted()` with link to `/my-jobs`
5. User reviews variations on `/my-jobs`, selects one → stored in localStorage → redirected to `/create`

Job statuses: `pending` → `processing` → `completed` | `failed` (max 2 retries).

## Build Commands

- **Contract**: `cd contract && cargo build --target wasm32-unknown-unknown --release`
- **Worker**: `yarn worker:build` (tsc), `yarn worker:start` (build + run)
- **Frontend**: `yarn dev`, `yarn build`
- **DB**: `yarn db:migrate` — migrations in `worker/db/migrations/` (001 initial, 002 UX, 003 auth + async jobs)

## Key Conventions

- Contract uses explicit `#[derive(...)]` with `#[borsh(crate = "near_sdk::borsh")]` and `#[serde(crate = "near_sdk::serde")]` — not the `#[near(serializers)]` shorthand
- Contract uses `#[near(contract_state)]` on struct, `#[near]` on impl blocks
- Worker uses `.js` extensions in imports (ESM via tsc)
- All optional integrations (email, Twitter, auth) gracefully no-op when credentials missing
- `crossword-layout-generator` generates grid layouts; `near-seed-phrase` derives keypairs from answers
- NextAuth PG adapter uses snake_case DB columns (not NextAuth's default camelCase); `linkAccount` handles both naming conventions defensively
- API routes requiring auth use `getSession()` from `src/lib/auth-helpers.js` → 401 when no session

## Environment

- Node 20.x, Rust stable, `wasm32-unknown-unknown` target
- See `.env.example` for all config vars
- Postgres required for worker (puzzle state persistence) and auth (NextAuth database sessions)
- NextAuth env vars: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_GOOGLE_CLIENT_ID`, `NEXTAUTH_GOOGLE_CLIENT_SECRET`, `NEXTAUTH_EMAIL_FROM`
