# Paopao Feishu Adapter

This workspace owns the local Electron Main Feishu long-connection adapter. It uses
`@larksuiteoapi/node-sdk@1.72.0` `WSClient`; it does not start an HTTP callback server
or maintain a second database.

## Composition

```ts
import { createFeishuAdapter } from "@paopao/feishu-adapter";
import {
  createSqliteBindingService,
  createSqliteExternalDeliveryService,
} from "@paopao/infrastructure";

const bindingService = createSqliteBindingService({ database, clock });
const deliveryService = createSqliteExternalDeliveryService({ database, clock });

const adapter = createFeishuAdapter({
  credentialProvider,
  captureService,
  bindingService,
  deliveryService,
  publicSettingsProvider,
  subscribeDomainEvents,
  logger,
  clock,
});

const unsubscribeStatus = adapter.subscribeStatus((event) => events.publish(event));
// Electron powerMonitor "resume": await adapter.checkConnectionAfterWake();
await adapter.connect();
```

The required factory dependency object is exactly the frozen v1 Main-only contract.
The optional second factory argument only injects transport/timing test facilities.

Public connection status is one of `not_configured`, `disconnected`, `connecting`,
`connected`, `reconnecting`, or `error`. `status()` returns that enum. The optional
structural-superset `subscribeStatus()` emits the redacted v1 event:

```ts
{
  version: 1;
  type: "feishu:status";
  status: FeishuConnectionStatus;
  errorCode?: ErrorCode;
  occurredAt: string;
}
```

`connect()` rejects with a redacted `FeishuAdapterError(code, retryable)` for explicit
connection failures. Credentials are exposed only through
`credentialProvider.getFeishuCredential()`. Main persists public
`feishu.appId`/`feishu.replyMode`; `credentials.v1.json` stores only
`feishu.encryptedAppSecret`. There is no Tenant Token storage key. The SDK token cache
is scoped to the current client object and discarded on disconnect/recreation.

## Reliability Boundaries

- Message key: `sha256(appId + NUL + tenantKey + NUL + messageId)`.
- Event key: `sha256(appId + NUL + eventId)`.
- Only bound user `p2p` text reaches `CaptureService`; the source key is the message key.
- The SDK dispatcher awaits the same control/Capture business promise that shutdown
  drains. A persistence failure rejects the handler so Feishu can replay the event;
  the Adapter never acknowledges a fire-and-forget database operation.
- `WSClient.start()` resolution is not treated as connectivity. The transport waits for
  the real SDK `onReady` callback, with a 15-second readiness timeout, before Adapter
  status becomes connected or intake/scanning is enabled. Pending readiness is aborted
  immediately by disconnect. Official App IDs must match `cli_[0-9a-fA-F]{16}`.
- Bind/unbind/help/unbound/group/non-text paths claim the durable control ledger before
  any operation. Binding operation keys are `control:<messageKey>:<kind>`.
- Delivery discovery reads references only. Recipient and reply payload always come
  from the atomic `claimReply()` result.
- Startup, reconnect, control completion, `insight:ready`, and the 15-second timer all
  use one single-flight durable scanner. Every scan recovers stale claims first.
- Official send timeout is 45 seconds under the default 60-second reply lease. A timeout
  is `unknown`, so it becomes ambiguous and is never automatically resent.
- Provider idempotent send is deliberately reported as unsupported. The SDK `uuid`
  request field is not used because its delivery semantics have not been accepted as a
  release guarantee.
- Connection retry uses bounded jittered backoff. Delivery retry never uses an in-memory
  queue; A2's persistent ledger owns retry timing and manual issue handling.

## Shutdown

Application exit and restore quiescing use this order:

1. Reject new application writes.
2. `await adapter.disconnect()` to stop Feishu intake, cancel scanner/reconnect timers,
   drain in-flight event/delivery work, drop SDK clients/token cache, unsubscribe Core
   events, and call `clearDecryptedCache("feishu")`.
3. Stop and drain the Worker.
4. Checkpoint/close or replace the database.

After a restore, restart Worker first, then call `adapter.connect()`. At final Main
shutdown, call the `unsubscribeStatus` function after disconnect.

## Tenant Setup And Manual Acceptance

Create an enterprise self-built application and enable bot capability. Use least-privilege
scopes:

- `im:message.p2p_msg:readonly` to receive user p2p messages.
- `im:message.group_at_msg:readonly` only to return the MVP p2p-only restriction when the
  bot is mentioned in a group.
- `im:message:send_as_bot` to send control, saved acknowledgement, and insight replies.

Select long-connection event delivery and subscribe to `im.message.receive_v1`. Publish
an application version whose availability is restricted to the intended test users or
department. Do not configure a Paopao HTTP event URL.

Run the following with synthetic text. Evidence must mask App ID and user/chat/message
identifiers and must not contain App Secret, Tenant Token, access token, or message text.

1. Save App ID/App Secret in desktop settings and connect; verify `connected`.
2. Generate a one-time code, send `/bind <code>`, and verify one success reply. Replay
   the same event/message and verify no second binding action/reply.
3. Send p2p text in `ack_only`; verify one local Entry and one saved acknowledgement.
4. Enable `insight`, send new p2p text, and verify one acknowledgement plus at most one
   cited result after `insight:ready`.
5. Send a group mention and a non-text p2p message; verify restriction replies and no Entry.
6. Disconnect the network and restore it; verify `reconnecting` then `connected`, and that
   durable retry-wait work resumes without duplicates.
7. Sleep and resume the system; verify `checkConnectionAfterWake()` recreates the SDK
   client and durable scanning resumes.
8. Test an invalid secret and a version missing send permission; verify stable redacted
   auth/permission status and no credential in logs.
9. Send `/unbind`, verify ordinary text is rejected as unbound, then bind using a new code.
10. Exit the application; verify long connection is offline and no message intake is
    promised while Paopao is closed.
