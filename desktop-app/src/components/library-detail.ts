import type { EntryDetailV1, InsightReplyV1, MemoryAnalysisV1 } from "@paopao/contracts";

export interface EntryAiState { label: string; tone: "busy" | "warning" | "error" | "ready" }

export function entryAiState(detail: EntryDetailV1): EntryAiState {
  const jobs = detail.activeJobs;
  if (jobs.some((job) => job.status === "waiting_for_network")) return { label: "离线，联网后继续", tone: "warning" };
  if (jobs.some((job) => job.status === "waiting_for_configuration")) return { label: "等待配置 AI", tone: "warning" };
  if (jobs.some((job) => job.status === "retry_wait") || detail.status === "retry_wait") return { label: "等待重试", tone: "warning" };
  if (detail.status === "needs_review") return { label: "需要确认", tone: "warning" };
  if (detail.status === "failed_final") return { label: "AI 整理失败", tone: "error" };
  if (jobs.some((job) => job.status === "running" || job.status === "queued") || detail.status === "processing" || detail.status === "stored") return { label: "AI 整理中", tone: "busy" };
  return { label: "AI 已整理", tone: "ready" };
}

export function currentInsight(detail: EntryDetailV1): InsightReplyV1 | null {
  for (let index = detail.derivations.length - 1; index >= 0; index -= 1) {
    const item = detail.derivations[index] as { kind?: unknown; isCurrent?: unknown; value?: unknown };
    if (item.kind === "insight_reply" && item.isCurrent === true) return item.value as InsightReplyV1;
  }
  return null;
}

type SupportingDerivation =
  | { kind: "entities"; value: MemoryAnalysisV1["entities"] }
  | { kind: "goals"; value: MemoryAnalysisV1["goals"] }
  | { kind: "next_actions"; value: MemoryAnalysisV1["nextActions"] };

export function currentDerivation(detail: EntryDetailV1, kind: SupportingDerivation["kind"]): SupportingDerivation | null {
  for (let index = detail.derivations.length - 1; index >= 0; index -= 1) {
    const item = detail.derivations[index] as { kind?: unknown; isCurrent?: unknown; value?: unknown };
    if (item.kind === kind && item.isCurrent === true) return { kind, value: item.value } as SupportingDerivation;
  }
  return null;
}

export function retryableJobs(detail: EntryDetailV1): EntryDetailV1["activeJobs"] {
  return detail.activeJobs.filter((job) => job.status === "retry_wait" || job.status === "failed_final");
}
