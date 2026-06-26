import { useMemo, useState } from "react";
import { BubbleLife } from "./BubbleLife";

const shelves = ["日记", "思想", "人物", "阅读", "目标", "日报", "周报"];

export function LibraryWindow() {
  const [selected, setSelected] = useState("周报");
  const books = useMemo(() => shelves.map((title, index) => ({ title, count: [21, 38, 12, 26, 9, 14, 4][index], color: ["#d9cfbd", "#b8aa91", "#d7cbb6", "#ad9e87", "#a8ad8d", "#8e7e69", "#59606a"][index] })), []);

  return (
    <main className="library-window">
      <div className="library-room" />
      <header className="library-topbar"><strong>泡泡 · 活书房</strong><span>桌面 Agent 的记忆世界</span></header>
      <section className="desktop-agent"><BubbleLife state="insight" /><p>泡泡正在把输入装订成书。</p></section>
      <section className="book-shelf">
        {books.map((book) => <button key={book.title} className={book.title === selected ? "active" : ""} style={{ backgroundColor: book.color }} onClick={() => setSelected(book.title)}><span>{book.title}</span><small>{book.count} 条</small></button>)}
      </section>
      <article className="open-page"><span>当前书本</span><h1>{selected}</h1><p>这里会呈现泡泡整理好的日记、思想主题、人物观察、阅读摘录、目标进展、日报和周报。界面保持像真实书房一样安静，而不是后台仪表盘。</p></article>
    </main>
  );
}
