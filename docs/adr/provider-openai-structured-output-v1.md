# ADR: OpenAI Structured Output Provider for MVP

- **Status:** Superseded in part by ADR 0005 (historical G0 baseline)
- **Date:** 2026-08-05
- **Owners:** A4 (AI / Evaluation), A0 (acceptance)
- **Scope:** MVP's single external AI Provider; no production implementation in this spike

> ADR 0005 supersedes this document's single-provider allowlist and settings
> decision. The `AiProviderV1` port, strict output validation, sanitized errors,
> audit metadata, retry ownership, and CI fake strategy remain accepted.

## Context

The MVP needs one real provider that can return schema-constrained JSON for both
`analyze_entry` and `generate_insight`. The provider is called only after the
local capture transaction commits. Provider credentials must remain Main-only,
and the Core consumes the frozen `AiProviderV1` port from `@paopao/contracts`.

The repository currently has no AI SDK dependency. Introducing one during Wave 0
would expand the lockfile and couple Core to a vendor. The spike therefore uses
the provider's HTTPS API shape and a local HTTP mock, with no network key or user
text.

## Decision

### Frozen provider allowlist

| Field | Frozen value |
|---|---|
| Provider ID | `openai` |
| API | `POST https://api.openai.com/v1/chat/completions` |
| Default model | `gpt-4o-mini-2024-07-18` |
| Authentication | Main-process `Authorization: Bearer <API key>`; key enters through write-only IPC and is stored only via OS `safeStorage` |
| Structured output | `response_format.type = json_schema`, `strict = true`; schema name `paopao_memory_analysis_v1` for `memory-analysis.v1` (insight uses its contract schema name) |
| Input limit | 50,000 Unicode code points for `userData` (same as `rawText` capture limit); reject before network, never truncate |
| Request timeout | 20,000 ms wall-clock per request, including response body; abort with `AI_TIMEOUT` |
| Temperature | `0` for extraction and insight calls; no renderer model/temperature override |
| Retry ownership | Provider maps failures; Core owns retry budget and the single invalid-JSON repair attempt |

The model snapshot is pinned so a deployment does not silently change model
behavior. A future model change requires a new ADR or an explicit superseding
decision, plus eval evidence.

### Error mapping

Provider adapters expose only the frozen application error codes; response
bodies, prompts, API keys, and raw model output are never persisted or logged.

| Provider condition | Error code | Retryable | Core action |
|---|---|---:|---|
| Abort/deadline after 20 s | `AI_TIMEOUT` | yes | bounded retry with backoff |
| HTTP 429 (including `Retry-After`) | `AI_RATE_LIMITED` | yes | bounded retry; cap delay |
| DNS, connect, TLS, read, or HTTP 5xx | `AI_NETWORK_ERROR` | yes | bounded retry |
| HTTP 401/403 | `AI_AUTH_FAILED` | no | wait for configuration; user action required |
| Provider safety refusal/content filter | `AI_SAFETY_BLOCKED` | no | `needs_review` + `failed_final`, preserve raw entry |
| Context/input limit (`context_length_exceeded`) | `AI_INPUT_TOO_LARGE` | no | `needs_review` + `failed_final`, no truncation |
| Missing/malformed JSON or schema mismatch | `AI_INVALID_OUTPUT` | yes once | one repair request, then `failed_final` |

An HTTP 400 that is not a recognized context or safety error is treated as
`AI_INVALID_OUTPUT` and is not allowed to leak vendor text.

### Cost and audit fields

Every successful or failed attempt must emit the fields already frozen by
`AiRunMetadataV1`/`DiagnosticEventV1`:

`provider`, `model`, `promptVersion`, `schemaVersion`, `latencyMs`,
`inputTokens`, `outputTokens`, and `providerRequestId` (nullable when absent).

Token usage is the authoritative cost-audit input. MVP does not persist a
vendor-price table or a raw dollar amount; estimated cost, if displayed later,
must be computed offline from a versioned pricing table and cannot alter the v1
contract. No field may contain user text, prompt text, credentials, or raw
provider output.

### CI fake strategy

CI and default unit/integration tests use a deterministic in-process
`FakeAiProvider` implementing `AiProviderV1`. Fixtures cover:

- valid strict JSON with deterministic usage metadata;
- timeout, 429, auth, safety, input-too-large, network/5xx, and malformed JSON;
- one repair success and one repair failure;
- stable `providerRequestId` values without secrets.

No paid network call runs in CI. A real-provider evaluation job may be run only
with an explicitly injected secret in a protected environment; its logs must
retain metadata only. The fake must be injectable at the Infrastructure/Main
composition boundary and must not be imported by Core production code.

## Spike evidence

The repeatable, key-free request and mapping check is:

```bash
node docs/adr/provider-openai-spike.mjs
```

It starts a loopback HTTP server, asserts the pinned model, strict JSON Schema
request shape, bearer-header placement, token usage parsing, 20 s abort wiring,
50,000-code-point boundary, and all frozen error mappings. The test key is an
in-memory sentinel and is never written to disk or logs by the script.

## Consequences

- A4 can later implement an adapter around `AiProviderV1` without changing Core
  or Renderer contracts.
- A0/A1 can restrict settings to `provider: "openai"` and model
  `gpt-4o-mini-2024-07-18`; a user cannot select an unsupported provider.
- Network and vendor SDK behavior remain outside Core and can be replaced by the
  fake in tests.
- The pinned snapshot may eventually require a superseding ADR if the vendor
  retires it; that is an explicit release decision, not silent drift.

## Rejected alternatives

- **Coze:** existing prototype is workflow/HTTP-callback oriented and does not
  provide a stable, local, strict JSON contract for this MVP.
- **Multiple providers or local models:** explicitly outside MVP scope and would
  weaken settings, error, and cost determinism before reliability data exists.
- **Vendor SDK in Wave 0:** adds dependency/lockfile churn without improving the
  contract spike; the production adapter can choose fetch or an SDK later.

## Acceptance checklist for A0

- [x] A0 accepts this ADR and links it from `docs/adr/README.md`.
- [ ] A1 confirms settings and Provider Schema allow only the frozen ID/model.
- [ ] A4's production adapter (M2-02) and A2's processing tests consume the
  exact `AiProviderV1` metadata and error mapping above.
