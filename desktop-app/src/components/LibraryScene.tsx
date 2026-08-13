import { useRef, useState, type FormEvent } from "react";
import type { EntryListResponseV1, MemoryType } from "@paopao/contracts";
import { LibraryWorld } from "./LibraryWorld";
import { shelfMeta, shelfOrder } from "./LibraryShelf";
import type { LibraryLoadState } from "./LibraryState";
import type { LibraryTheme } from "./library-theme";

export function LibraryScene({
  summary, state, error, latest, selectedType, queryInput, settingsOpen, readerOpen, theme,
  onQueryInputChange, onSearch, onSelectType, onCapture, onBrowse, onOpenEntry, onOpenSettings, onToggleTheme, onRetry
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
  onSelectType(type: MemoryType): void;
  onCapture(): void;
  onBrowse(): void;
  onOpenEntry(entryId: string): void;
  onOpenSettings(): void;
  onToggleTheme(): void;
  onRetry(): void;
}) {
  const counts = new Map(summary?.shelves.map((shelf) => [shelf.type, shelf.count]) ?? []);
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusedInteraction, setFocusedInteraction] = useState<string | null>(null);
  const typewriterAction = state === "error" ? onRetry : latest ? () => onOpenEntry(latest.id) : onCapture;
  const typewriterLabel = state === "error" ? "重新读取书房" : latest ? `打开最近记录：${latest.title || latest.currentTextPreview}` : "从第一句话开始";

  const focusProps = (interactionId: string) => ({
    onFocus: () => setFocusedInteraction(interactionId),
    onBlur: () => setFocusedInteraction((current) => current === interactionId ? null : current)
  });

  return (
    <section className="library-scene-v4 library-scene-v3" aria-label="活书房交互场景" data-testid="library-scene-v4">
      <div className="scene-drag-region" aria-hidden="true" />
      <LibraryWorld
        counts={counts}
        total={summary?.total ?? null}
        selectedType={selectedType}
        latest={latest}
        state={state}
        error={error}
        queryInput={queryInput}
        theme={theme}
        dimmed={settingsOpen || readerOpen}
        focusedInteraction={focusedInteraction}
        onSelectType={onSelectType}
        onTypewriter={typewriterAction}
        onBrowse={onBrowse}
        onFocusSearch={() => {
          setFocusedInteraction("search");
          searchRef.current?.focus();
        }}
        onToggleTheme={onToggleTheme}
        onOpenSettings={onOpenSettings}
      />

      <div className="scene-a11y-layer" aria-label="书房物件导航">
        <nav aria-label="记忆分类">
          {shelfOrder.map((type) => (
            <button
              key={type}
              type="button"
              className="scene-a11y-control"
              aria-label={`${shelfMeta[type].label}，${summary ? `${counts.get(type) ?? 0} 条` : "读取中"}`}
              aria-pressed={selectedType === type}
              data-scene-proxy={`shelf-${type}`}
              data-testid={`scene-shelf-${type}`}
              onClick={() => onSelectType(type)}
              {...focusProps(`shelf-${type}`)}
            />
          ))}
        </nav>
        <button type="button" className="scene-a11y-control" aria-label={typewriterLabel} data-scene-proxy="typewriter" data-testid="scene-typewriter" onClick={typewriterAction} {...focusProps("typewriter")} />
        <button type="button" className="scene-a11y-control" aria-label="打开最近记忆" data-scene-proxy="letterbox" data-testid="scene-letterbox" onClick={onBrowse} {...focusProps("letterbox")} />
        <form className="scene-a11y-search" role="search" onSubmit={onSearch}>
          <label htmlFor="library-world-search">搜索书房</label>
          <input
            id="library-world-search"
            ref={searchRef}
            value={queryInput}
            maxLength={200}
            onChange={(event) => onQueryInputChange(event.target.value)}
            aria-label="搜索书房"
            data-scene-proxy="search"
            data-testid="scene-search-input"
            {...focusProps("search")}
          />
          <button type="submit">搜索</button>
        </form>
        <button type="button" className="scene-a11y-control" aria-label={theme === "day" ? "切换到夜间书房" : "切换到白天书房"} data-scene-proxy="theme-lamp" data-testid="scene-theme" onClick={onToggleTheme} {...focusProps("theme-lamp")} />
        <button type="button" className="scene-a11y-control" aria-label="打开设置" aria-pressed={settingsOpen} data-scene-proxy="settings-gear" data-testid="scene-settings" onClick={onOpenSettings} {...focusProps("settings-gear")} />
      </div>
    </section>
  );
}
