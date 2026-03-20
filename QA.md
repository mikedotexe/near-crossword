# QA Testing Checklist

Pre-demo manual testing checklist. Each section lists what to test, how, and what env vars must be set.

---

## 1. Wallet Connection & NEAR Payment

**Env vars:** `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_CONTRACT_NAME`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1.1 | Connect wallet | Go to `/create` → click "Connect wallet" | FastNear wallet popup opens, after approval the puzzle form appears |
| 1.2 | Create puzzle with NEAR | Fill 3+ clues, set reward ≥ 5 NEAR, submit | Transaction sent, puzzle stored on-chain |
| 1.3 | Cancel wallet connect | Click "Connect wallet" → close/cancel the popup | Returns to `/create` with no error crash, "Connect wallet" button re-enabled |
| 1.4 | Wallet error | Set `NEXT_PUBLIC_CONTRACT_NAME` to invalid value | Error message shown, no unhandled exception |

---

## 2. MPP (Tempo) Dollar Payment — Puzzle Creation

**Env vars:** `MPP_RECIPIENT`, `MPP_SECRET_KEY`, `MPP_CURRENCY`, `MPP_REALM`, `MPP_TESTNET=true`, `NEXT_PUBLIC_MPP_TESTNET=true`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 2.1 | Pay with dollars gate | Go to `/create` → click "Pay with dollars" | Puzzle form appears (no wallet needed), subtitle mentions HTTP 402 |
| 2.2 | Auto-fund from faucet | First time user (no Tempo key in localStorage) → form loads | Tempo account created, faucet funds it automatically, balance > $0 shown |
| 2.3 | Balance display | After funding, check the MPP section in the form | Dollar balance shown, Tempo account address links to `explore.moderato.tempo.xyz` |
| 2.4 | Load sample clues | Click "Load sample clues" in the form | 5 MPP-themed clue/answer pairs pre-filled |
| 2.5 | Successful payment | Fill 3+ clues (or load samples), reward ≥ 5 NEAR, preview, click "Pay & Publish" | Status shows "Signing payment on Tempo...", then "Cross-chain transaction" panel |
| 2.6 | Cross-chain receipt | After successful payment with NEAR creds | Shows both Tempo payment link (`explore.moderato.tempo.xyz`) and NEAR transaction link (`testnet.nearblocks.io`) |
| 2.7 | Demo mode (no NEAR creds) | Unset `NEAR_PRIVATE_KEY` or leave as placeholder | Payment succeeds, receipt shows Tempo link + "Demo mode" note explaining NEAR submission was skipped |
| 2.8 | Insufficient balance | Have balance < $1.00 | "Pay & Publish" button disabled, message: "Insufficient balance. Click Add test funds above." |
| 2.9 | MPP not configured | Unset `MPP_RECIPIENT` | `/api/mpp/create-puzzle` returns 503 "MPP payments not configured" |

---

## 3. MPP (Tempo) Dollar Payment — AI Clue Generation

**Env vars:** `MPP_RECIPIENT`, `MPP_SECRET_KEY`, `ANTHROPIC_API_KEY`, `MPP_TESTNET=true`, `NEXT_PUBLIC_MPP_TESTNET=true`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 3.1 | MPP checkbox default | Go to `/ai-studio` | "Pay with dollars ($0.10 per generation)" is checked by default |
| 3.2 | Auto-fund on toggle | Enable MPP checkbox (if not already) | Tempo account created/loaded, faucet funds if balance is zero |
| 3.3 | Pay & generate | Provide content (any mode), click "Pay & Generate" | 402 → sign → clues returned with `paymentMethod: "tempo"` |
| 3.4 | Receipt after generation | After successful MPP generation | Payment receipt shown with reference and explorer link |
| 3.5 | Balance decremented | Check balance after generation | Balance reduced by $0.10 |
| 3.6 | MPP unchecked | Uncheck MPP checkbox | Button reads "Generate Clues", hits `/api/generate-clues` (free, no payment) |
| 3.7 | Insufficient balance | Have balance < $0.10, MPP checked | "Pay & Generate" button disabled, message: "Insufficient balance. Click Add test funds above." |
| 3.8 | MPP not configured server-side | Unset `MPP_RECIPIENT` → use MPP toggle on client | `/api/mpp/generate-clues` falls through without payment gate (generates for free) |

---

## 4. AI Studio — YouTube Input

**Env vars:** `ANTHROPIC_API_KEY`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 4.1 | Valid YouTube URL | Select "YouTube URL" tab, paste valid URL with English captions | Transcript fetched, 2 variations returned with 12 clue/answer pairs each |
| 4.2 | Invalid URL format | Enter `not-a-url` | Submit button stays disabled (URL doesn't match pattern) |
| 4.3 | Valid URL, no transcript | Use a video with no English captions | Error: "No English transcript available." |
| 4.4 | Short URL format | Use `https://youtu.be/VIDEO_ID` | Works the same as full URL |
| 4.5 | Embed URL format | Use `https://youtube.com/embed/VIDEO_ID` | Works the same as full URL |

---

## 5. AI Studio — PDF Upload

**Env vars:** `ANTHROPIC_API_KEY`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 5.1 | Valid PDF | Select "Upload PDF" tab, choose a PDF ≤ 15MB | 2 variations returned |
| 5.2 | Oversized PDF | Select a PDF > 15MB | Error: "File is too large. Maximum size is 15MB." (client-side rejection) |
| 5.3 | Non-PDF file | Select a .docx or .txt file | Error: "Please select a PDF file." (client-side rejection) |
| 5.4 | Server-side size limit | Somehow bypass client check with >18MB base64 | Error: "PDF is too large. Maximum size is ~18MB." (server returns 400) |

---

## 6. AI Studio — Pasted Text

**Env vars:** `ANTHROPIC_API_KEY`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 6.1 | Valid text | Select "Paste Text" tab, paste ≥ 50 characters | 2 variations returned |
| 6.2 | Too short | Paste < 50 characters | Submit button stays disabled, helper text shows "Minimum 50 characters." |
| 6.3 | Empty text | Leave textarea empty | Submit button disabled |

---

## 7. AI Studio — Async Mode (Background Jobs)

**Env vars:** `ANTHROPIC_API_KEY`, `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, + one auth provider configured

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 7.1 | Async toggle visibility | Sign in → go to `/ai-studio` → uncheck MPP | "Submit in background and email me when ready" checkbox appears |
| 7.2 | Async toggle hidden | Not signed in → go to `/ai-studio` | Async checkbox not shown |
| 7.3 | Submit async job | Check async → provide content → click "Submit Job" | POST to `/api/puzzle-jobs/create` succeeds, phase changes to "submitted" |
| 7.4 | Job processing | Worker running → check `puzzle_jobs` table | Status transitions: `pending` → `processing` → `completed` |
| 7.5 | Email notification | Job completes with `RESEND_API_KEY` set | User receives email with link to `/my-jobs` |
| 7.6 | View jobs | Go to `/my-jobs` | Completed jobs show variations; pending/processing jobs show status |
| 7.7 | Select variation | On `/my-jobs`, click a variation | Clues saved to localStorage, redirected to `/create` |
| 7.8 | Failed job retry | Force a failure (bad input) → check retry | Job retries up to 2 times, then status = `failed` |
| 7.9 | Async without auth | Try to POST `/api/puzzle-jobs/create` without session | 401 response |

---

## 8. Puzzle Solving & Claiming

**Env vars:** `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_CONTRACT_NAME` (contract must have active puzzles)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 8.1 | Load active puzzle | Go to `/play` | Crossword grid renders with clues |
| 8.2 | Solve puzzle | Fill in all correct answers | Seed phrase derived from sorted answers, claim flow initiated |
| 8.3 | Claim to existing account | Complete puzzle → enter existing NEAR account | Reward transferred to that account |
| 8.4 | Claim to new account | Complete puzzle → use seed phrase flow | New account created, reward deposited |
| 8.5 | Wrong answers | Fill in incorrect answers | Seed phrase derivation fails to match, claim rejected |

---

## 9. Authentication (NextAuth)

**Env vars:** `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DATABASE_URL`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 9.1 | Google sign-in | Click sign in → Google OAuth flow | **Env:** `NEXTAUTH_GOOGLE_CLIENT_ID`, `NEXTAUTH_GOOGLE_CLIENT_SECRET`. Session created, redirected back |
| 9.2 | Email magic link | Enter email → receive link → click it | **Env:** `RESEND_API_KEY`, `NEXTAUTH_EMAIL_FROM`. Session created |
| 9.3 | Session persistence | Sign in → close browser → reopen | Session persists (30-day database sessions) |
| 9.4 | Sign out | Click sign out | Session destroyed, redirected to home |
| 9.5 | Protected route | Go to `/my-jobs` without auth | Redirected to `/login` |
| 9.6 | No auth providers configured | Unset all Google + email env vars | Sign-in page loads but no providers available |

---

## 10. Email Integration (Resend)

**Env vars:** `RESEND_API_KEY`, `NEXTAUTH_EMAIL_FROM`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 10.1 | Magic link email | Sign in with email | Email delivered via Resend with magic link |
| 10.2 | Job completion email | Async job completes | Email sent with link to `/my-jobs` |
| 10.3 | Missing RESEND_API_KEY | Unset `RESEND_API_KEY` | Emails logged to console instead of sent, no crash |

---

## 11. Twitter/X Auto-Tweet

**Env vars:** `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 11.1 | Tweet on activation | Create and activate a puzzle with Twitter creds set | Tweet posted with puzzle link |
| 11.2 | No Twitter creds | Unset all Twitter env vars | No tweet, no error — graceful no-op |

---

## 12. MPP Test Script

**Env vars:** `MPP_RECIPIENT`, `MPP_SECRET_KEY` (app must be running on `localhost:3000`)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 12.1 | Run script | `bash scripts/test-mpp-flow.sh` | Status endpoint returns JSON, 402 challenge returned with WWW-Authenticate header |
| 12.2 | Parse challenge | Script decodes base64url request param | JSON challenge body printed with method, intent, amount, currency |
| 12.3 | Rust verification | Build `tools/mpp-verify` first: `cargo build --release --manifest-path tools/mpp-verify/Cargo.toml` | Script runs `mpp-verify challenge` and validates HMAC-bound IDs |
| 12.4 | MPP disabled | Unset `MPP_RECIPIENT` → run script | Warning: "MPP is not enabled. Set MPP_RECIPIENT in .env" |

---

## 13. Edge Cases & Degraded Modes

| # | Scenario | Missing env var | Expected |
|---|----------|----------------|----------|
| 13.1 | No contract configured | `NEXT_PUBLIC_CONTRACT_NAME` | Config warning on puzzle pages |
| 13.2 | No Anthropic key | `ANTHROPIC_API_KEY` | `/api/generate-clues` and `/api/mpp/generate-clues` return 500: "ANTHROPIC_API_KEY is not configured." |
| 13.3 | No MPP recipient | `MPP_RECIPIENT` | `/api/mpp/create-puzzle` returns 503; `/api/mpp/generate-clues` skips payment gate (generates free); `/api/mpp/status` returns `enabled: false` |
| 13.4 | No NEAR credentials | `NEAR_PRIVATE_KEY` | MPP puzzle creation returns `demo: true` with success message |
| 13.5 | No database | `DATABASE_URL` | Worker crashes on startup; NextAuth sessions fail; async jobs unavailable |
| 13.6 | No NextAuth secret | `NEXTAUTH_SECRET` | Auth pages error, but non-auth flows work normally |

---

## 14. Build & Deploy

| # | Scenario | Command | Expected |
|---|----------|---------|----------|
| 14.1 | Frontend build | `yarn build` | Exits 0, no errors |
| 14.2 | Dev server | `yarn dev` | Starts on `localhost:3000`, no startup errors |
| 14.3 | Worker build | `yarn worker:build` | TypeScript compiles without errors |
| 14.4 | Worker start | `yarn worker:start` | Connects to Postgres, begins polling loop |
| 14.5 | Contract build | `cd contract && cargo build --target wasm32-unknown-unknown --release` | WASM artifact produced in `target/` |
| 14.6 | DB migrations | `yarn db:migrate` | All migrations (001, 002, 003) applied without errors |
