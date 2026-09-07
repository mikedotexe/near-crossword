# NEAR AI integration check, September 4

This is sanitized development evidence, not production activation. Initial
session 2 failures are retained below. The session 4 follow-up established key
acceptance, successful source-grounded GLM 5.1 drafts, usage, and billing.
Checks ran September 4 local time (September 5 UTC).

## Credential handling

Mike supplied `NEAR_AI_API_KEY` in the original worktree's ignored `.env`.
Tests read that named value into a short-lived process without copying the
file or persisting credentials. No staking transaction, Render configuration,
x402 settlement, or reward transfer was performed.

During session 2, catalog reads returned HTTP 200, including a read with the key attached. Because
the catalog is publicly readable, this does not prove that the key is accepted
for inference, that credits exist, or that credits are linked to the intended
default organization. No session 2 inference response supplied token usage or cost.
Billing for timed-out requests is unknown; a timeout is not proof of zero usage.

## Session 2 observations (historical)

| Request | Result |
| --- | --- |
| Existing clue adapter, `z-ai/glm-5.3-flash`, three synthetic clues, max 4,096 output tokens | 30-second `AI_TIMEOUT`; no delivered draft |
| Same gateway/model, one-word diagnostic, max 64 tokens, `enable_thinking=false` | Also timed out at 30 seconds; this did not establish a supported reasoning configuration |
| Direct Gemma 4 endpoint, one-word diagnostic, max 64 tokens | Connection reset; no usable response |
| Gateway `Qwen/Qwen3.5-122B-A10B`, max 32 tokens | HTTP 400 model-not-found, confirmed in a second small diagnostic; the older docs still mention this ID |
| Source-grounded evaluator, catalog-ready non-reasoning `Qwen/Qwen3-VL-30B-A3B-Instruct`, three clues, max 4,096 tokens | 30-second `AI_TIMEOUT`; no delivered lesson |

Read-only direct-model probes for Gemma 4, GLM 5.3 Flash, and Qwen 3.5 all
returned `ECONNRESET` from this machine. No TLS verification was bypassed and
no key was sent outside NEAR AI endpoints. These observations do not identify
whether the cause is account configuration, provider availability, or the
network path. The explicit missing-model response is distinct from the timeouts.

The [direct-endpoint registry](https://completions.near.ai/endpoints) lists
`google/gemma-4-31B-it` at `gemma-4-31b.completions.near.ai` and a separate INT4
test endpoint. The [gateway catalog](https://cloud-api.near.ai/v1/model/list)
still lists no Gemma model. Thus Gemma has an advertised direct route, not proven
availability for this app. The earlier catalog-only observation should not be
read as "NEAR AI has no Gemma anywhere."

No default model, reasoning setting, or production flag was changed in session 2 based on
these failed requests. The initial GLM candidate remains configurable, not approved
for paid activation. No automatic model failover was introduced.

## Session 4: Working configuration

The key is accepted. A non-inference `POST /v1/billing/costs` call with a
deliberately invalid control returned 401; the same request with the configured
key returned 200. A missing synthetic billing ID is not a free inference receipt.
An invalid-model request with the configured key separately returned 400 rather
than 401. No replacement key, tenant header, staking transaction, or credit
purchase was needed to obtain successful inference.

Working request: `https://cloud-api.near.ai/v1/chat/completions`, Bearer API-key
authentication, `model: "zai-org/GLM-5.1-FP8"`, and
`chat_template_kwargs: { enable_thinking: false }`. The app retains strict JSON
schema, 4,096 output tokens, no retries, and the existing 30-second total deadline.
Only GLM 5.1 gets this model-specific flag. There is no model fallback; existing
explicit `V2_AI_MODEL` overrides still take precedence over the new default.
The ignored `.env` and Render configuration were not edited.

| Completed check | Elapsed | Token usage (prompt / completion / total) | Observed billing |
| --- | --- | --- | --- |
| GLM 5.1 synthetic `OK`, curl, max 32 | 2.098 s | 10 / 2 / 12 | No billing ID captured |
| Same GLM request through the pinned SDK diagnostic | 2.587 s | 10 / 2 / 12 | 22,800 nanoUSD = $0.0000228 |
| Full source draft through the generator, injected documented thinking flag, 60-second diagnostic deadline | 12.071 s | 265 / 434 / 699 | 2,280,600 nanoUSD = $0.0022806 |
| Unmodified request through the updated app evaluator, Node 20.18.3, normal 30-second deadline | 13.728 s | 265 / 535 / 800 | 2,725,000 nanoUSD = $0.002725 |

Both drafts contain three paragraphs and three entries from the one synthetic
source. Strict shape, exact source quotes, and source-backed answer validation
pass. Both remain `REQUIRES_REVIEW`; human factual/clue quality review and puzzle
layout evaluation were not performed. Two samples are not a reliability or
representative cost benchmark. Cryptographic inference attestation was not checked.

Safe billing identifiers, checked successfully with the same key:

- SDK GLM probe: `5e6d7360-9dd9-54fb-94d1-6c98381c7089`.
- First source draft: `eddc5918-239d-5e7c-a3b2-dc5468bd7110`.
- Updated app evaluator: `2f690afa-5bf7-59ca-bc51-e9884369814a`.
  Its support `X-Request-Id` is `13c4ca5b-ff17-4712-be40-7e756e93aa0c`.

A one-word gateway comparison using `google/gemini-2.5-flash-lite` also completed
in 0.642 s with 7 total tokens and a 1,000 nanoUSD billing record. This was a
synthetic diagnostic on a partner-routed model, not a NEAR-hosted TEE evaluation
or a product fallback. No sponsor content was sent in any live check.

## What the investigation established

- [NEAR's compatibility guide](https://docs.near.ai/cloud/guides/openai-compatibility)
  documents the standard SDK/Bearer flow and the same key for gateway and direct
  endpoints. There is no separate Gemma key or required staking wallet signature
  in the inference request. Public Cloud router source was inspected read-only
  at commit `5f6865755386e008947924dae427d917a671a3ce`.
- [Reasoning documentation](https://docs.near.ai/cloud/reasoning-models)
  explicitly supports disabling GLM 5.1 thinking with `enable_thinking: false`.
  Some other families require a different option. We verified this combination;
  we did not isolate thinking as the sole cause of the earlier models' failures.
- [Billing documentation](https://docs.near.ai/api-reference/billing/get-costs-by-request-ids)
  requires the response **Inference-Id**, not the support **X-Request-Id**.
  The API uses `requestIds` in its body despite that distinction. Missing records
  and warnings remain unknown, not zero cost. Billing can arrive asynchronously.
- [A September 4 GLM 5.3 report](https://github.com/nearai/cloud-api/issues/1015)
  includes successful requests but reports missing reasoning-token usage in
  streaming responses. It does not reproduce our timeout. GLM 5.3 cannot be
  called universally unavailable based on this machine's attempts.
- [A streaming reliability investigation](https://github.com/nearai/cloud-api/issues/982)
  describes incomplete responses and observability gaps, not a confirmed cause
  of our failures. A new Qwen VL streaming probe still delivered no headers or
  chunks by its 90-second diagnostic deadline. Its client support ID was
  `a01405b9-fd7f-47b4-8b0c-84008bfa3b09`; billing is unknown.
- Direct Gemma TLS also failed with curl (`SSL_ERROR_SYSCALL`, HTTP 000), before
  any authentication request. This is distinct from an API key rejection and
  reproduces the Node connection reset. The exact network/provider cause is
  unresolved. No TLS verification was bypassed.
- Public social search found general launch/usage material but no matching auth
  fix; direct X access was restricted. The actionable recipe came from official
  documentation, GitHub, and controlled calls, not a verified social workaround.

This clears the basic key/inference integration blocker. It does not establish
the credit source, intended default organization or staking linkage, current farm
configuration, model reliability, paid x402 delivery, or production deployment.
Earlier timed-out requests still have unknown billing; successful receipts cannot
be used to infer their cost.

## Reproducible checks

The opt-in evaluator makes exactly one bounded request using synthetic payment
source text. It prints only status, model, elapsed time on success, numeric usage,
counts, safe UUID-only support/billing IDs, and the required-review state. It never prints source text, draft answers,
provider reasoning, API keys, or raw provider errors. It does not call x402.

```bash
yarn ai:evaluate --env-file /path/to/ignored/.env
```

Optional `--model` and `--base-url` select an explicitly checked NEAR AI route;
they do not trigger automatic fallbacks. The default deadline is 30 seconds,
output limit 4,096 tokens, and provider retries are disabled. A successful
structural/source check still requires human clue/lesson quality review,
layout checks, usage reconciliation, and actual paid delivery/recovery testing.

Use the dedicated diagnostics for isolated troubleshooting. Authentication and
billing lookup do not request inference; chat and stream each send one synthetic
prompt and may consume credits. No automatic retries, fallback, or model sweep.

```bash
yarn ai:diagnose --env-file /path/to/ignored/.env --mode auth
yarn ai:diagnose --env-file /path/to/ignored/.env --mode chat --model zai-org/GLM-5.1-FP8 --disable-thinking
yarn ai:diagnose --env-file /path/to/ignored/.env --mode costs --inference-id <Inference-Id>
```

Optional diagnostic `--mode stream` uses the SDK's SSE parser; `--timeout-ms`
accepts 1,000-120,000 and `--max-tokens` accepts 1-256 (defaults 30,000 and 32).
Only documented `enable_thinking` models accept `--disable-thinking`; the CLI
does not guess other families' flags. All diagnostic requests use the NEAR
gateway with redirects disabled. No raw response, reasoning, error body, or
API-key value is logged. The application's own limits have not been raised.

Next: evaluate representative sponsor material and review layout/quality, then
connect to private review through the versioned paid workflow. Mike still needs
to confirm the intended default organization's credit source and exact staking
farm/pool/rate before sizing or signing a stake. No new key or extra stake is
needed merely to repeat the working API call.
