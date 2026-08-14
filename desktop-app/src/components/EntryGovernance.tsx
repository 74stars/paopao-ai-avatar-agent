import { useEffect, useMemo, useState } from "react";
import type { EntryCorrectRequestV1, EntryDetailV1, ErrorCode, MemoryType } from "@paopao/contracts";
import { retryableJobs } from "./library-detail";
import { shelfMeta, shelfOrder } from "./LibraryShelf";
import { userErrorMessage } from "../error-messages";

type ClassificationDerivation = Extract<EntryDetailV1["derivations"][number], { kind: "classification" }>;
type SummaryDerivation = Extract<EntryDetailV1["derivations"][number], { kind: "summary" }>;

export const DELETE_EXPORT_NOTICE = "记录会从当前数据、搜索、自动备份和后续导出中移除；已经复制到其他位置的旧导出不会被删除。";

export function EntryGovernance({ detail, onUpdated, onDeleted }: { detail: EntryDetailV1; onUpdated(): Promise<void>; onDeleted(): Promise<void> }) {
  const classification = useMemo(() => detail.derivations.find((item): item is ClassificationDerivation => item.kind === "classification" && item.isCurrent), [detail.derivations]);
  const summary = useMemo(() => detail.derivations.find((item): item is SummaryDerivation => item.kind === "summary" && item.isCurrent), [detail.derivations]);
  const [memoryType, setMemoryType] = useState<MemoryType>(classification?.value.inputType ?? "other");
  const [summaryText, setSummaryText] = useState(summary?.value.text ?? "");
  const [busy, setBusy] = useState<"classification" | "summary" | "retry" | "delete" | null>(null);
  const [message, setMessage] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setMemoryType(classification?.value.inputType ?? "other");
    setSummaryText(summary?.value.text ?? "");
  }, [classification?.id, classification?.value.inputType, summary?.id, summary?.value.text]);

  async function saveClassification() {
    if (!window.paopao || !classification || busy || memoryType === classification.value.inputType) return;
    setBusy("classification");
    setMessage("");
    const input: EntryCorrectRequestV1 = {
      version: 1,
      requestId: crypto.randomUUID(),
      entryId: detail.id,
      kind: "classification",
      expectedDerivationId: classification.id,
      value: { ...classification.value, inputType: memoryType }
    };
    await finish(await window.paopao.entries.correct(input), "分类已更新。");
  }

  async function saveSummary() {
    if (!window.paopao || !summary || busy || !summaryText.trim() || summaryText === summary.value.text) return;
    setBusy("summary");
    setMessage("");
    const input: EntryCorrectRequestV1 = {
      version: 1,
      requestId: crypto.randomUUID(),
      entryId: detail.id,
      kind: "summary",
      expectedDerivationId: summary.id,
      value: { ...summary.value, text: summaryText }
    };
    await finish(await window.paopao.entries.correct(input), "整理摘要已更新。");
  }

  async function retry(jobId: string) {
    if (!window.paopao || busy) return;
    setBusy("retry");
    setMessage("");
    await finish(await window.paopao.jobs.retry({ version: 1, jobId }), "已重新提交处理。");
  }

  async function deleteEntry() {
    if (!window.paopao || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setMessage(`再次点击确认删除。${DELETE_EXPORT_NOTICE}`);
      return;
    }
    setBusy("delete");
    setMessage("");
    const result = await window.paopao.entries.delete({ version: 1, requestId: crypto.randomUUID(), entryId: detail.id, expectedTextRevision: detail.textRevisions.at(-1)?.revision ?? 1, confirmation: "DELETE" });
    setBusy(null);
    if (!result.ok) {
      setMessage(result.error.code === "REVISION_CONFLICT" ? "记录内容已更新，请重新确认删除。" : userErrorMessage(result.error, "entry"));
      setConfirmingDelete(false);
      return;
    }
    await onDeleted();
  }

  async function finish(result: { ok: boolean; error?: { code: ErrorCode } }, successMessage: string) {
    setBusy(null);
    if (!result.ok) {
      setMessage(result.error?.code === "REVISION_CONFLICT" ? "内容已在其他位置更新，请核对后再次提交。" : result.error ? userErrorMessage(result.error, "entry") : "操作失败。");
      if (result.error?.code === "REVISION_CONFLICT") await onUpdated();
      return;
    }
    setMessage(successMessage);
    await onUpdated();
  }

  const jobsForRetry = retryableJobs(detail);
  return (
    <section className="governance" data-testid="entry-governance">
      {(classification || summary) && (
        <details className="ai-adjustments">
          <summary>修改整理结果</summary>
          {classification && (
            <div className="adjustment-field">
              <label htmlFor="entry-memory-type">记录分类</label>
              <div>
                <select id="entry-memory-type" value={memoryType} disabled={Boolean(busy)} onChange={(event) => setMemoryType(event.target.value as MemoryType)}>
                  {shelfOrder.map((type) => <option key={type} value={type}>{shelfMeta[type].label}</option>)}
                </select>
                <button type="button" disabled={Boolean(busy) || memoryType === classification.value.inputType} onClick={() => void saveClassification()}>保存分类</button>
              </div>
            </div>
          )}
          {summary && (
            <div className="adjustment-field">
              <label htmlFor="entry-summary">整理摘要</label>
              <textarea id="entry-summary" value={summaryText} maxLength={500} disabled={Boolean(busy)} onChange={(event) => setSummaryText(event.target.value)} data-testid="summary-correction-input" />
              <button type="button" disabled={Boolean(busy) || !summaryText.trim() || summaryText === summary.value.text} onClick={() => void saveSummary()}>保存整理摘要</button>
            </div>
          )}
        </details>
      )}
      {jobsForRetry.length > 0 && (
        <div className="retry-actions">
          {jobsForRetry.map((job) => <button className="retry-job" key={job.id} type="button" disabled={Boolean(busy)} onClick={() => void retry(job.id)}>{job.type === "generate_insight" ? "重新生成洞察" : "重新整理"}</button>)}
        </div>
      )}
      <div className="governance-heading"><h2>记录管理</h2></div>
      <button className="delete-entry" type="button" disabled={Boolean(busy)} onClick={() => void deleteEntry()}>{confirmingDelete ? "确认删除记录" : "删除记录"}</button>
      {message && <p className="governance-message" role="status">{message}</p>}
    </section>
  );
}
