import assert from "node:assert/strict";
import http from "node:http";

const DEFAULT_MODEL = "gpt-4o-mini-2024-07-18";
const MAX_INPUT_CODE_POINTS = 50_000;
const DEFAULT_TIMEOUT_MS = 20_000;

function mapProviderFailure({ status, body, timedOut = false }) {
  if (timedOut) return { code: "AI_TIMEOUT", retryable: true };
  if (status === 401 || status === 403) return { code: "AI_AUTH_FAILED", retryable: false };
  if (status === 429) return { code: "AI_RATE_LIMITED", retryable: true };
  if (status >= 500) return { code: "AI_NETWORK_ERROR", retryable: true };
  if (status === 400 && body?.error?.code === "context_length_exceeded") {
    return { code: "AI_INPUT_TOO_LARGE", retryable: false };
  }
  if (body?.error?.code === "content_filter" || body?.error?.type === "safety") {
    return { code: "AI_SAFETY_BLOCKED", retryable: false };
  }
  return { code: "AI_INVALID_OUTPUT", retryable: true };
}

async function run() {
  const requests = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(raw),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: "mock-request-1",
        choices: [{ message: { content: JSON.stringify({ schemaVersion: "memory-analysis.v1" }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const payload = {
    model: DEFAULT_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "user data" },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "paopao_memory_analysis_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { schemaVersion: { type: "string", const: "memory-analysis.v1" } },
          required: ["schemaVersion"],
        },
      },
    },
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), DEFAULT_TIMEOUT_MS);
  const result = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-key-never-persisted",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: abort.signal,
  });
  clearTimeout(timer);
  const responseBody = await result.json();
  server.close();

  assert.equal(result.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/chat/completions");
  assert.equal(requests[0].authorization, "Bearer test-key-never-persisted");
  assert.equal(requests[0].body.model, DEFAULT_MODEL);
  assert.equal(requests[0].body.response_format.json_schema.strict, true);
  assert.equal(responseBody.usage.prompt_tokens, 12);

  assert.equal([..."a".repeat(MAX_INPUT_CODE_POINTS)].length, MAX_INPUT_CODE_POINTS);
  assert.equal(mapProviderFailure({ timedOut: true }).code, "AI_TIMEOUT");
  assert.equal(mapProviderFailure({ status: 429 }).code, "AI_RATE_LIMITED");
  assert.equal(mapProviderFailure({ status: 401 }).code, "AI_AUTH_FAILED");
  assert.equal(mapProviderFailure({ status: 400, body: { error: { code: "context_length_exceeded" } } }).code, "AI_INPUT_TOO_LARGE");
  assert.equal(mapProviderFailure({ status: 400, body: { error: { code: "content_filter" } } }).code, "AI_SAFETY_BLOCKED");
  assert.equal(mapProviderFailure({ status: 200, body: {} }).code, "AI_INVALID_OUTPUT");

  console.log("provider-openai-spike passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
