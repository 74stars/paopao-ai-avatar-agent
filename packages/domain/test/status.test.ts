import assert from "node:assert/strict";
import { canTransitionEntry, canTransitionJob, transitionEntryStatus, transitionJobStatus } from "../src/index.js";

assert.equal(canTransitionEntry("stored", "processing"), true);
assert.equal(canTransitionEntry("purged", "processing"), false);
assert.equal(transitionEntryStatus("failed_final", "processing"), "processing");
assert.throws(() => transitionEntryStatus("ready", "processing"));
assert.equal(canTransitionJob("waiting_for_network", "queued"), true);
assert.equal(transitionJobStatus("queued", "running"), "running");
assert.throws(() => transitionJobStatus("succeeded", "running"));
