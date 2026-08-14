import { isUserVisibleGeneratedText, type EntryDetailV1, type EntryListResponseV1 } from "@paopao/contracts";
import { currentDerivation, currentInsight, entryAiState, evidenceQuotes } from "./library-detail";
import { EntryGovernance } from "./EntryGovernance";
import { captureChannelLabel, formatDate, LibraryState, statusLabel, type LibraryLoadState } from "./LibraryState";
import { RecordContent } from "./RecordContent";
import { shelfMeta } from "./LibraryShelf";
import { useModalFocus } from "./modal-focus";

export function entryPreviewText(item: EntryListResponseV1["items"][number]): string | null {
  const title = item.title.trim();
  const text = item.currentTextPreview.trim();
  if (!text) return null;
  if (!title || !text.startsWith(title)) return text;
  const remainder = text.slice(title.length).replace(/^[.!?。！？\s]+/u, "").trim();
  return remainder || null;
}

export function entityTypeLabel(type: "person" | "book" | "place" | "topic" | "organization"): string {
  return ({ person: "人物", book: "书籍", place: "地点", topic: "主题", organization: "组织" } as const)[type];
}

export function LibraryReaderSheet({
  heading, filterNote, state, error, list, detail, detailLoading, detailError, loadingMore, moreError,
  onClose, onClearFilter, onLoadMore, onOpenEntry, onRetry, onRetryDetail, onUpdated, onDeleted, onCapture
}: {
  heading: string;
  filterNote: string | null;
  state: LibraryLoadState;
  error: string;
  list: EntryListResponseV1;
  detail: EntryDetailV1 | null;
  detailLoading: boolean;
  detailError: string;
  loadingMore: boolean;
  moreError: string;
  onClose(): void;
  onClearFilter(): void;
  onLoadMore(): void;
  onOpenEntry(entryId: string): void;
  onRetry(): void;
  onRetryDetail(): void;
  onUpdated(): Promise<void>;
  onDeleted(): Promise<void>;
  onCapture(): void;
}) {
  const sheetRef = useModalFocus<HTMLElement>(onClose);

  return (
    <div className="reader-layer" data-testid="reader-sheet">
      <div className="reader-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="reader-sheet" role="dialog" aria-modal="true" aria-label="阅读面板" tabIndex={-1} ref={sheetRef}>
        <header className="reader-sheet-header">
          <div className="reader-sheet-heading">
            <strong>{heading}</strong>
            {filterNote && <span>{filterNote}</span>}
          </div>
          <button type="button" className="reader-close" onClick={onClose} aria-label="关闭阅读面板" title="关闭" data-testid="reader-close"><span aria-hidden="true">×</span></button>
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
                <p>{filterNote ? "没有找到匹配的记录。" : "这里还没有记录。"}</p>
                <div className="library-state-actions">
                  <button type="button" onClick={onCapture}>新建记录</button>
                  {filterNote && <button type="button" onClick={onClearFilter}>查看全部记录</button>}
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
              <button type="button" className="load-more" disabled={loadingMore} onClick={onLoadMore} data-testid="load-more">{loadingMore ? "读取中…" : "加载更多"}</button>
            )}
            {moreError && <p className="paging-error" role="alert">{moreError}</p>}
          </section>
          <article className="reader-page" data-testid="entry-detail">
            {detail ? <ReaderPage key={detail.id} detail={detail} onUpdated={onUpdated} onDeleted={onDeleted} />
              : detailLoading ? <ReaderPageLoading />
              : detailError ? <ReaderPageError error={detailError} onRetry={onRetryDetail} />
              : <ReaderPageEmpty state={state} />}
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
  const evidence = evidenceQuotes(detail.sources, detail.id);
  const summary = detail.memory && isUserVisibleGeneratedText(detail.memory.summary) ? detail.memory.summary : null;
  const visibleEntities = entities?.kind === "entities" ? entities.value.items.filter((item) => isUserVisibleGeneratedText(item.name)) : [];
  const visibleGoals = goals?.kind === "goals" ? goals.value.items.filter((item) => isUserVisibleGeneratedText(item.title)) : [];
  const visibleActions = actions?.kind === "next_actions" ? actions.value.items.filter((item) => isUserVisibleGeneratedText(item.title) && (!item.dueHint || isUserVisibleGeneratedText(item.dueHint))) : [];
  return (
    <>
      <div className="detail-meta">
        {detail.memory && <span>分类：{shelfMeta[detail.memory.type].label}</span>}
        <span>记录入口：{captureChannelLabel(detail.source)}</span>
        <time dateTime={detail.createdAt}>{formatDate(detail.createdAt)}</time>
      </div>
      <div className={`ai-state ${aiState.tone}`} role="status" data-testid="entry-ai-state">{aiState.label}</div>
      <RecordContent detail={detail} onUpdated={onUpdated} />
      {summary && (
        <details className="reader-section" open>
          <summary>整理摘要</summary>
          <p>{summary}</p>
        </details>
      )}
      {visibleEntities.length > 0 && (
        <details className="reader-section" open>
          <summary>相关内容</summary>
          <ul className="derivation-list">{visibleEntities.map((item, index) => <li key={`${item.type}:${item.name}:${index}`}><strong>{item.name}</strong><span>{entityTypeLabel(item.type)}</span></li>)}</ul>
        </details>
      )}
      {visibleGoals.length > 0 && (
        <details className="reader-section" open>
          <summary>目标</summary>
          <ul className="derivation-list">{visibleGoals.map((item, index) => <li key={`${item.title}:${index}`}>{item.title}</li>)}</ul>
        </details>
      )}
      {visibleActions.length > 0 && (
        <details className="reader-section" open>
          <summary>下一步</summary>
          <ul className="derivation-list">{visibleActions.map((item, index) => <li key={`${item.title}:${index}`}>{item.title}{item.dueHint ? <span>{item.dueHint}</span> : null}</li>)}</ul>
        </details>
      )}
      {insight && (
        <details className="reader-section insight-block" open data-testid="entry-insight">
          <summary>洞察</summary>
          <p>{insight.text}</p>
          {insight.nextAction && <p className="insight-action">下一步：{insight.nextAction.title}</p>}
          {insight.grounding === "no_relevant_memory" ? <p className="insight-empty">没有找到足够相关的既有记录。</p> : (
            <div className="citations">
              <h2>引用记录</h2>
              {insight.citations.map((citation) => <blockquote key={`${citation.memoryId}:${citation.entryId}`}>{citation.evidenceQuote}</blockquote>)}
            </div>
          )}
        </details>
      )}
      {detail.sources.length > 0 && (
        <details className="reader-section" open>
          <summary>整理依据</summary>
          {evidence.own.length > 0 && (
            <>
              <h2>这条记录的原文</h2>
              {evidence.own.map((quote) => <blockquote className="evidence-quote" key={quote}>{quote}</blockquote>)}
            </>
          )}
          {evidence.related.length > 0 && (
            <>
              <h2>关联记录的原文</h2>
              {evidence.related.map((quote) => <blockquote className="evidence-quote" key={quote}>{quote}</blockquote>)}
            </>
          )}
        </details>
      )}
      <EntryGovernance detail={detail} onUpdated={onUpdated} onDeleted={onDeleted} />
    </>
  );
}

function ReaderPageLoading() {
  return <div className="reader-page-empty" role="status"><span>正在打开记录…</span></div>;
}

function ReaderPageError({ error, onRetry }: { error: string; onRetry(): void }) {
  return (
    <div className="reader-page-empty error" role="alert">
      <span>这条记录暂时无法打开</span>
      <p>{error}</p>
      <button type="button" onClick={onRetry}>重试</button>
    </div>
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
    </div>
  );
}
