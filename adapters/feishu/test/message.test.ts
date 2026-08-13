import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  controlKindForMessage,
  feishuEventKey,
  feishuMessageKey,
  normalizeFeishuEvent,
  parseCommand,
  toCaptureCommand,
} from "../src/index.js";

const NOW = "2026-08-08T00:00:00.000Z";

function event(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "evt-1",
    app_id: "cli-app",
    tenant_key: "tenant-1",
    sender: { sender_type: "user", sender_id: { open_id: "ou-1" } },
    message: {
      message_id: "om-1",
      create_time: "1786147200000",
      chat_id: "oc-1",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "synthetic note" }),
    },
    ...overrides,
  };
}

test("canonical keys use the frozen NUL-delimited input", () => {
  const messageDigest = createHash("sha256").update("cli-app\0tenant-1\0om-1").digest("hex");
  const eventDigest = createHash("sha256").update("cli-app\0evt-1").digest("hex");
  assert.equal(feishuMessageKey("cli-app", "tenant-1", "om-1"), `feishu:sha256(${messageDigest})`);
  assert.equal(feishuEventKey("cli-app", "evt-1"), `feishu:sha256(${eventDigest})`);
});

test("normalizes a p2p text event and maps it to CaptureCommandV1", () => {
  const normalized = normalizeFeishuEvent(event(), "cli-app", NOW);
  assert.ok(normalized);
  assert.equal(normalized.text, "synthetic note");
  assert.equal(normalized.chatType, "p2p");
  const command = toCaptureCommand(normalized, "think", "00000000-0000-4000-8000-000000000001");
  assert.equal(command.source, "feishu");
  assert.equal(command.sourceKey, normalized.messageKey);
  assert.equal(command.externalRef?.eventKey, normalized.eventKey);
  assert.equal(command.mode, "think");
});

test("rejects missing routing fields and a mismatched app id", () => {
  assert.equal(normalizeFeishuEvent(event({ event_id: undefined, uuid: undefined }), "cli-app", NOW), null);
  assert.equal(normalizeFeishuEvent(event({ app_id: "another-app" }), "cli-app", NOW), null);
  assert.equal(normalizeFeishuEvent(event({ sender: { sender_type: "user", sender_id: {} } }), "cli-app", NOW), null);
});

test("invalid text JSON is an unsupported control message, never placeholder Capture text", () => {
  const raw = event();
  raw.message.content = "not-json";
  const normalized = normalizeFeishuEvent(raw, "cli-app", NOW);
  assert.ok(normalized);
  assert.equal(normalized.text, null);
  assert.equal(controlKindForMessage(normalized), "unsupported_message");
});

test("parses binding controls without treating ordinary text as a command", () => {
  assert.deepEqual(parseCommand(" /bind 123456 "), { kind: "bind", code: "123456" });
  assert.deepEqual(parseCommand("/unbind"), { kind: "unbind" });
  assert.deepEqual(parseCommand("帮助"), { kind: "help" });
  assert.deepEqual(parseCommand("/unknown"), { kind: "help" });
  assert.equal(parseCommand("ordinary text"), null);
});

test("group and non-text messages are classified before binding or Capture", () => {
  const group = normalizeFeishuEvent(event({
    message: { ...event().message, chat_type: "group" },
  }), "cli-app", NOW);
  assert.ok(group);
  assert.equal(controlKindForMessage(group), "p2p_only");

  const image = normalizeFeishuEvent(event({
    message: { ...event().message, message_type: "image", content: "{}" },
  }), "cli-app", NOW);
  assert.ok(image);
  assert.equal(controlKindForMessage(image), "unsupported_message");
});
