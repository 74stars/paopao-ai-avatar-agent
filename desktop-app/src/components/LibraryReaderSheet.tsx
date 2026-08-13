import { useEffect, useRef } from "react";
import type { EntryDetailV1, EntryListResponseV1 } from "@paopao/contracts";
import { currentDerivation, currentInsight, entryAiState } from "./library-detail";
import { EntryGovernance } from "./EntryGovernance";
import { captureChannelLabel, formatDate, LibraryState, statusLabel, type LibraryLoadState } from "./LibraryState";
import { RecordContent } from "./RecordContent";
import { shelfMeta } from "./LibraryShelf";

export function entryPreviewText(item: EntryListResponseV1["items"][number]): string | null {
  const title = item.title.trim();
  const text = item.currentTextPreview.trim();
  if (!text) return null;
  if (!title || !text.startsWith(title)) return text;
  const remainder = text.slice(title.length).replace(/^[.!?。！？\s]+/u, "").trim();
  return remainder || null;
}

export function LibraryReaderSheet({
  heading, filterNote, state, error, list, detail, loadingMore, moreError,
  onClose, onClearFilter, onLoadMore, onOpenEntry, onRetry, onUpdated, onDeleted, onCapture
}: {
  heading: string;
  filterNote: string | null;
  state: LibraryLoadState;
  error: string;
  list: EntryListResponseV1;
  detail: EntryDetailV1 | null;
  loadingMore: boolean;
  moreError: string;
  onClose(): void;
  onClearFilter(): void;
  onLoadMore(): void;
  onOpenEntry(entryId: string): void;
  onRetry(): void;
  onUpdated(): Promise<void>;
  onDeleted(): Promise<void>;
  onCapture(): void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => { sheetRef.current?.focus(); }, []);

  return (
    <div className="reader-layer" data-testid="reader-sheet">
      <div className="reader-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="reader-sheet" role="dialog" aria-label="阅读层" tabIndex={-1} ref={sheetRef}>
        <header className="reader-sheet-header">
          <div className="reader-sheet-heading">
            <strong>{heading}</strong>
            {filterNote && <span>{filterNote}</span>}
          </div>
          <button type="button" className="reader-close" onClick={onClose} aria-label="关闭阅读层" title="关闭" data-testid="reader-close"><span aria-hidden="true">×</span></button>
        </header>
        <div className="reader-sheet-body">
          <section className="reader-index" data-testid="entry-list" aria-label="记录列表">
            <div className="reader-index-heading">
              <span>{heading}</span>
              {filterNote && <button type="button" onClick={onClearFilter}>清除筛选</button>}
            </div>
            {state === "loading" && <LibraryState state="loading" error="" onRetry={onRetry} />}
            {state === "error" && <LibraryState state="error" error={error} onRetry={onRetry} />}
            {state === "ready" && list.items.length === 0 && (
              <div className="library-state">
                <p>{filterNote ? "没有找到匹配的记忆。" : "这里还没有记录。"}</p>
                <div className="library-state-actions">
                  <button type="button" onClick={onCapture}>新建记录</button>
                  {filterNote && <button type="button" onClick={onClearFilter}>查看全部记忆</button>}
                </div>
              </div>
            )}
            {state === "ready" && list.items.map((item) => {
              const preview = entryPreviewText(item);
              return (
                <button key={item.id} type="button" className={detail?.id === item.id ? "entry-row active" : "entry-row"} onClick={() => onOpenEntry(item.id)} data-testid={`entry-${item.id}`}>
                  <span className="entry-title">{item.title || item.currentTextPreview}</span>
                  {preview && <span className="entry-preview">{preview}</span>}
                  <small>{captureChannelLabel(item.source)} · {formatDate(item.createdAt)} · {statusLabel(item.status)}</small>
                </button>
              );
            })}
            {state === "ready" && list.nextCursor && (
              <button type="button" className="load-more" disabled={loadingMore} onClick={onLoadMore} data-testid="load-more">{loadingMore ? "读取中..." : "加载更多"}</button>
            )}
            {moreError && <p className="paging-error" role="alert">{moreError}</p>}
          </section>
          <article className="reader-page" data-testid="entry-detail">
            {detail ? <ReaderPage detail={detail} onUpdated={onUpdated} onDeleted={onDeleted} /> : <ReaderPageEmpty state={state} />}
          </article>
        </div>
      </aside>
    </div>
  );
}

function ReaderPage({ detail, onUpdated, onDeleted }: { detail: EntryDetailV1; onUpdated(): Promise<void>; onDeleted(): Promise<void> }) {
  const aiState = entryAiState(detail);
  const insight = currentInsight(detail);
  const entities = currentDerivation(detail, "entities");
  const goals = currentDerivation(detail, "goals");
  const actions = currentDerivation(detail, "next_actions");
  return (
    <>
      <div className="detail-meta">
        {detail.memory && <span>分类：{shelfMeta[detail.memory.type].label}</span>}
        <span>记录方式：{captureChannelLabel(detail.source)}</span>
        <time dateTime={detail.createdAt}>{formatDate(detail.createdAt)}</time>
      </div>
      <div className={`ai-state ${aiState.tone}`} role="status" data-testid="entry-ai-state">{aiState.label}</div>
      <RecordContent detail={detail} onUpdated={onUpdated} />
      {detail.memory && (
        <details className="reader-section" open>
          <summary>AI 整理</summary>
          <p>{detail.memory.summary}</p>
        </details>
      )}
      {entities?.kind === "entities" && entities.value.items.length > 0 && (
        <details className="reader-section" open>
          <summary>实体</summary>
          <ul className="derivation-list">{entities.value.items.map((item, index) => <li key={`${item.type}:${item.name}:${index}`}><strong>{item.name}</strong><span>{item.type}</span></li>)}</ul>
        </details>
      )}
      {goals?.kind === "goals" && goals.value.items.length > 0 && (
        <details className="reader-section" open>
          <summary>目标</summary>
          <ul className="derivation-list">{goals.value.items.map((item, index) => <li key={`${item.title}:${index}`}>{item.title}</li>)}</ul>
        </details>
      )}
      {actions?.kind === "next_actions" && actions.value.items.length > 0 && (
        <details className="reader-section" open>
          <summary>下一步</summary>
          <ul className="derivation-list">{actions.value.items.map((item, index) => <li key={`${item.title}:${index}`}>{item.title}{item.dueHint ? <span>{item.dueHint}</span> : null}</li>)}</ul>
        </details>
      )}
      {insight && (
        <details className="reader-section insight-block" open data-testid="entry-insight">
          <summary>洞察</summary>
          <p>{insight.text}</p>
          {insight.nextAction && <p className="insight-action">下一步：{insight.nextAction.title}</p>}
          {insight.grounding === "no_relevant_memory" ? <p className="insight-empty">没有找到足够相关的既有记忆。</p> : (
            <div className="citations">
              <h2>引用的关联记录</h2>
              {insight.citations.map((citation) => <blockquote key={`${citation.memoryId}:${citation.entryId}`}>{citation.evidenceQuote}</blockquote>)}
            </div>
          )}
        </details>
      )}
      {detail.sources.length > 0 && (
        <details className="reader-section" open>
          <summary>整理依据</summary>
          {detail.sources.map((source) => (
            <blockquote className="evidence-quote" key={`${source.artifactType}:${source.artifactId}:${source.entryId}:${source.quote}`}>
              <span>{source.entryId === detail.id ? "本条记录" : "关联记录"}</span>
              {source.quote}
            </blockquote>
          ))}
        </details>
      )}
      <EntryGovernance detail={detail} onUpdated={onUpdated} onDeleted={onDeleted} />
    </>
  );
}

function ReaderPageEmpty({ state }: { state: LibraryLoadState }) {
  if (state === "loading") {
    return <div className="reader-page-empty"><span>正在翻开书页…</span></div>;
  }
  return (
    <div className="reader-page-empty">
      <span>活书房</span>
      <h2>从左侧选择一条记录</h2>
      <p>记录内容、AI 整理、洞察与整理依据都会在这里打开。</p>
    </div>
  );
}
