import { randomUUID } from "node:crypto";
import type { ClaimedJobV1 } from "@paopao/contracts";
import type { JobExecutionResult, JobExecutor, JobPreflight } from "../ports/jobs.js";
import type { ProcessingServicePort } from "../ports/processing.js";

export class AnalyzeJobExecutor implements JobExecutor {
  readonly #processing: ProcessingServicePort;

  constructor(processing: ProcessingServicePort) {
    this.#processing = processing;
  }

  preflight(job: ClaimedJobV1): Promise<JobPreflight> {
    if (job.type === "analyze_entry") return this.#processing.preflight(job);
    return Promise.resolve({
      ready: false,
      reason: "configuration",
      error: { code: "AI_NOT_CONFIGURED", retryable: true, message: `No executor configured for ${job.type}`, correlationId: randomUUID() },
    });
  }

  process(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult> {
    return this.execute(job, signal);
  }

  execute(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult> {
    if (job.type === "analyze_entry") return this.#processing.process(job, signal);
    return Promise.resolve({
      outcome: "failed_final",
      error: { code: "AI_FAILED_FINAL", retryable: false, message: `No executor configured for ${job.type}`, correlationId: randomUUID() },
    });
  }
}
