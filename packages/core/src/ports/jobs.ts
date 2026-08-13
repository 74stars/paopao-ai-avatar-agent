import { SanitizedFailureV1Schema, type ClaimedJobV1 } from "@paopao/contracts";

export type SanitizedFailureV1 = ReturnType<typeof SanitizedFailureV1Schema.parse>;

export type JobWaitReason = "network" | "configuration";

export interface JobRepository {
  claimNext(workerId: string, leaseMs: number, now: string): ClaimedJobV1 | null;
  startAttempt(jobId: string, workerId: string, fencingToken: number): boolean;
  renewLease(jobId: string, workerId: string, fencingToken: number, leaseMs: number): boolean;
  succeed(jobId: string, workerId: string, fencingToken: number): boolean;
  retryLater(jobId: string, workerId: string, fencingToken: number, nextRunAt: string, error: SanitizedFailureV1): boolean;
  waitFor(jobId: string, workerId: string, fencingToken: number, reason: JobWaitReason, error: SanitizedFailureV1, attemptsBeforeWait?: number): boolean;
  failFinal(jobId: string, workerId: string, fencingToken: number, error: SanitizedFailureV1): boolean;
  recoverExpired(now: string): number;
  resumeWaiting(reason: JobWaitReason, now: string): number;
}

export type JobPreflight = { ready: true } | { ready: false; reason: JobWaitReason; error: SanitizedFailureV1 };

export type JobExecutionResult =
  | { outcome: "succeeded" }
  | { outcome: "retry"; error: SanitizedFailureV1 }
  | { outcome: "wait"; reason: JobWaitReason; error: SanitizedFailureV1 }
  | { outcome: "failed_final"; error: SanitizedFailureV1 };

export interface JobExecutor {
  preflight(job: ClaimedJobV1): Promise<JobPreflight>;
  execute(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult>;
}
