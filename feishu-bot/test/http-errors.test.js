import assert from "node:assert/strict";
import test from "node:test";
import { publicHttpFailure, publicHttpFailureLog } from "../src/http-errors.js";

test("HTTP failures never expose upstream error details", () => {
  const secret = "UPSTREAM_CANARY_SECRET";
  const failure = publicHttpFailure(new Error(`vendor failed: {\"token\":\"${secret}\"}`), "correlation-1");
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, { error: { code: "INTERNAL_ERROR", message: "请求未能完成。", correlationId: "correlation-1" } });
  assert.equal(JSON.stringify(failure).includes(secret), false);
  assert.equal(publicHttpFailureLog(failure).includes(secret), false);
});

test("malformed JSON receives a stable client error", () => {
  const failure = publicHttpFailure(new SyntaxError("Unexpected token with private input"), "correlation-2");
  assert.equal(failure.status, 400);
  assert.deepEqual(failure.body.error, { code: "INVALID_REQUEST", message: "请求内容格式有误。", correlationId: "correlation-2" });
});
