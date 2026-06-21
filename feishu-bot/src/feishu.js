import crypto from "node:crypto";
import { config } from "./config.js";

let tenantTokenCache = {
  token: "",
  expiresAt: 0,
};

export function verifyEventToken(body) {
  if (!config.feishu.verificationToken) return true;
  return body?.token === config.feishu.verificationToken || body?.header?.token === config.feishu.verificationToken;
}

export async function getTenantAccessToken() {
  const now = Date.now();
  if (tenantTokenCache.token && tenantTokenCache.expiresAt > now + 60_000) {
    return tenantTokenCache.token;
  }

  if (!config.feishu.appId || !config.feishu.appSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    }),
  });
  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Failed to get tenant token: ${JSON.stringify(data)}`);
  }

  tenantTokenCache = {
    token: data.tenant_access_token,
    expiresAt: now + Number(data.expire || 7200) * 1000,
  };
  return tenantTokenCache.token;
}

export async function sendFeishuText({ receiveId, receiveIdType, text }) {
  const token = await getTenantAccessToken();
  const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Failed to send Feishu message: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function sendCustomBotText(text) {
  if (!config.feishu.customBotWebhook) {
    throw new Error("Missing FEISHU_CUSTOM_BOT_WEBHOOK");
  }

  const payload = {
    msg_type: "text",
    content: { text },
  };

  if (config.feishu.customBotSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${timestamp}\n${config.feishu.customBotSecret}`;
    payload.timestamp = timestamp;
    payload.sign = crypto.createHmac("sha256", stringToSign).update("").digest("base64");
  }

  const response = await fetch(config.feishu.customBotWebhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (data.code && data.code !== 0) {
    throw new Error(`Failed to send custom bot message: ${JSON.stringify(data)}`);
  }
  return data;
}

export function extractTextMessage(body) {
  const event = body?.event;
  const message = event?.message;
  if (!message) return null;

  let text = "";
  if (message.message_type === "text") {
    try {
      text = JSON.parse(message.content).text || "";
    } catch {
      text = message.content || "";
    }
  } else {
    text = `[${message.message_type}] 暂未解析的多模态消息`;
  }

  return {
    text,
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: event?.sender?.sender_id,
    createTime: message.create_time,
    raw: body,
  };
}

