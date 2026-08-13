import { AiRunMetadataV1Schema, type ClaimedJobV1, type InsightReplyV1 } from "@paopao/contracts";
import type { JobExecutionResult, JobPreflight, SanitizedFailureV1 } from "./jobs.js";

export type GenerateInsightJobV1 = Extract<ClaimedJobV1, { type: "generate_insight" }>;
export type AiRunMetadataV1 = ReturnType<typeof AiRunMetadataV1Schema.parse>;

export type InsightProcessingResult =
  | { outcome: "succeeded"; reply: InsightReplyV1; metadata: AiRunMetadataV1; promptVersion: string; attempts: number }
  | { outcome: "discarded" }
  | { outcome: "retry"; error: SanitizedFailureV1 }
  | { outcome: "wait"; reason: "network" | "configuration"; error: SanitizedFailureV1 }
  | { outcome: "failed_final"; error: SanitizedFailureV1 };

export interface InsightProcessingServicePort {
  preflight(job: GenerateInsightJobV1): Promise<JobPreflight>;
  process(job: GenerateInsightJobV1, signal: AbortSignal): Promise<InsightProcessingResult>;
}

export interface InsightCommitPort {
  commit(job: GenerateInsightJobV1, reply: InsightReplyV1, metadata: AiRunMetadataV1): { state: "committed"; derivationId: string } | { state: "already_committed" | "stale" };
  auditFailure(job: GenerateInsightJobV1, errorCode: SanitizedFailureV1["code"]): boolean;
}

export interface InsightJobExecutorPort {
  preflight(job: GenerateInsightJobV1): Promise<JobPreflight>;
  execute(job: GenerateInsightJobV1, signal: AbortSignal): Promise<JobExecutionResult>;
}
