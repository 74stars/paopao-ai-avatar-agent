import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { EntryDetailV1Schema, EntryListResponseV1Schema, LibrarySummaryV1Schema } from "@paopao/contracts";
import { createCaptureService } from "../../../core/src/index.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createEntryQueryService } from "../../src/database/entry-query.js";
import { createTemporaryDatabase } from "../../src/database/test-database.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
];

const clock = { now: () => "2026-08-06T00:00:00.000Z" };
const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
let idIndex = 0;

try {
  const unitOfWork = new SqliteCaptureUnitOfWork({ database: temporary.database, clock, ids: { next: () => ids[idIndex++] } });
  const capture = createCaptureService({ unitOfWork, clock, events: { publish: () => undefined } });
  const captureOne = await capture.capture({ version: 1, requestId: "10000000-0000-4000-8000-000000000001", source: "desktop", modality: "text", rawText: "第一条英文记录，包含 project-alpha 计划。", mode: "remember", receivedAt: "2026-08-01T00:00:00.000Z", sourceKey: "desktop:10000000-0000-4000-8000-000000000001" });
  const captureTwo = await capture.capture({ version: 1, requestId: "10000000-0000-4000-8000-000000000002", source: "desktop", modality: "text", rawText: "第二条中文记录：阅读《百年孤独》。", mode: "think", receivedAt: "2026-08-02T00:00:00.000Z", sourceKey: "desktop:10000000-0000-4000-8000-000000000002" });
  const captureThree = await capture.capture({ version: 1, requestId: "10000000-0000-4000-8000-000000000003", source: "feishu", modality: "text", rawText: "第三条记录，应该被删除。", mode: "remember", receivedAt: "2026-08-03T00:00:00.000Z", sourceKey: "feishu:message-three", externalRef: { provider: "feishu", appId: "app", tenantKey: "tenant", openId: "open", chatId: "chat", chatType: "p2p", messageId: "message-three", eventId: "event-three", messageKey: "feishu:message-three", eventKey: "feishu:event-three" } });

  temporary.database.prepare("UPDATE entries SET status = 'purged', raw_text = NULL WHERE id = ?").run(captureThree.entryId);
  const classificationId = "20000000-0000-4000-8000-000000000001";
  const summaryId = "20000000-0000-4000-8000-000000000002";
  temporary.database.prepare(`INSERT INTO derivations(id,entry_id,kind,value_json,text_revision,artifact_revision,supersedes_id,is_current,created_by,prompt_version,schema_version,operation_key,created_at)
    VALUES (?,?,'classification',?,1,1,NULL,1,'ai','test/v1','classification.v1','test:classification','2026-08-02T00:01:00.000Z')`)
    .run(classificationId, captureTwo.entryId, JSON.stringify({ inputType: "reading", confidence: 0.9, evidence: "阅读《百年孤独》" }));
  temporary.database.prepare(`INSERT INTO derivations(id,entry_id,kind,value_json,text_revision,artifact_revision,supersedes_id,is_current,created_by,prompt_version,schema_version,operation_key,created_at)
    VALUES (?,?,'summary',?,1,1,NULL,1,'ai','test/v1','summary.v1','test:summary','2026-08-02T00:01:00.000Z')`)
    .run(summaryId, captureTwo.entryId, JSON.stringify({ text: "AI 改写出来的标题", confidence: 0.9, evidence: ["阅读《百年孤独》"] }));
  temporary.database.prepare(`INSERT INTO memories(id,entry_id,memory_type,summary,confidence,classification_derivation_id,summary_derivation_id,updated_at)
    VALUES ('20000000-0000-4000-8000-000000000003',?,'reading','AI 改写出来的标题',0.9,?,?,'2026-08-02T00:01:00.000Z')`)
    .run(captureTwo.entryId, classificationId, summaryId);

  const query = createEntryQueryService(temporary.database);
  const firstPage = query.list({ version: 1, limit: 1 });
  EntryListResponseV1Schema.parse(firstPage);
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.items[0]?.id, captureTwo.entryId);
  assert.equal(firstPage.items[0]?.title, "第二条中文记录：阅读《百年孤独》");
  assert.equal(firstPage.items[0]?.currentTextPreview, "第二条中文记录：阅读《百年孤独》。");
  assert.equal(firstPage.items[0]?.summary, "AI 改写出来的标题");
  assert.ok(firstPage.nextCursor);

  const secondPage = query.list({ version: 1, limit: 1, cursor: firstPage.nextCursor ?? undefined });
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0]?.id, captureOne.entryId);
  assert.equal(secondPage.nextCursor, null);

  assert.equal(query.list({ version: 1, query: "project-alpha" }).items[0]?.id, captureOne.entryId);
  assert.equal(query.list({ version: 1, query: "孤独" }).items[0]?.id, captureTwo.entryId);
  assert.equal(query.list({ version: 1, query: "阅" }).items[0]?.id, captureTwo.entryId);
  assert.equal(query.list({ version: 1, sources: ["feishu"] }).items.length, 0);

  temporary.database.prepare("INSERT INTO entry_text_revisions(entry_id, revision, text, checksum, created_by, operation_key, created_at) VALUES (?, 2, ?, ?, 'user', ?, ?)").run(captureOne.entryId, "当前 revision 的正文", "checksum2", "test:revision:2", "2026-08-04T00:00:00.000Z");
  temporary.database.prepare("UPDATE entries SET current_text_revision = 2, updated_at = ? WHERE id = ?").run("2026-08-04T00:00:00.000Z", captureOne.entryId);
  temporary.database.prepare("UPDATE jobs SET status='failed_final', last_error_code='AI_INVALID_OUTPUT' WHERE id=?").run(captureOne.jobId);
  const detail = query.get(captureOne.entryId);
  EntryDetailV1Schema.parse(detail);
  assert.equal(detail.rawText, "第一条英文记录，包含 project-alpha 计划。");
  assert.equal(detail.currentText, "当前 revision 的正文");
  assert.deepEqual(detail.textRevisions.map((revision) => revision.revision), [1, 2]);
  assert.equal(detail.derivations.length, 0);
  assert.equal(detail.memory, null);
  assert.deepEqual(detail.activeJobs, [{ id: captureOne.jobId, type: "analyze_entry", status: "failed_final", attempts: 0, nextRunAt: "2026-08-01T00:00:00.000Z", lastErrorCode: "AI_INVALID_OUTPUT" }]);

  const summary = query.summary();
  LibrarySummaryV1Schema.parse(summary);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.shelves, [{ type: "reading", count: 1 }]);

  assert.throws(() => query.list({ version: 1, cursor: "not-a-cursor" }), /Invalid entry cursor/);
  console.log("entry query integration passed");
} finally {
  temporary.close();
}
