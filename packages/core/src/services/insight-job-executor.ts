import type { ClaimedJobV1 } from "@paopao/contracts";
import type { JobExecutionResult, JobExecutor, JobPreflight } from "../ports/jobs.js";
import type { GenerateInsightJobV1, InsightCommitPort, InsightProcessingServicePort } from "../ports/insight.js";
import type { Clock, DomainEventPublisher } from "../ports/runtime.js";

export class InsightJobExecutor implements JobExecutor {
  constructor(
    private readonly processing: InsightProcessingServicePort,
    private readonly unitOfWork: InsightCommitPort,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  preflight(job: ClaimedJobV1): Promise<JobPreflight> {
    return this.processing.preflight(asInsightJob(job));
  }

  async execute(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult> {
    const insightJob = asInsightJob(job);
    const result = await this.processing.process(insightJob, signal);
    if (result.outcome === "discarded") return { outcome: "succeeded" };
    if (result.outcome !== "succeeded") {
      this.unitOfWork.auditFailure(insightJob, result.error.code);
      return result;
    }
    const committed = this.unitOfWork.commit(insightJob, result.reply, result.metadata);
    if (committed.state === "committed") {
      try {
        await this.events.publish({ version: 1, type: "insight:ready", entryId: insightJob.entryId, derivationId: committed.derivationId, occurredAt: this.clock.now() });
      } catch {
        // SQLite remains authoritative when an event subscriber is unavailable.
      }
    }
    return { outcome: "succeeded" };
  }
}

export function createInsightJobExecutor(dependencies: {
  processing: InsightProcessingServicePort;
  unitOfWork: InsightCommitPort;
  events: DomainEventPublisher;
  clock: Clock;
}): InsightJobExecutor {
  return new InsightJobExecutor(dependencies.processing, dependencies.unitOfWork, dependencies.events, dependencies.clock);
}

function asInsightJob(job: ClaimedJobV1): GenerateInsightJobV1 {
  if (job.type !== "generate_insight") throw new Error("InsightJobExecutor only accepts generate_insight jobs");
  return job;
}
