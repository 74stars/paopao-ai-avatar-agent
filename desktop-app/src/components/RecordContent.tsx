import { useEffect, useState } from "react";
import type { EntryDetailV1 } from "@paopao/contracts";
import { userErrorMessage } from "../error-messages";

export function RecordContent({ detail, onUpdated }: { detail: EntryDetailV1; onUpdated(): Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(detail.currentText);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const revised = detail.textRevisions.length > 1 || detail.currentText !== detail.rawText;

  useEffect(() => {
    setText(detail.currentText);
    setEditing(false);
  }, [detail.id, detail.currentText]);

  async function save() {
    if (!window.paopao || busy || !text.trim()) return;
    setBusy(true);
    setMessage("");
    const result = await window.paopao.entries.reviseText({
      version: 1,
      requestId: crypto.randomUUID(),
      entryId: detail.id,
      expectedTextRevision: detail.textRevisions.at(-1)?.revision ?? 1,
      text
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.code === "REVISION_CONFLICT" ? "记录内容已在其他位置更新。你的输入仍保留，请核对后再次提交。" : userErrorMessage(result.error, "entry"));
      if (result.error.code === "REVISION_CONFLICT") await onUpdated();
      return;
    }
    setMessage("当前版本已更新，正在重新整理。");
    await onUpdated();
  }

  return (
    <section className="reader-section record-content" aria-label="记录内容">
      <div className="record-content-heading">
        <h2>记录内容</h2>
        <button type="button" onClick={() => setEditing((value) => !value)}>{editing ? "取消编辑" : "编辑记录内容"}</button>
      </div>
      {editing ? (
        <div className="record-editor">
          <h3>编辑记录内容</h3>
          <textarea value={text} maxLength={50_000} disabled={busy} onChange={(event) => setText(event.target.value)} data-testid="revision-input" />
          <button type="button" disabled={busy || !text.trim() || text === detail.currentText} onClick={() => void save()}>保存记录内容</button>
        </div>
      ) : <p className="current-record-text">{detail.currentText}</p>}
      {revised && (
        <details className="original-record">
          <summary>最初记录</summary>
          <p>{detail.rawText}</p>
        </details>
      )}
      {message && <p className="record-message" role="status">{message}</p>}
    </section>
  );
}
