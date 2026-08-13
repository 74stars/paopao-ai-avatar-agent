import { randomUUID } from "node:crypto";
import type { ClaimedJobV1, DomainEventV1, ErrorCode, JobStatus } from "@paopao/contracts";
import type { JobExecutor, JobRepository, JobWaitReason, SanitizedFailureV1 } from "../ports/jobs.js";
import type { Clock, DomainEventPublisher } from "../ports/runtime.js";

const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000] as const;

export interface WorkerOptions {
  workerId: string;
  leaseMs?: number;
  pollIntervalMs?: number;
  jitter?: (baseMs: number) => number;
  unexpectedFailure?: (error: unknown) => SanitizedFailureV1;
}

export class PersistentWorker {
  readonly #repository: JobRepository;
  readonly #executor: JobExecutor;
  readonly #clock: Clock;
  readonly #events: DomainEventPublisher;
  readonly #workerId: string;
  readonly #leaseMs: number;
  readonly #pollIntervalMs: number;
  readonly #jitter: (baseMs: number) => number;
  readonly #unexpectedFailure: (error: unknown) => SanitizedFailureV1;
  #running = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #active: Promise<boolean> | undefined;
  #wakePending = false;

  constructor(dependencies: {
    repository: JobRepository;
    executor: JobExecutor;
    clock: Clock;
    events: DomainEventPublisher;
    options: WorkerOptions;
  }) {
    this.#repository = dependencies.repository;
    this.#executor = dependencies.executor;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
    this.#workerId = dependencies.options.workerId;
    this.#leaseMs = dependencies.options.leaseMs ?? 60_000;
    this.#pollIntervalMs = dependencies.options.pollIntervalMs ?? 1_000;
    this.#jitter = dependencies.options.jitter ?? ((baseMs) => Math.round(baseMs * (0.8 + Math.random() * 0.4)));
    this.#unexpectedFailure = dependencies.options.unexpectedFailure ?? (() => ({
      code: "INTERNAL_ERROR",
      retryable: false,
      message: "Unexpected job execution failure",
      correlationId: randomUUID(),
    }));
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#repository.recoverExpired(this.#clock.now());
    this.#schedule(0);
  }

  wake(): void {
    if (!this.#running) return;
    this.#wakePending = true;
    if (!this.#active) this.#schedule(0);
  }

  resumeWaiting(reason: JobWaitReason): number {
    const resumed = this.#repository.resumeWaiting(reason, this.#clock.now());
    if (resumed > 0) this.wake();
    return resumed;
  }

  async runOnce(): Promise<boolean> {
    if (this.#active) return this.#active;
    const active = this.#processOne();
    this.#active = active;
    try {
      return await active;
    } finally {
      this.#active = undefined;
    }
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#active;
  }

  #schedule(delayMs: number): void {
    if (!this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.runOnce()
        .then((processed) => {
          const immediate = processed || this.#wakePending;
          this.#wakePending = false;
          this.#schedule(immediate ? 0 : this.#pollIntervalMs);
        })
        .catch(() => this.#schedule(this.#pollIntervalMs));
    }, delayMs);
  }

  async #processOne(): Promise<boolean> {
    const job = this.#repository.claimNext(this.#workerId, this.#leaseMs, this.#clock.now());
    if (!job) return false;
    await this.#publishProgress(job, "running");

    let preflight;
    try {
      preflight = await this.#executor.preflight(job);
    } catch (error) {
      const failure = this.#unexpectedFailure(error);
      if (this.#repository.failFinal(job.id, this.#workerId, job.fencingToken, failure)) await this.#publishFailed(job, failure.code, failure.retryable);
      return true;
    }
    if (!preflight.ready) {
      if (this.#repository.waitFor(job.id, this.#workerId, job.fencingToken, preflight.reason, preflight.error, job.attempts)) {
        await this.#publishProgress(job, preflight.reason === "network" ? "waiting_for_network" : "waiting_for_configuration");
      }
      return true;
    }

    if (!this.#repository.startAttempt(job.id, this.#workerId, job.fencingToken)) return true;
    const abort = new AbortController();
    const renewEvery = Math.max(100, Math.floor(this.#leaseMs / 2));
    const renewal = setInterval(() => {
      if (!this.#repository.renewLease(job.id, this.#workerId, job.fencingToken, this.#leaseMs)) abort.abort();
    }, renewEvery);

    try {
      let result;
      try {
        result = await this.#executor.execute(job, abort.signal);
      } catch (error) {
        result = { outcome: "failed_final" as const, error: this.#unexpectedFailure(error) };
      }
      if (result.outcome === "succeeded") {
        if (this.#repository.succeed(job.id, this.#workerId, job.fencingToken)) await this.#publishProgress(job, "succeeded");
      } else if (result.outcome === "wait") {
        if (this.#repository.waitFor(job.id, this.#workerId, job.fencingToken, result.reason, result.error, job.attempts)) {
          await this.#publishProgress(job, result.reason === "network" ? "waiting_for_network" : "waiting_for_configuration");
        }
      } else if (result.outcome === "retry" && result.error.retryable && job.attempts + 1 < job.maxAttempts) {
        const baseMs = BACKOFF_MS[Math.min(job.attempts, BACKOFF_MS.length - 1)];
        const nextRunAt = new Date(Date.parse(this.#clock.now()) + Math.max(0, this.#jitter(baseMs))).toISOString();
        if (this.#repository.retryLater(job.id, this.#workerId, job.fencingToken, nextRunAt, result.error)) {
          await this.#publishProgress(job, "retry_wait");
        }
      } else {
        const error = result.error;
        if (this.#repository.failFinal(job.id, this.#workerId, job.fencingToken, error)) {
          await this.#publishFailed(job, error.code, error.retryable);
        }
      }
    } finally {
      clearInterval(renewal);
    }
    return true;
  }

  async #publishProgress(job: ClaimedJobV1, status: JobStatus): Promise<void> {
    const event: DomainEventV1 = { version: 1, type: "job:progress", jobId: job.id, entryId: job.entryId, status, occurredAt: this.#clock.now() };
    try {
      await this.#events.publish(event);
    } catch {
      // Job state is authoritative and can be refreshed from SQLite.
    }
  }

  async #publishFailed(job: ClaimedJobV1, errorCode: ErrorCode, retryable: boolean): Promise<void> {
    const event: DomainEventV1 = { version: 1, type: "job:failed", jobId: job.id, entryId: job.entryId, errorCode, retryable, occurredAt: this.#clock.now() };
    try {
      await this.#events.publish(event);
    } catch {
      // Job state is authoritative and can be refreshed from SQLite.
    }
  }
}
