import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DomainEventV1, EntryDetailV1, EntryListResponseV1, MemoryType } from "@paopao/contracts";
import { LibraryReaderSheet } from "./LibraryReaderSheet";
import { LibraryScene, normalizedLibrarySearchQuery } from "./LibraryScene";
import { shelfMeta } from "./LibraryShelf";
import type { LibraryLoadState } from "./LibraryState";
import { SettingsPanel } from "./SettingsPanel";
import { userErrorMessage } from "../error-messages";
import { initialLibraryTheme, nextLibraryTheme, type LibraryTheme } from "./library-theme";

export function LibraryWindow() {
  const [theme, setTheme] = useState<LibraryTheme>(() => initialLibraryTheme(window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false));
  const [selectedType, setSelectedType] = useState<MemoryType | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [summary, setSummary] = useState<{ total: number; shelves: Array<{ type: MemoryType; count: number }> } | null>(null);
  const [list, setList] = useState<EntryListResponseV1>({ items: [], nextCursor: null });
  const [recent, setRecent] = useState<EntryListResponseV1>({ items: [], nextCursor: null });
  const [detail, setDetail] = useState<EntryDetailV1 | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [failedDetailId, setFailedDetailId] = useState<string | null>(null);
  const [state, setState] = useState<LibraryLoadState>("loading");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latestFeishuStatus, setLatestFeishuStatus] = useState<Extract<DomainEventV1, { type: "feishu:status" }> | null>(null);
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef(0);

  const loadLibrary = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!window.paopao) {
      setState("error");
      setError("活书房暂时无法打开。请重新启动泡泡后再试。");
      return;
    }

    setState("loading");
    setError("");
    const [summaryResult, listResult, recentResult] = await Promise.all([
      window.paopao.library.summary({ version: 1 }),
      window.paopao.entries.list({ version: 1, limit: 30, query: query || undefined, types: selectedType ? [selectedType] : undefined }),
      window.paopao.entries.list({ version: 1, limit: 5 })
    ]);
    if (sequence !== requestSequence.current) return;
    if (!listResult.ok) {
      setState("error");
      setError(userErrorMessage(listResult.error, "library"));
      return;
    }

    const secondaryErrors: string[] = [];
    if (summaryResult.ok) setSummary(summaryResult.data);
    else {
      setSummary(null);
      secondaryErrors.push("分类数量暂时无法读取。");
    }
    if (recentResult.ok) setRecent(recentResult.data);
    else {
      setRecent({ items: [], nextCursor: null });
      secondaryErrors.push("最近记录入口暂时不可用。");
    }
    setList(listResult.data);
    setError(secondaryErrors.join(" "));
    setState("ready");
    const loadedItems = [...listResult.data.items, ...(recentResult.ok ? recentResult.data.items : [])];
    setDetail((current) => current && !loadedItems.some((item) => item.id === current.id) ? null : current);
  }, [query, selectedType]);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  useEffect(() => window.paopao?.onDomainEvent((event) => {
    if (event.type === "entry:stored" || event.type === "entry:updated") void loadLibrary();
    if (event.type === "backup:restore-progress" && (event.status === "succeeded" || event.status === "failed_rolled_back")) {
      setDetail(null);
      setLoadingMore(false);
      setMoreError("");
      void loadLibrary();
    }
    if (event.type === "feishu:status") setLatestFeishuStatus(event);
  }), [loadLibrary]);

  async function openEntry(entryId: string) {
    if (!window.paopao) return;
    const sequence = ++detailRequestSequence.current;
    setSheetOpen(true);
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    setFailedDetailId(entryId);
    const result = await window.paopao.entries.get({ version: 1, entryId });
    if (sequence !== detailRequestSequence.current) return;
    setDetailLoading(false);
    if (result.ok) {
      setDetail(result.data);
      setFailedDetailId(null);
      return;
    }
    setDetailError(userErrorMessage(result.error, "library"));
  }

  async function reloadDetail() {
    if (detail) await openEntry(detail.id);
    await loadLibrary();
  }

  async function afterDelete() {
    setDetail(null);
    setDetailError("");
    setFailedDetailId(null);
    await loadLibrary();
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = normalizedLibrarySearchQuery(queryInput);
    if (!nextQuery) return;
    setDetail(null);
    setDetailError("");
    setFailedDetailId(null);
    setSelectedType(null);
    setQuery(nextQuery);
    setSheetOpen(true);
  }

  function selectType(type: MemoryType | null) {
    setDetail(null);
    setQuery("");
    setSelectedType(type);
  }

  function openSelectedType(type: MemoryType) {
    setDetail(null);
    setQuery("");
    setSelectedType(type);
    setSheetOpen(true);
  }

  function clearFilter() {
    setSelectedType(null);
    setQuery("");
    setQueryInput("");
    setDetail(null);
  }

  function closeSheet() {
    detailRequestSequence.current += 1;
    setDetail(null);
    setDetailLoading(false);
    setDetailError("");
    setFailedDetailId(null);
    setSelectedType(null);
    setQuery("");
    setQueryInput("");
    setSheetOpen(false);
  }

  function openBrowse() {
    setDetail(null);
    setSelectedType(null);
    setQuery("");
    setSheetOpen(true);
  }

  function capture() {
    void window.paopao?.windows.toggleCapture();
  }

  async function loadMore() {
    if (!window.paopao || loadingMore || !list.nextCursor) return;
    const sequence = requestSequence.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const result = await window.paopao.entries.list({ version: 1, limit: 30, cursor: list.nextCursor, query: query || undefined, types: selectedType ? [selectedType] : undefined });
      if (sequence !== requestSequence.current) return;
      if (result.ok) {
        setList((current) => ({ items: [...current.items, ...result.data.items], nextCursor: result.data.nextCursor }));
      } else {
        setMoreError(userErrorMessage(result.error, "library"));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const heading = selectedType ? shelfMeta[selectedType].label : query ? `“${query}”` : "最近记录";
  const filterNote = selectedType ? `分类：${shelfMeta[selectedType].label}` : query ? `搜索：${query}` : null;
  return (
    <main className="library-window" data-testid="library-window" data-theme={theme} onKeyDown={(event) => {
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else closeSheet();
      }
    }}>
      <LibraryScene
        summary={summary}
        state={state}
        error={error}
        latest={recent.items[0] ?? null}
        selectedType={selectedType}
        queryInput={queryInput}
        settingsOpen={settingsOpen}
        readerOpen={sheetOpen}
        theme={theme}
        onQueryInputChange={setQueryInput}
        onSearch={submitSearch}
        onSelectType={selectType}
        onOpenSelectedType={openSelectedType}
        onCapture={capture}
        onBrowse={openBrowse}
        onOpenEntry={(entryId) => void openEntry(entryId)}
        onOpenSettings={() => setSettingsOpen((open) => !open)}
        onToggleTheme={() => setTheme((current) => nextLibraryTheme(current))}
        onRetry={() => void loadLibrary()}
      />
      {sheetOpen && (
        <LibraryReaderSheet
          heading={heading}
          filterNote={filterNote}
          state={state}
          error={error}
          list={list}
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          loadingMore={loadingMore}
          moreError={moreError}
          onClose={closeSheet}
          onClearFilter={clearFilter}
          onLoadMore={() => void loadMore()}
          onOpenEntry={(entryId) => void openEntry(entryId)}
          onRetry={() => void loadLibrary()}
          onRetryDetail={() => { if (failedDetailId) void openEntry(failedDetailId); }}
          onUpdated={reloadDetail}
          onDeleted={afterDelete}
          onCapture={capture}
        />
      )}
      {settingsOpen && <SettingsPanel latestFeishuStatus={latestFeishuStatus} onClose={() => setSettingsOpen(false)} onOpenEntry={(entryId) => { setSettingsOpen(false); void openEntry(entryId); }} />}
    </main>
  );
}
