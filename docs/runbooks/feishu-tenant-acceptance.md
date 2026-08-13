# Feishu Real-Tenant Acceptance Runbook

Status: **DEFERRED / NOT EXECUTED**  
Gate impact: none for the desktop MVP; required before a future Feishu connector release  
Owners: A5 execution support, A6 evidence and release decision

This post-MVP runbook must be executed against an enterprise self-built Feishu application before the connector is released. Fake SDKs, local mocks and CI credentials do not satisfy M3-04.

## Evidence Rules

Never place any of the following in this report, screenshots, filenames, terminal captures or committed artifacts:

- App Secret, tenant/access/refresh tokens, authorization headers or encrypted credential blobs.
- Message body, Entry raw text, insight text, evidence quotes or full Prompt content.
- Full App ID, tenant key, open ID, chat ID, message ID or external reply ID.
- Raw Feishu event payloads or provider error bodies.

Use a synthetic test message. Evidence should contain only case ID, UTC time, app version, OS version, masked App ID, stable status/error code, sanitized local counts and pass/fail. Crop chat content from screenshots. Hash any correlation key before including it in the report.

## Tenant Setup

1. Create an enterprise self-built application and enable bot capability.
2. Grant the least-privilege scopes below:

| Scope | Purpose | Required |
|---|---|---|
| `im:message.p2p_msg:readonly` | Receive p2p messages | Yes |
| `im:message:send_as_bot` | Send control, saved ack and insight replies | Yes |
| `im:message.group_at_msg:readonly` | Return the p2p-only restriction for a group mention | Only for the group restriction case |

3. Select long-connection event delivery and subscribe to `im.message.receive_v1`.
4. Do not configure a Paopao HTTP callback URL.
5. Publish an application version restricted to named test users or a dedicated test department. Record the human-readable scope description, not user IDs.
6. Confirm the desktop build under test stores its only production data in local Paopao SQLite. Do not configure a cloud database.

## Preconditions

- [ ] G2 evidence is available and the desktop Capture path passes.
- [ ] App version/commit and contract/schema versions are recorded.
- [ ] Test OS, Electron version and package type are recorded.
- [ ] A fresh synthetic binding code can be generated.
- [ ] Logs are redacted and official SDK logging does not emit credentials or payloads.
- [ ] The operator knows how to restore the required permission set after the negative permission case.

## Mandatory Cases

Record `PASS` or `FAIL`; do not use partial-pass language.

| ID | Procedure | Expected result | Result | Sanitized evidence reference |
|---|---|---|---|---|
| FT-01 | Save App ID/Secret through Settings and connect | Status reaches `connected`; public UI shows only masked App ID | NOT RUN | |
| FT-02 | Disconnect explicitly, then reconnect | Status moves through disconnected/connecting and returns connected | NOT RUN | |
| FT-03 | Generate a binding code and send `/bind <code>` in p2p | One bound reply; code is not recoverable from history or DB | NOT RUN | |
| FT-04 | Replay the same bind event/message using the approved test mechanism | No second binding effect and no second reply | NOT RUN | |
| FT-05 | In default `ack_only`, send one synthetic p2p text | Exactly one local Entry and one saved ack; no result reply | NOT RUN | |
| FT-06 | Replay FT-05 as the same event and as a new event for the same message | Entry, ack ledger and sent reply counts remain one | NOT RUN | |
| FT-07 | Enable `insight`, then send a new synthetic p2p text | One Entry, one ack, and at most one cited result after insight readiness | NOT RUN | |
| FT-08 | Send `/help`, a group mention and a non-text p2p message | One appropriate control reply per message; zero Entries | NOT RUN | |
| FT-09 | Send `/unbind`, then ordinary p2p text | One unbound reply; ordinary text receives binding-required control and creates no Entry | NOT RUN | |
| FT-10 | Generate a new code and bind again | New binding succeeds once; previous code cannot be reused | NOT RUN | |
| FT-11 | Disconnect network while connected, then restore it | Redacted status reaches reconnecting then connected; due confirmed-not-sent work resumes without duplicates | NOT RUN | |
| FT-12 | Create an uncertain send outcome under controlled fault injection | Delivery becomes ambiguous and is not automatically sent again | NOT RUN | |
| FT-13 | From Settings, apply `assume_sent` to one issue | Issue closes without a send; no body or recipient ID is visible | NOT RUN | |
| FT-14 | On a separate issue, accept the duplicate-risk disclosure and use `retry_once` | Exactly one manual send claim; a second retry is refused | NOT RUN | |
| FT-15 | Sleep and resume the system | Client is recreated, status recovers, persistent scan resumes, next message is captured once | NOT RUN | |
| FT-16 | Keep the connection through a tenant-token lifetime, then send a message | SDK refreshes credentials in memory and message flow still works once | NOT RUN | |
| FT-17 | Save a deliberately invalid temporary secret and connect | Stable `FEISHU_AUTH_FAILED`/credential-error state; no secret in logs or UI | NOT RUN | |
| FT-18 | Publish a temporary version without send permission and trigger a reply | Stable `FEISHU_PERMISSION_DENIED`; no raw provider body; restore permission afterward | NOT RUN | |
| FT-19 | Exit Paopao while connected | Intake stops and the bot gives no immediate Paopao reply while the app is closed; product makes no offline-delivery promise | NOT RUN | |
| FT-20 | Reopen after FT-19 | Startup recovery scans persistent due work without duplicating prior Entry/replies; record actual platform behavior for messages sent while closed without promising compensation | NOT RUN | |

## Security Inspection

- [ ] Credential file does not contain the App Secret in plaintext.
- [ ] SQLite, logs, diagnostics export and user export contain no Secret or Token.
- [ ] Delivery issue UI contains no message body, quote, open ID, chat ID or message ID.
- [ ] Renderer DevTools has no `require`, `process`, database/file API, raw `ipcRenderer` or credential read method.
- [ ] No Paopao HTTP listener is active and no callback URL was configured.
- [ ] No Paopao cloud/second database was used.
- [ ] Closing/deleting Feishu credentials clears the active client/token cache and leaves status disconnected/not configured.

## Report Template

```text
Report ID:
Execution UTC start/end:
Tester:
App version / commit:
Contract version:
Database schema version:
Electron version:
OS and architecture:
Package type: development | packaged
Tenant alias (non-identifying):
Published scope description (no IDs):
Masked App ID:

Case results: FT-01 ... FT-20
Automated command report reference:
Sanitized screenshot/artifact references:
Defects raised:
Residual risks:

M3-04 decision: PASS | FAIL
G3 recommendation: PASS | FAIL
A6 sign-off and UTC time:
Product owner sign-off and UTC time:
```

Any missing mandatory case, forbidden evidence, connector defect, or unverified real-tenant result prevents the Feishu increment from shipping. It does not affect desktop MVP acceptance under ADR 0004.
