import { useEffect, useRef, useState } from "react";
import type { CaptureMode } from "@paopao/contracts";
import { userErrorMessage } from "../error-messages";

export function CaptureWindow() {
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("原文会先写入本机，确认保存后才会清空。");
  const [mode, setMode] = useState<CaptureMode>("remember");
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => window.paopao?.onDomainEvent((event) => {
    if (event.type !== "backup:restore-progress") return;
    if (["queued", "validating", "quiescing", "replacing", "reopening"].includes(event.status)) {
      setRestoring(true);
      setMessage("正在恢复备份，暂时不能记录。");
    } else if (event.status === "succeeded") {
      setRestoring(false);
      setMessage("备份恢复完成，可以继续记录。");
    } else {
      setRestoring(false);
      setMessage("备份恢复失败，未显示为成功。请在书房中查看恢复记录。");
    }
  }), []);

  async function save() {
    if (!content.trim()) {
      setMessage("请先输入要保存的内容。");
      return;
    }
    if (saving || restoring) return;
    if (!window.paopao) {
      setMessage("暂时无法保存，输入内容仍保留。请重新启动泡泡后再试。");
      return;
    }

    setSaving(true);
    setMessage("正在写入本机...");
    try {
      const result = await window.paopao.capture.create({ version: 1, requestId: requestId.current, rawText: content, mode });
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "capture"));
        return;
      }
      setContent("");
      requestId.current = crypto.randomUUID();
      setMessage(result.data.deduplicated ? "这次提交已保存，无需重复写入。" : "已保存，正在整理。");
    } catch {
      setMessage("这次没有保存成功，输入内容仍保留，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="capture-window" data-testid="capture-window">
      <header>
        <strong>泡泡</strong>
        <button className="icon-command" type="button" aria-label="关闭" title="关闭" onClick={() => window.paopao?.windows.hideCapture()}>x</button>
      </header>
      <textarea autoFocus maxLength={50_000} value={content} disabled={saving || restoring} onChange={(event) => setContent(event.target.value)} placeholder="现在有什么不想忘记的？" data-testid="capture-input" />
      <div className="capture-mode" role="group" aria-label="记录模式">
        <button type="button" className={mode === "remember" ? "active" : ""} onClick={() => setMode("remember")} disabled={saving || restoring}>记住</button>
        <button type="button" className={mode === "think" ? "active" : ""} onClick={() => setMode("think")} disabled={saving || restoring}>思考</button>
      </div>
      <button className="primary" type="button" onClick={save} disabled={saving || restoring} data-testid="capture-submit">{restoring ? "恢复中" : saving ? "保存中" : "保存"}</button>
      <footer role="status" data-testid="capture-status">{message}</footer>
    </section>
  );
}
