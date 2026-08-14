import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { EntryListResponseV1, MemoryType } from "@paopao/contracts";
import { Search, Settings, X } from "lucide-react";
import { LibraryMasterScene, type LibraryMasterAction, type LibraryMasterFrame } from "./LibraryMasterScene";
import type { LibraryLoadState } from "./LibraryState";
import type { LibraryTheme } from "./library-theme";

type PendingReader =
  | { kind: "category"; type: MemoryType }
  | { kind: "recent" };

function frameMatchesPending(frame: LibraryMasterFrame, pending: PendingReader): boolean {
  if (pending.kind === "recent") return frame.action === "letterbox";
  return frame.action === "books" && frame.selectedType === pending.type;
}

export function normalizedLibrarySearchQuery(value: string): string | null {
  const query = value.trim();
  return query || null;
}

export function LibraryScene({
  summary, state, error, latest, selectedType, queryInput, settingsOpen, readerOpen, theme,
  onQueryInputChange, onSearch, onSelectType, onOpenSelectedType, onCapture, onBrowse, onOpenEntry, onOpenSettings, onToggleTheme, onRetry
}: {
  summary: { total: number; shelves: Array<{ type: MemoryType; count: number }> } | null;
  state: LibraryLoadState;
  error: string;
  latest: EntryListResponseV1["items"][number] | null;
  selectedType: MemoryType | null;
  queryInput: string;
  settingsOpen: boolean;
  readerOpen: boolean;
  theme: LibraryTheme;
  onQueryInputChange(value: string): void;
  onSearch(event: FormEvent): void;
  onSelectType(type: MemoryType | null): void;
  onOpenSelectedType(type: MemoryType): void;
  onCapture(): void;
  onBrowse(): void;
  onOpenEntry(entryId: string): void;
  onOpenSettings(): void;
  onToggleTheme(): void;
  onRetry(): void;
}) {
  const counts = new Map(summary?.shelves.map((shelf) => [shelf.type, shelf.count]) ?? []);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const pendingReaderRef = useRef<PendingReader | null>(null);
  const lastPresentedFrameRef = useRef<LibraryMasterFrame | null>(null);
  const wasReaderOpenRef = useRef(readerOpen);
  const [visualAction, setVisualAction] = useState<LibraryMasterAction>("idle");
  const [searchOpen, setSearchOpen] = useState(false);

  const finishReaderEntrance = useCallback((frame: LibraryMasterFrame) => {
    const pending = pendingReaderRef.current;
    if (!pending || !frameMatchesPending(frame, pending)) return;
    pendingReaderRef.current = null;
    if (pending.kind === "category") onOpenSelectedType(pending.type);
    else onBrowse();
  }, [onBrowse, onOpenSelectedType]);

  const handleFramePresented = useCallback((frame: LibraryMasterFrame) => {
    lastPresentedFrameRef.current = frame;
    finishReaderEntrance(frame);
  }, [finishReaderEntrance]);

  const handleFrameUnavailable = useCallback((frame: LibraryMasterFrame) => {
    finishReaderEntrance(frame);
  }, [finishReaderEntrance]);

  useLayoutEffect(() => {
    if (wasReaderOpenRef.current && !readerOpen) setVisualAction("idle");
    wasReaderOpenRef.current = readerOpen;
  }, [readerOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const animationFrame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [searchOpen]);

  function activateShelf(type: MemoryType) {
    if (pendingReaderRef.current || readerOpen || settingsOpen) return;
    const pending: PendingReader = { kind: "category", type };
    pendingReaderRef.current = pending;
    setVisualAction("idle");
    onSelectType(type);
    const currentFrame = lastPresentedFrameRef.current;
    if (currentFrame && frameMatchesPending(currentFrame, pending)) {
      window.requestAnimationFrame(() => finishReaderEntrance(currentFrame));
    }
  }

  function activateTypewriter() {
    if (pendingReaderRef.current || readerOpen || settingsOpen) return;
    if (state === "error") {
      onRetry();
      return;
    }
    if (latest) onOpenEntry(latest.id);
    else onCapture();
  }

  function activateLetterbox() {
    if (pendingReaderRef.current || readerOpen || settingsOpen) return;
    const pending: PendingReader = { kind: "recent" };
    pendingReaderRef.current = pending;
    onSelectType(null);
    setVisualAction("letterbox");
    const currentFrame = lastPresentedFrameRef.current;
    if (currentFrame && frameMatchesPending(currentFrame, pending)) {
      window.requestAnimationFrame(() => finishReaderEntrance(currentFrame));
    }
  }

  function submitVisibleSearch(event: FormEvent) {
    if (!normalizedLibrarySearchQuery(queryInput)) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    setSearchOpen(false);
    onSearch(event);
  }

  function closeSearch() {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchToggleRef.current?.focus());
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeSearch();
  }

  const latestTitle = latest ? latest.title || latest.currentTextPreview : null;

  return (
    <section className="library-scene-v5" aria-label="活书房交互场景" data-testid="library-scene-v5">
      <div className="scene-drag-region" aria-hidden="true" />
      <LibraryMasterScene
        counts={counts}
        total={summary?.total ?? null}
        selectedType={selectedType}
        state={state}
        error={error}
        latestTitle={latestTitle}
        theme={theme}
        visualAction={visualAction}
        onSelectType={activateShelf}
        onTypewriter={activateTypewriter}
        onBrowse={activateLetterbox}
        onToggleTheme={onToggleTheme}
        onFramePresented={handleFramePresented}
        onFrameUnavailable={handleFrameUnavailable}
      />

      {error && (
        <div className={`library-scene-status ${state === "error" ? "error" : "warning"}`} role={state === "error" ? "alert" : "status"} data-testid="library-scene-status">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>{state === "error" ? "重新读取" : "重试缺失内容"}</button>
        </div>
      )}

      <div className={`library-utility-tools${searchOpen ? " search-open" : ""}`} aria-label="活书房工具">
        {searchOpen ? (
          <form className="library-visible-search" role="search" onSubmit={submitVisibleSearch} onKeyDown={handleSearchKeyDown} data-testid="scene-search-form">
            <button type="submit" className="library-tool-button" aria-label="提交搜索" title="搜索" disabled={!normalizedLibrarySearchQuery(queryInput)} data-testid="scene-search-submit"><Search size={18} strokeWidth={1.8} aria-hidden="true" /></button>
            <label className="visually-hidden" htmlFor="library-world-search">搜索活书房</label>
            <input
              id="library-world-search"
              ref={searchRef}
              value={queryInput}
              maxLength={200}
              onChange={(event) => onQueryInputChange(event.target.value)}
              placeholder="搜索记录"
              aria-label="搜索活书房"
              data-testid="scene-search-input"
            />
            <button type="button" className="library-tool-button" aria-label="关闭搜索" title="关闭搜索" onClick={closeSearch}><X size={19} strokeWidth={1.8} aria-hidden="true" /></button>
          </form>
        ) : (
          <button
            ref={searchToggleRef}
            type="button"
            className="library-tool-button"
            aria-label="搜索记录"
            aria-expanded="false"
            title="搜索"
            data-testid="scene-search-toggle"
            onClick={() => setSearchOpen(true)}
          ><Search size={18} strokeWidth={1.8} aria-hidden="true" /></button>
        )}
        <button
          type="button"
          className="library-tool-button"
          aria-label="打开设置"
          aria-pressed={settingsOpen}
          title="设置"
          data-testid="scene-settings"
          onClick={() => {
            setSearchOpen(false);
            onOpenSettings();
          }}
        ><Settings size={19} strokeWidth={1.8} aria-hidden="true" /></button>
      </div>
    </section>
  );
}
