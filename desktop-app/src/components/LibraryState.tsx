import type { ReactNode } from "react";
import type { EntrySource, EntryStatus } from "@paopao/contracts";

export type LibraryLoadState = "loading" | "ready" | "error";

export function statusLabel(status: EntryStatus): string {
  return ({ stored: "已记录", processing: "AI 整理中", retry_wait: "等待重试", needs_review: "需要确认", ready: "AI 已整理", failed_final: "AI 整理失败", deleting: "删除中", purged: "已删除" } as const)[status];
}

export function captureChannelLabel(source: EntrySource): string {
  return source === "desktop" ? "桌面泡泡" : "飞书";
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatDayLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return "今日";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
}

export function LibraryState({ state, error, onRetry, children }: {
  state: LibraryLoadState;
  error: string;
  onRetry(): void;
  children?: ReactNode;
}) {
  if (state === "loading") {
    return <div className="library-state loading" role="status"><span className="state-dot" aria-hidden="true" />正在读取书房…</div>;
  }
  if (state === "error") {
    return <div className="library-state error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>重试</button></div>;
  }
  return <div className="library-state">{children}</div>;
}
