import type { ClaimedJobV1 } from "@paopao/contracts";
import type { JobExecutionResult, JobPreflight } from "./jobs.js";

export type AnalyzeJobV1 = Extract<ClaimedJobV1, { type: "analyze_entry" }>;

export interface ProcessingServicePort {
  preflight(job: AnalyzeJobV1): Promise<JobPreflight>;
  process(job: AnalyzeJobV1, signal: AbortSignal): Promise<JobExecutionResult>;
}
