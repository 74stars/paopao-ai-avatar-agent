import { createHash } from "node:crypto";
import type { CaptureCommandV1 } from "@paopao/contracts";
import type { ControlKind, FeishuRecipient } from "@paopao/core";
import type { RawFeishuMessageEvent } from "./types.js";

export interface NormalizedFeishuMessage {
  appId: string;
  tenantKey: string;
  openId: string;
  eventId: string;
  eventKey: string;
  messageId: string;
  messageKey: string;
  chatId: string;
  chatType: "p2p" | "group";
  messageType: string;
  text: string | null;
  receivedAt: string;
  senderType: string;
  recipient: FeishuRecipient;
}

export type ParsedCommand =
  | { kind: "bind"; code: string }
  | { kind: "unbind" }
  | { kind: "help" }
  | null;

export function feishuMessageKey(appId: string, tenantKey: string, messageId: string): string {
  return `feishu:sha256(${createHash("sha256").update(`${appId}\0${tenantKey}\0${messageId}`).digest("hex")})`;
}

export function feishuEventKey(appId: string, eventId: string): string {
  return `feishu:sha256(${createHash("sha256").update(`${appId}\0${eventId}`).digest("hex")})`;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function receivedAt(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const milliseconds = Number(value);
  const date = Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function extractText(content: string | undefined): string | null {
  if (typeof content !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { text?: unknown }).text !== "string") return null;
    return (parsed as { text: string }).text;
  } catch {
    return null;
  }
}

export function normalizeFeishuEvent(
  raw: RawFeishuMessageEvent,
  configuredAppId: string,
  fallbackNow: string,
): NormalizedFeishuMessage | null {
  const eventId = nonEmpty(raw.event_id) ?? nonEmpty(raw.uuid);
  const messageId = nonEmpty(raw.message?.message_id);
  const tenantKey = nonEmpty(raw.tenant_key) ?? nonEmpty(raw.sender?.tenant_key);
  const openId = nonEmpty(raw.sender?.sender_id?.open_id);
  const chatId = nonEmpty(raw.message?.chat_id);
  const messageType = nonEmpty(raw.message?.message_type);
  const appId = nonEmpty(raw.app_id);
  const chatType = raw.message?.chat_type === "p2p" ? "p2p" : raw.message?.chat_type === "group" ? "group" : null;

  if (appId && appId !== configuredAppId) return null;
  if (!eventId || !messageId || !tenantKey || !openId || !chatId || !chatType || !messageType) return null;

  const text = messageType === "text" ? extractText(raw.message?.content) : null;
  return {
    appId: configuredAppId,
    tenantKey,
    openId,
    eventId,
    eventKey: feishuEventKey(configuredAppId, eventId),
    messageId,
    messageKey: feishuMessageKey(configuredAppId, tenantKey, messageId),
    chatId,
    chatType,
    messageType,
    text,
    receivedAt: receivedAt(raw.message?.create_time ?? raw.create_time, fallbackNow),
    senderType: raw.sender?.sender_type ?? "",
    recipient: {
      appId: configuredAppId,
      tenantKey,
      openId,
      chatId,
      chatType,
      messageId,
    },
  };
}

export function parseCommand(text: string): ParsedCommand {
  const normalized = text.trim();
  const bind = /^\/bind(?:\s+(.+))?$/i.exec(normalized);
  if (bind) return { kind: "bind", code: bind[1]?.trim() ?? "" };
  if (/^\/unbind\s*$/i.test(normalized)) return { kind: "unbind" };
  if (/^(?:\/help|help|帮助)\s*$/i.test(normalized) || normalized.startsWith("/")) return { kind: "help" };
  return null;
}

export function toCaptureCommand(
  message: NormalizedFeishuMessage,
  mode: "remember" | "think",
  requestId: string,
): CaptureCommandV1 {
  if (message.chatType !== "p2p" || message.text === null) throw new Error("Message is not capturable");
  return {
    version: 1,
    requestId,
    source: "feishu",
    modality: "text",
    rawText: message.text,
    mode,
    receivedAt: message.receivedAt,
    sourceKey: message.messageKey,
    externalRef: {
      provider: "feishu",
      appId: message.appId,
      tenantKey: message.tenantKey,
      openId: message.openId,
      chatId: message.chatId,
      chatType: "p2p",
      messageId: message.messageId,
      eventId: message.eventId,
      messageKey: message.messageKey,
      eventKey: message.eventKey,
    },
  };
}

export function controlKindForMessage(message: NormalizedFeishuMessage): ControlKind | null {
  if (message.chatType !== "p2p") return "p2p_only";
  if (message.messageType !== "text" || message.text === null) return "unsupported_message";
  const command = parseCommand(message.text);
  return command?.kind ?? null;
}
