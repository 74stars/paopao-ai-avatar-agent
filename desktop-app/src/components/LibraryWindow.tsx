import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DomainEventV1, EntryDetailV1, EntryListResponseV1, MemoryType } from "@paopao/contracts";
import { LibraryReaderSheet } from "./LibraryReaderSheet";
import { LibraryScene } from "./LibraryScene";
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
  const [state, setState] = useState<LibraryLoadState>("loading");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latestFeishuStatus, setLatestFeishuStatus] = useState<Extract<DomainEventV1, { type: "feishu:status" }> | null>(null);
  const requestSequence = useRef(0);

  const loadLibrary = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!window.paopao) {
      setState("error");
      setError("书房暂时无法打开。请重新启动泡泡后再试。");
      return;
    }

    setState("loading");
    const [summaryResult, listResult, recentResult] = await Promise.all([
      window.paopao.library.summary({ version: 1 }),
      window.paopao.entries.list({ version: 1, limit: 30, query: query || undefined, types: selectedType ? [selectedType] : undefined }),
      window.paopao.entries.list({ version: 1, limit: 5 })
    ]);
    if (sequence !== requestSequence.current) return;
    if (!summaryResult.ok || !listResult.ok || !recentResult.ok) {
      setState("error");
      setError(!summaryResult.ok ? userErrorMessage(summaryResult.error, "library") : !listResult.ok ? userErrorMessage(listResult.error, "library") : !recentResult.ok ? userErrorMessage(recentResult.error, "library") : "书房读取失败。");
      return;
    }

    setSummary(summaryResult.data);
    setList(listResult.data);
    setRecent(recentResult.data);
    setState("ready");
    if (detail) {
      const currentItem = [...listResult.data.items, ...recentResult.data.items].find((item) => item.id === detail.id);
      if (!currentItem) setDetail(null);
    }
  }, [detail, query, selectedType]);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  useEffect(() => window.paopao?.onDomainEvent((event) => {
    if (event.type === "entry:stored" || event.type === "entry:updated") void loadLibrary();
    if (event.type === "feishu:status") setLatestFeishuStatus(event);
  }), [loadLibrary]);

  async function openEntry(entryId: string) {
    if (!window.paopao) return;
    const result = await window.paopao.entries.get({ version: 1, entryId });
    if (result.ok) {
      setDetail(result.data);
      setSheetOpen(true);
      return;
    }
    setError(userErrorMessage(result.error, "library"));
    setState("error");
  }

  async function reloadDetail() {
    if (detail) await openEntry(detail.id);
    await loadLibrary();
  }

  async function afterDelete() {
    setDetail(null);
    await loadLibrary();
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setDetail(null);
    setQuery(queryInput.trim());
    setSheetOpen(true);
  }

  function selectType(type: MemoryType) {
    setDetail(null);
    setSelectedType((current) => current === type ? null : type);
    setSheetOpen(true);
  }

  function clearFilter() {
    setSelectedType(null);
    setQuery("");
    setQueryInput("");
    setDetail(null);
  }

  function closeSheet() {
    setDetail(null);
    setSelectedType(null);
    setQuery("");
    setSheetOpen(false);
  }

  function openBrowse() {
    setDetail(null);
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
          loadingMore={loadingMore}
          moreError={moreError}
          onClose={closeSheet}
          onClearFilter={clearFilter}
          onLoadMore={() => void loadMore()}
          onOpenEntry={(entryId) => void openEntry(entryId)}
          onRetry={() => void loadLibrary()}
          onUpdated={reloadDetail}
          onDeleted={afterDelete}
          onCapture={capture}
        />
      )}
      {settingsOpen && <SettingsPanel latestFeishuStatus={latestFeishuStatus} onClose={() => setSettingsOpen(false)} onOpenEntry={(entryId) => { setSettingsOpen(false); void openEntry(entryId); }} />}
    </main>
  );
}
