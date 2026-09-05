# NEAR AI integration check, September 4

This is sanitized development evidence, not a successful model evaluation or
production activation. Checks ran September 4 local time (September 5 UTC).

## Credential handling

Mike supplied `NEAR_AI_API_KEY` in the original worktree's ignored `.env`.
Tests read that named value into a short-lived process without copying the
file or persisting credentials. No staking transaction, Render configuration,
x402 settlement, or reward transfer was performed.

Catalog reads return HTTP 200, including a read with the key attached. Because
the catalog is publicly readable, this does not prove that the key is accepted
for inference, that credits exist, or that credits are linked to the intended
default organization. No inference response supplied token usage or cost.
Billing for timed-out requests is unknown; a timeout is not proof of zero usage.

## Observations

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

No default model, reasoning setting, or production flag was changed based on
these failed requests. The initial GLM candidate remains configurable, not approved
for paid activation. No automatic model failover was introduced.

## Reproducible next check

The opt-in evaluator makes exactly one bounded request using synthetic payment
source text. It prints only status, model, elapsed time on success, numeric usage,
counts, and the required-review state. It never prints source text, draft answers,
provider reasoning, API keys, or raw provider errors. It does not call x402.

```bash
yarn ai:evaluate --env-file /path/to/ignored/.env
```

Optional `--model` and `--base-url` select an explicitly checked NEAR AI route;
they do not trigger automatic fallbacks. The default deadline is 30 seconds,
output limit 4,096 tokens, and provider retries are disabled. A successful
structural/source check would still require human clue/lesson quality review,
layout checks, usage reconciliation, and actual paid delivery/recovery testing.

Next: confirm a small prompt works in Cloud under the key's organization and
check available credits, then repeat one bounded app evaluation. Exact staking
farm/pool, credit conversion, and organization binding remain R1 account work.
Do not interpret these connection failures as evidence that another paid key or
more stake is necessarily needed.
