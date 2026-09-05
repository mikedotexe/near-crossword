# NEAR AI generation

The shared `NearAiStructuredClient` in `src/server/v2/ai.ts` targets NEAR AI's
OpenAI-compatible gateway using `NEAR_AI_API_KEY`. Default model:
`zai-org/GLM-5.1-FP8`, with `chat_template_kwargs.enable_thinking=false` for this
exact model. Other model overrides keep provider defaults; there is no fallback.

Preserve the 30-second total deadline, 4,096 output-token cap, disabled retries
and redirects, NEAR-only HTTPS endpoint validation, and sanitized errors. Never
log provider bodies, reasoning, raw drafts or credentials. `assertConfigured`
only checks local configuration; it is not a live readiness probe.

`NearAiLearningDraftGenerator` accepts bounded pasted sources, validates strict
shape and exact quoted references, and always returns `REQUIRES_REVIEW`. It is
not yet connected to the versioned paid source-review workflow. The old public
paid endpoint retains its topic/tone clue format and durable recovery semantics.

Opt-in `ai:diagnose` separates non-inference authentication and billing checks
from one-call synthetic chat/stream probes. Billing uses **Inference-Id**, not
the support **X-Request-Id**. A missing billing record or timed-out inference has
unknown cost, not necessarily zero. `ai:evaluate` runs one synthetic source draft.

The [dated evaluation](../docs/near-ai-evaluation-2026-09-04.md) records successful
GLM requests and actual costs, plus unresolved Gemma transport/other-model
failures. Key acceptance is verified. Staking-credit linkage, representative
quality/layout, reliability, attestation and paid delivery still need evidence.
Do not rotate a working key or add stake merely to troubleshoot a model timeout.
