import { useState } from "react";

export function CaptureWindow() {
  const [content, setContent] = useState("");
  const [reply, setReply] = useState("原文会先写入本机，网络失败也不会丢失。");
  const [askInsight, setAskInsight] = useState(false);

  async function save() {
    const text = content.trim();
    if (!text) {
      setReply("先留下一句话。哪怕不完整，泡泡也会替你接住。");
      return;
    }
    const result = await window.paopao?.saveCapture?.({ modality: "text", content: text, askInsight });
    setReply(result?.reply ?? `已记住，收进「${result?.archivedTo ?? "原始档案"}」。`);
    setContent("");
  }

  return (
    <section className="capture-window">
      <header><strong>泡泡</strong><button onClick={() => window.paopao?.hideCapture?.()}>关闭</button></header>
      <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder="现在有什么不想忘记的？" />
      <label><input type="checkbox" checked={askInsight} onChange={(event) => setAskInsight(event.target.checked)} /> 请泡泡思考这条内容</label>
      <button className="primary" onClick={save}>记住</button>
      <footer>{reply}</footer>
    </section>
  );
}
