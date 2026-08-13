import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptureUnavailableDuringRestoreError, createDesktopRestoreLifecycle } from "../../src/backup/restore-lifecycle.js";

test("restore lifecycle closes capture before quiescing and only reopens after workers restart", async () => {
  const calls: string[] = [];
  const lifecycle = createDesktopRestoreLifecycle({
    async stopWorkers() { calls.push("stop"); },
    closeDatabase() { calls.push("close"); },
    async reopenDatabase() { calls.push("reopen"); },
    startWorkers() { calls.push("start"); },
    availabilityChanged(value) { calls.push(value); },
  });
  lifecycle.assertCaptureAvailable();
  await lifecycle.quiesceForRestore();
  assert.equal(lifecycle.availability(), "restoring");
  assert.throws(() => lifecycle.assertCaptureAvailable(), CaptureUnavailableDuringRestoreError);
  await lifecycle.resumeAfterDatabaseOpen("restored");
  lifecycle.assertCaptureAvailable();
  assert.deepEqual(calls, ["restoring", "stop", "close", "reopen", "start", "available"]);
});

test("failed reopen remains unavailable and cannot report false restore success", async () => {
  const lifecycle = createDesktopRestoreLifecycle({ async stopWorkers() {}, closeDatabase() {}, async reopenDatabase() { throw new Error("open failed"); }, startWorkers() {} });
  await lifecycle.quiesceForRestore();
  await assert.rejects(() => lifecycle.resumeAfterDatabaseOpen("restored"), /open failed/);
  assert.equal(lifecycle.availability(), "unavailable");
  assert.throws(() => lifecycle.assertCaptureAvailable(), CaptureUnavailableDuringRestoreError);
});
