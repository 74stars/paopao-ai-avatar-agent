import { randomUUID } from "node:crypto";
import type { ClaimedJobV1 } from "@paopao/contracts";
import { createInsightJobExecutor, type Clock, type DomainEventPublisher, type JobExecutionResult, type JobExecutor, type JobPreflight, type SanitizedFailureV1 } from "@paopao/core";
import {
  InsightProcessingService,
  ProcessingService,
  createOpenAiProvider,
  type AiProviderV1,
  type PromptRegistry,
  type SqliteAnalysisUnitOfWork,
  type SqliteInsightUnitOfWork
} from "@paopao/infrastructure";
import type { AiCredentialStore } from "./credential-store.js";
import type { ProviderProfileStore, ResolvedProviderProfile } from "./provider-profile-store.js";

export interface CredentialBackedExecutorOptions {
  store: AiCredentialStore;
  prompts: PromptRegistry;
  unitOfWork: SqliteAnalysisUnitOfWork;
  insight?: { unitOfWork: SqliteInsightUnitOfWork; events: DomainEventPublisher; clock: Clock };
  /** Injectable for tests; defaults to the real OpenAI provider. */
  providerFactory?: (apiKey: string) => AiProviderV1;
}

export interface ProfileBackedExecutorOptions {
  store: ProviderProfileStore;
  prompts: PromptRegistry;
  unitOfWork: SqliteAnalysisUnitOfWork;
  insight?: { unitOfWork: SqliteInsightUnitOfWork; events: DomainEventPublisher; clock: Clock };
  providerFactory: (resolved: ResolvedProviderProfile) => AiProviderV1;
}

/**
 * Builds the AI provider lazily from the credential store and keeps at most one
 * provider/processing instance per store generation. Deleting credentials bumps
 * the generation so any previously built provider instance is dropped
 * immediately.
 */
export function createCredentialBackedExecutor(options: CredentialBackedExecutorOptions): JobExecutor {
  const providerFactory = options.providerFactory ?? ((apiKey: string) => createOpenAiProvider({ apiKey }));
  let cached: { generation: number; analyze: ProcessingService; insight: JobExecutor | null } | null = null;

  const resolveExecutors = (): { analyze: ProcessingService; insight: JobExecutor | null } | null => {
    if (!options.store.status().isConfigured) {
      cached = null;
      return null;
    }
    const apiKey = options.store.readApiKey();
    if (apiKey === null) {
      cached = null;
      return null;
    }
    const generation = options.store.generation();
    if (cached && cached.generation === generation) return cached;

    const provider = providerFactory(apiKey);
    const analyze = new ProcessingService({
        provider,
        prompts: options.prompts,
        unitOfWork: options.unitOfWork,
        configured: () => options.store.status().isConfigured
      });
    const insightProcessing = options.insight ? new InsightProcessingService({
      provider,
      prompts: options.prompts,
      load: options.insight.unitOfWork.load,
      configured: () => options.store.status().isConfigured,
    }) : null;
    cached = { generation, analyze, insight: options.insight && insightProcessing ? createInsightJobExecutor({ processing: insightProcessing, unitOfWork: options.insight.unitOfWork, events: options.insight.events, clock: options.insight.clock }) : null };
    return cached;
  };

  const notConfigured = (): SanitizedFailureV1 => ({
    code: "AI_NOT_CONFIGURED",
    retryable: true,
    message: "AI provider is not configured",
    correlationId: randomUUID()
  });

  const resolveJobExecutor = (job: ClaimedJobV1): JobExecutor | null => {
    const executors = resolveExecutors();
    if (!executors) return null;
    if (job.type === "analyze_entry") return {
      preflight: (current) => {
        if (current.type !== "analyze_entry") throw new Error("Analyze executor received an unsupported job");
        return executors.analyze.preflight(current);
      },
      execute: (current, signal) => {
        if (current.type !== "analyze_entry") throw new Error("Analyze executor received an unsupported job");
        return executors.analyze.process(current, signal);
      },
    };
    if (job.type === "generate_insight") return executors.insight;
    return null;
  };

  return {
    async preflight(job: ClaimedJobV1): Promise<JobPreflight> {
      const executor = resolveJobExecutor(job);
      return executor ? executor.preflight(job) : { ready: false, reason: "configuration", error: notConfigured() };
    },
    async execute(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult> {
      const executor = resolveJobExecutor(job);
      return executor ? executor.execute(job, signal) : { outcome: "wait", reason: "configuration", error: notConfigured() };
    }
  };
}

/**
 * V2 executor backed by the active Provider Profile. Configuration revisions
 * invalidate the cached adapter without exposing credentials outside Main.
 */
export function createProfileBackedExecutor(options: ProfileBackedExecutorOptions): JobExecutor {
  let cached: { generation: number; profileId: string; analyze: ProcessingService; insight: JobExecutor | null } | null = null;

  const resolveExecutors = (): { analyze: ProcessingService; insight: JobExecutor | null } | null => {
    const resolved = options.store.resolveActive();
    if (!resolved) {
      cached = null;
      return null;
    }
    if (cached && cached.generation === resolved.generation && cached.profileId === resolved.profile.id) return cached;

    const provider = options.providerFactory(resolved);
    const stillConfigured = () => options.store.resolveActive()?.profile.id === resolved.profile.id;
    const analyze = new ProcessingService({
      provider,
      prompts: options.prompts,
      unitOfWork: options.unitOfWork,
      configured: stillConfigured,
    });
    const insightProcessing = options.insight ? new InsightProcessingService({
      provider,
      prompts: options.prompts,
      load: options.insight.unitOfWork.load,
      configured: stillConfigured,
    }) : null;
    cached = {
      generation: resolved.generation,
      profileId: resolved.profile.id,
      analyze,
      insight: options.insight && insightProcessing
        ? createInsightJobExecutor({ processing: insightProcessing, unitOfWork: options.insight.unitOfWork, events: options.insight.events, clock: options.insight.clock })
        : null,
    };
    return cached;
  };

  const notConfigured = (): SanitizedFailureV1 => ({
    code: "AI_NOT_CONFIGURED",
    retryable: true,
    message: "AI provider is not configured",
    correlationId: randomUUID(),
  });

  const resolveJobExecutor = (job: ClaimedJobV1): JobExecutor | null => {
    const executors = resolveExecutors();
    if (!executors) return null;
    if (job.type === "analyze_entry") return {
      preflight: (current) => {
        if (current.type !== "analyze_entry") throw new Error("Analyze executor received an unsupported job");
        return executors.analyze.preflight(current);
      },
      execute: (current, signal) => {
        if (current.type !== "analyze_entry") throw new Error("Analyze executor received an unsupported job");
        return executors.analyze.process(current, signal);
      },
    };
    if (job.type === "generate_insight") return executors.insight;
    return null;
  };

  return {
    async preflight(job: ClaimedJobV1): Promise<JobPreflight> {
      const executor = resolveJobExecutor(job);
      return executor ? executor.preflight(job) : { ready: false, reason: "configuration", error: notConfigured() };
    },
    async execute(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult> {
      const executor = resolveJobExecutor(job);
      return executor ? executor.execute(job, signal) : { outcome: "wait", reason: "configuration", error: notConfigured() };
    },
  };
}
