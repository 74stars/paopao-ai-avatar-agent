# ADR 0005: Named AI Provider Profiles and Codex Channel Reuse

- **Status:** Accepted and implemented
- **Date:** 2026-08-11
- **Owners:** Desktop Main, AI Infrastructure, Renderer Settings
- **Supersedes:** The single-provider settings and allowlist decision in `provider-openai-structured-output-v1.md`

## Context

The original MVP pinned one OpenAI Chat Completions model. That was useful for
freezing the first AI port, but it no longer covers user-operated OpenAI-compatible
gateways, Responses-only models, local loopback endpoints, or an existing Codex
login/channel. The Core `AiProviderV1` port and all persistence rules remain valid;
the change belongs at the Main composition and settings boundaries.

## Decision

Paopao stores up to 32 named Provider Profiles and executes AI jobs through exactly
one active profile. Profiles are Main-owned. Renderer can list redacted profiles and
submit credentials, but cannot read credentials back.

```text
Renderer settings
  -> typed preload + V2 IPC
  -> Main Provider service
     -> encrypted Profile Store
     -> active-profile Provider factory
        -> Direct HTTPS adapter
        -> restricted Codex subprocess
  -> shared AiProviderV1
  -> analysis and insight executors
```

Changing, activating, or deleting a profile increments the store generation. The
job executor caches one provider per generation, so a stale provider or credential
cannot continue to own later jobs. Saving or activating resumes jobs waiting for
configuration; normal job preflight still decides whether they can run.

## Profile Contracts

### Direct Provider

| Setting | Behavior |
|---|---|
| Protocol | `openai_responses` or `openai_chat_completions` |
| Endpoint | normalized `baseUrl` plus `/responses` or `/chat/completions` |
| Authentication | Bearer, raw value in a validated custom API-key Header, or none |
| Structured output | native `json_schema`, `json_object`, or prompt-only JSON |
| Model and provider ID | user-configured, bounded strings recorded in AI audit metadata |
| Timeout | profile cap from 1 to 300 seconds, also bounded by the request timeout |
| Temperature | omitted for generic profiles; the legacy V1 OpenAI adapter alone retains `0` |

HTTPS is mandatory except for `localhost`, `127.0.0.1`, and IPv6 loopback. URLs
with credentials, query strings, or fragments are rejected. Authentication Header
names use the HTTP token grammar and cannot override transport-sensitive or cookie
headers.

### Codex Channel

The Codex profile stores no token. Paopao starts the local `codex` executable and
lets that process resolve its own account, custom provider, and authentication from
the selected `CODEX_HOME` and optional Codex profile. Paopao never reads or copies
`auth.json`, a keychain token, or Codex configuration contents.

Each generation call creates a private temporary workspace and a mode-0600 output
Schema, then runs:

```text
codex exec - --ephemeral --json --output-schema <schema>
  --sandbox read-only --ignore-rules
  -c shell_environment_policy.inherit=none
  -C <empty-temporary-directory> --skip-git-repo-check
```

Optional model, profile, and reasoning effort are passed as argument-array values,
never through a shell. A configured `~` Codex Home is expanded in Main before it is
placed in the child environment. The temporary child directory is always removed;
a caller-supplied parent directory is never removed.

The bridge accepts only final structured agent messages. Command, file-change, MCP,
web-search, or other tool events terminate the child and return `AI_SAFETY_BLOCKED`.
The read-only sandbox, empty working directory, disabled shell environment inheritance,
and event gate reduce exposure, but Codex remains a trusted local agentic dependency;
this bridge is not equivalent to a provider API that has no tool surface.

## Storage and Migration

- V2 profiles live in `userData/secrets/ai-providers.v2.json` as an atomic mode-0600 file.
- Direct credentials are encrypted independently with Electron `safeStorage`.
- Profile reads return only `credentialConfigured`; decrypted values remain Main-only.
- Diagnostic canary scanning includes every decrypted Direct credential plus the
  legacy AI key and Feishu App Secret; diagnostics still fail closed on a match.
- If the V2 store is empty and a valid V1 OpenAI credential exists, startup creates
  one fixed compatibility profile and makes it active. Migration runs once and never
  overwrites profiles subsequently created by the user.
- The V1 write-only IPC remains for compatibility during this version, but the
  production executor is exclusively backed by the V2 active profile.

## Operations

- `list`: returns redacted profiles and the active profile ID.
- `save`: creates or revises a profile; an omitted credential preserves the existing one.
- `activate`: switches future AI jobs to the selected profile.
- `delete`: removes the profile and its encrypted credential; deleting the active
  profile leaves no active profile rather than silently choosing another one.
- `probe`: can test any profile without activating it. It sends a real minimal
  structured request and can incur Provider usage; only stable status, identity,
  latency, and timestamp return to Renderer.
- `discoverCodex`: runs `codex --version` and the documented app-server JSON-RPC
  sequence `initialize`, `account/read`, and `model/list`. Discovery makes no model
  request and returns normalized installation, authentication, and model data.

## Error and Security Boundary

Provider bodies, prompts, user text, raw model output, filesystem paths from failures,
and credentials do not cross IPC or enter diagnostics. Probe failures collapse to
`not_configured`, `unavailable`, `auth_failed`, `invalid_output`, or `timeout`.
Codex discovery has separate not-installed, not-authenticated, and discovery-failed
states. All IPC inputs and outputs are strict schemas; an attempted extra secret field
turns into `INTERNAL_ERROR` without echoing the field.

## Implementation Ownership

| Workstream | Scope | Acceptance |
|---|---|---|
| Contracts | V2 discriminated profiles, requests, receipts, discovery | contract tests and generated declarations |
| Direct adapter | two wire protocols, auth modes, structured-output fallbacks | no-network request-shape and error tests |
| Codex bridge | restricted exec, JSONL parser, app-server discovery | injected fake-process tests; no CI login/network |
| Main composition | migration, registry, worker invalidation, diagnostics | store/service/composition/IPC security tests |
| Renderer | profile list/editor, segmented modes, probe/discovery states | write-only key tests, typecheck, production build |
| Final QA | Node suite, Electron ABI rebuild, smoke and visual inspection | all gates pass; no paid Provider call in CI |

## Consequences

Users can configure common OpenAI-compatible services and reuse a local Codex
channel without exposing secrets to Renderer. Core, prompts, output Schemas, AI audit
records, retry ownership, and database transactions do not change. Paopao does not
gain a model marketplace, automatic model downloads, simultaneous multi-provider
execution, arbitrary vendor-native protocols, or OAuth account management.
