import http from "node:http";
import { config } from "./config.js";
import { appendRawEvent, ensureStore } from "./store.js";
import { extractTextMessage, sendCustomBotText, sendFeishuText, verifyEventToken } from "./feishu.js";
import { morningMessage, nightlyMessage, processUserInput } from "./paopao.js";

await ensureStore();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, service: "paopao-feishu-bot" });
    }

    if (req.method === "POST" && req.url === "/feishu/events") {
      const body = await readJson(req);

      if (body.type === "url_verification") {
        if (!verifyEventToken(body)) return json(res, 401, { error: "invalid token" });
        return json(res, 200, { challenge: body.challenge });
      }

      if (!verifyEventToken(body)) return json(res, 401, { error: "invalid token" });

      await appendRawEvent({ kind: "feishu_event", body });
      const message = extractTextMessage(body);
      if (message) {
        await appendRawEvent({ kind: "user_message", message });
        const reply = await processUserInput(message);
        const receiveId = message.senderId?.open_id || config.feishu.defaultReceiveId;
        const receiveIdType = message.senderId?.open_id ? "open_id" : config.feishu.defaultReceiveIdType;
        if (receiveId) {
          await sendFeishuText({ receiveId, receiveIdType, text: reply });
        }
      }

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/tasks/morning") {
      await pushMessage(morningMessage());
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/tasks/nightly") {
      await pushMessage(nightlyMessage());
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Paopao Feishu bot listening on http://127.0.0.1:${config.port}`);
});

async function pushMessage(text) {
  if (config.feishu.defaultReceiveId) {
    return sendFeishuText({
      receiveId: config.feishu.defaultReceiveId,
      receiveIdType: config.feishu.defaultReceiveIdType,
      text,
    });
  }
  return sendCustomBotText(text);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

