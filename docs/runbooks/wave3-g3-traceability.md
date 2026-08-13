# Wave 3 / G3 Traceability Matrix

Review date: 2026-08-08  
Contract: v1  
Scope: M3-01 through M3-04 and the G3 exit criteria  
Scope status: **DEFERRED POST-MVP INCREMENT** under ADR 0004  
Decision rule: this matrix does not block MVP release. A future Feishu connector release still requires real-tenant evidence; mocks cannot close that increment gate.

## Automated Matrix

| Requirement | Automated evidence | Manual evidence | Owner | A6 status |
|---|---|---|---|---|
| Official SDK long connection; no production HTTP callback | `adapters/feishu/test/sdk-transport.test.ts`; `tests/security/wave3-boundaries.test.mts`; locked `@larksuiteoapi/node-sdk@1.72.0` | Tenant setup confirms long-connection delivery and no callback URL | A5/A0 | Automated PASS; tenant pending |
| Explicit connect/disconnect and redacted status | `adapters/feishu/test/adapter.test.ts`; `desktop-app/test/settings-panel.test.ts` | Observe connected, reconnecting, auth error and permission error | A5/A3/A6 | Automated PASS; tenant pending |
| Retry backoff, SDK token lifecycle and wake recreation | Adapter reconnect/wake tests and SDK transport tests | Sleep/resume and a token-lifetime soak with a post-soak message | A5/A3/A6 | Wake/retry automated PASS; tenant soak pending |
| Main-only encrypted Feishu credential facade | `desktop-app/test/credential-store.test.ts`; `desktop-app/test/composition.test.ts` | Save/delete credentials, inspect only masked public status | A3/A6 | Automated PASS |
| Unique Main composition and shutdown order | `desktop-app/test/composition.test.ts`; Adapter in-flight disconnect test; Electron composition smoke | Exit while intake/work is active; confirm offline and drained shutdown | A3/A5/A6 | Automated/Electron smoke PASS; tenant pending |
| Six-digit, ten-minute, single-active binding code; salted hash only | `packages/infrastructure/test/database/binding-delivery.test.ts` | Generate once and verify no historical code re-display | A2/A3/A6 | Automated PASS; UI manual pending |
| Binding expiry, one-time use, rate limit, concurrent consume, unbind/rebind | Binding/delivery database integration test | Bind, unbind, reject ordinary text, bind with a new code | A2/A5/A6 | Automated PASS; tenant pending |
| Every control path claims before effects and uses operation-key idempotency/fencing | Adapter control tests and binding/delivery database integration test | Replay bind/help/group/non-text controls | A2/A5/A6 | Automated PASS |
| SDK event acknowledgement waits for durable processing | `tests/integration/wave3-g3.test.mts` crosses official SDK dispatcher, Adapter and SQLite | Kill during controlled event processing and inspect replay outcome | A5/A6 | Automated PASS |
| Commands and unbound ordinary messages never enter memory | Adapter control tests; database control test asserts zero entries | Tenant help/unbound/group/non-text cases | A5/A6 | Automated PASS; tenant pending |
| Same event/message cannot duplicate Entry or ack/result ledger | Capture ledger integration test; Adapter replay tests; root SDK-to-SQLite replay test | Replay the same message/event and compare sanitized counts | A2/A5/A6 | Automated PASS; tenant pending |
| Bound p2p text reuses the shared `CaptureService` | Adapter message/adapter tests; root SDK-to-SQLite test | Compare one Feishu message with one local Entry | A2/A5/A6 | Automated PASS; tenant pending |
| `ack_only/remember` default; explicit `insight/think` result | Adapter replay/result tests; analysis and insight database tests | One ack-only message and one insight message with a cited result | A2/A5/A6 | Automated PASS; tenant pending |
| Atomic claim returns recipient, payload, owner and fencing; insight payload is pinned | Binding/delivery database test; Adapter claim-payload test; insight pipeline tests | Inspect only sanitized delivery state, never payload text | A2/A5/A6 | Automated PASS |
| Persistent 5s/30s/2m/10m retry, maximum five attempts | Binding/delivery database integration test | Disconnect/reconnect during a confirmed-not-sent send | A2/A5/A6 | Automated PASS; tenant pending |
| Unknown/stale sending becomes ambiguous and is not auto-sent | Binding/delivery test; `tests/integration/wave3-g3.test.mts` closes and reopens SQLite | Create a controlled uncertain send and verify no automatic duplicate | A2/A5/A6 | Automated PASS; tenant pending |
| Fifteen-second single-flight periodic recovery, stale recovery first | Adapter periodic/single-flight/order tests | Leave due work without an event and observe later recovery | A5/A6 | Automated PASS; tenant pending |
| `assume_sent` and one disclosed `retry_once` survive restart | Binding/delivery test; root restart/manual-budget test; settings request policy test | Resolve one real issue from Settings and confirm risk copy | A2/A3/A6 | Automated PASS; UI/tenant manual pending |
| Delivery issue UI excludes body and recipient IDs | Contract schemas, database issue DTO test, preload boundary test | Inspect Settings issue list and screenshots | A2/A3/A6 | DTO automated PASS; rendered UI pending |
| Renderer has no credential read, raw IPC, DB, file or Node capability | `desktop-app/test/ipc.test.ts`; `tests/security/wave3-boundaries.test.mts`; preload runtime smoke | DevTools capability check in packaged Electron | A3/A6 | Static/unit/runtime smoke PASS; packaged G4 check pending |
| Application close is explicitly offline | Adapter disconnect lifecycle test and composition close test | Close app, confirm no active connection or immediate bot reply | A3/A5/A6 | Automated lifecycle PASS; tenant pending |
| No HTTP server or second database | `tests/security/wave3-boundaries.test.mts`; production-source scan | Confirm tenant has no Paopao callback URL or cloud store | A5/A6 | Automated PASS; tenant pending |
| Invalid credential and missing permission are stable and redacted | SDK failure mapping and Settings label tests | Real invalid-secret and restricted-version cases | A5/A3/A6 | Mapping PASS; tenant pending |

## Required Commands

Run from the repository root:

```bash
npm run typecheck
npm run test:contracts
npm run test:unit
npm run test:integration
npm run test:g3
npm run build
npm run rebuild:native
npm run smoke:native
npm run smoke:composition
npm run smoke:preload
```

Windows release validation additionally requires:

```powershell
npm.cmd run dist:win
npm.cmd run smoke:installed
```

Use `docs/runbooks/feishu-tenant-acceptance.md` for the tenant run. Store sanitized evidence outside source fixtures. Never commit credentials or message bodies.

## Current Increment Decision

**G3: DEFERRED (post-MVP increment).** The integrated automated commands and all three Electron smoke checks pass on 2026-08-08, but automation cannot replace M3-04. No real tenant credentials, published tenant app version, token-lifetime soak, or sanitized tenant screenshots/report were available during this review. FT-01 through FT-20 remain `NOT RUN`.

This does not block the desktop MVP. The Feishu increment changes to PASS only after all mandatory tenant cases are recorded as PASS, open connector defects are closed, and the full commands above pass on the integrated revision.
