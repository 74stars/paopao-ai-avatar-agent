# Wave 0 Dispatch

> Lifecycle: completed execution history. G0 is closed; this file is not a current dispatch plan.

Updated: 2026-08-05

## Objective

Close G0 by freezing Contract v1 and the single Provider decision while independently rechecking the Electron build/resource baseline.

## Assignments

| Agent | Work package | Owned paths | Deliverable |
|---|---|---|---|
| A1 | M0-02 Contract v1 | `packages/domain/**`, `packages/contracts/**`, assigned contract ADRs | Strict Zod schemas, derived types, v1 fixtures, contract tests, handoff |
| A4 | M0-05 Provider spike | A0-assigned files under `docs/adr/**` only | Provider spike evidence and accepted ADR inputs |
| A3 | M0-03 audit | Read-only review of `desktop-app/electron/**`, Vite/TS config, `index.html`, `public/**` | PASS/FAIL report and minimal scoped fix proposal |

## Shared Rules

- Contract version is v1; consumers do not create local replacement types.
- Agents preserve existing uncommitted changes and do not run reset, checkout, or broad formatting commands.
- Package manifests, lockfile, CI, electron-builder config, and cross-workspace exports remain A0-owned.
- Real keys, secrets, tokens, prompts, and user text must not enter fixtures, logs, ADRs, or test output.

## G0 Evidence Required

1. Each agent reports changed files, commands and results, contract/ADR versions, residual risks, and next consumers.
2. A0 runs the clean-install, typecheck, contract/unit test, build, and native smoke commands after handoffs are integrated.
3. G0 is PASS only when both Contract v1 and Provider ADR are repeatably testable; a successful Electron build alone is insufficient.
