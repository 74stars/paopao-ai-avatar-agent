import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimedExternalDelivery } from "@paopao/core";
import { renderDeliveryText } from "../src/reply.js";

function insightDelivery(text: string): ClaimedExternalDelivery {
  return {
    messageKey: "message-key",
    entryId: "00000000-0000-4000-8000-000000000001",
    phase: "result",
    attempts: 0,
    owner: "test-worker",
    fencingToken: 1,
    recipient: { appId: "app", tenantKey: "tenant", openId: "open", chatId: "chat", chatType: "p2p", messageId: "message" },
    derivationId: "00000000-0000-4000-8000-000000000002",
    payload: {
      kind: "insight",
      reply: { schemaVersion: "insight-reply.v1", text, grounding: "no_relevant_memory", citations: [] },
    },
  };
}

test("renders normal insight text", () => {
  assert.match(renderDeliveryText(insightDelivery("可以先完成一小步。")), /可以先完成一小步/);
});

test("does not deliver model meta commentary or serialized output", () => {
  const canary = "schemaVersion";
  const rendered = renderDeliveryText(insightDelivery(`As an AI, I followed the system prompt and returned ${canary}.`));
  assert.equal(rendered, "洞察暂不可用，请在泡泡中重新生成。");
  assert.equal(rendered.includes(canary), false);
});
