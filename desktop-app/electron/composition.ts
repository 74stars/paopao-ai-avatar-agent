import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { ErrorCodeSchema, type DiagnosticEventV1Schema, type DomainEventV1 } from "@paopao/contracts";
import { createFeishuAdapter, type FeishuAdapter } from "@paopao/feishu-adapter";
import {
  createCaptureService,
  PersistentWorker,
  type BindingService,
  type CaptureService,
  type DomainEventPublisher,
  type ExternalDeliveryService,
  type JobExecutor,
} from "@paopao/core";
import {
  SqliteAnalysisUnitOfWork,
  SqliteCaptureUnitOfWork,
  SqliteEntryQueryService,
  SqliteJobRepository,
  SqliteInsightUnitOfWork,
  GovernanceError,
  createEntryGovernanceService,
  createEntryDeletionService,
  createPurgeEntryJobExecutor,
  createExportService,
  createExportJobExecutor,
  createDiagnosticsService,
  createDiagnosticsJobExecutor,
  createBackupService,
  createDesktopRestoreLifecycle,
  createBackupFacade,
  createSqliteBindingService,
  createSqliteExternalDeliveryService,
  loadDefaultPromptRegistry,
  initializeDatabase,
} from "@paopao/infrastructure";
import { createProfileBackedExecutor } from "./ai-executor.js";
import { createAiProviderServices, createProviderFromProfile } from "./ai-provider-services.js";
import {
  createMainCredentialStore,
  type AiCredentialStore,
  type AiConfigSaveRequestV1,
  type AiConfigStatusV1,
  type SafeStorageLike,
} from "./credential-store.js";
import { createProviderProfileStore, LEGACY_PROVIDER_PROFILE_ID } from "./provider-profile-store.js";
import type { DesktopCoreServicesV1 } from "./ipc.js";
import type { z } from "zod";

export interface MainComposition {
  services: DesktopCoreServicesV1;
  worker: PersistentWorker;
  start(): Promise<void>;
  checkConnectionAfterWake(): Promise<void>;
  close(): Promise<void>;
  databasePath: string;
  credentialsPath: string;
  publicSettingsPath: string;
  providerProfilesPath: string;
}

export async function createMainComposition(options: {
  databasePath: string;
  migrationsDirectory: string;
  promptsDirectory: string;
  credentialsPath: string;
  publicSettingsPath?: string;
  providerProfilesPath?: string;
  safeStorage: SafeStorageLike;
  publish: DomainEventPublisher;
  executor?: JobExecutor;
  adapterFactory?: typeof createFeishuAdapter;
  now?: () => string;
}): Promise<MainComposition> {
  const now = options.now ?? (() => new Date().toISOString());
  const clock = { now };
  const diagnosticEvents: Array<Record<string, unknown>> = [];
  const domainEventSubscribers = new Set<(event: DomainEventV1) => void>();
  const events: DomainEventPublisher = { publish: async (event) => {
    diagnosticEvents.push({ timestamp: event.occurredAt, level: event.type.includes("failed") ? "error" : "info", event: event.type, correlationId: randomUUID(), ...("entryId" in event && event.entryId ? { entryId: event.entryId } : {}), ...("jobId" in event ? { jobId: event.jobId ?? undefined } : {}), ...("errorCode" in event ? { errorCode: event.errorCode } : {}) });
    if (diagnosticEvents.length > 1000) diagnosticEvents.splice(0, diagnosticEvents.length - 1000);
    for (const handler of [...domainEventSubscribers]) {
      try { handler(event); } catch { /* Events are refresh hints and cannot own the transaction. */ }
    }
    await options.publish.publish(event);
  } };
  const prompts = loadDefaultPromptRegistry(options.promptsDirectory);
  const dataDirectory = dirname(options.databasePath);
  const publicSettingsPath = options.publicSettingsPath ?? join(dataDirectory, "settings", "public.v1.json");
  const providerProfilesPath = options.providerProfilesPath ?? join(dirname(options.credentialsPath), "ai-providers.v2.json");
  const credentialStore = createMainCredentialStore({ filePath: options.credentialsPath, publicSettingsPath, safeStorage: options.safeStorage, now });
  const providerStore = createProviderProfileStore({ filePath: providerProfilesPath, safeStorage: options.safeStorage, now });
  const legacyAi = credentialStore.status();
  const legacyApiKey = credentialStore.readApiKey();
  if (legacyAi.isConfigured && legacyApiKey) providerStore.migrateLegacy({ provider: legacyAi.provider!, model: legacyAi.model!, apiKey: legacyApiKey });
  let backupService: ReturnType<typeof createBackupService>;
  let adapter: FeishuAdapter | undefined;
  let unsubscribeAdapterStatus: (() => void) | undefined;
  let started = false;
  let closed = false;

  const assembleRuntime = (database: Awaited<ReturnType<typeof initializeDatabase>>) => {
    const query = new SqliteEntryQueryService(database);
    const capture = createCaptureService({ unitOfWork: new SqliteCaptureUnitOfWork({ database, clock }), events, clock });
    const governance = createEntryGovernanceService({ database, clock, events });
    const deletion = createEntryDeletionService({ database, clock, events });
    const exportService = createExportService({ database, clock });
    const diagnosticsService = createDiagnosticsService({ database, clock });
    const binding = createSqliteBindingService({ database, clock });
    const delivery = createSqliteExternalDeliveryService({ database, clock });
    const ai = createProfileBackedExecutor({ store: providerStore, providerFactory: createProviderFromProfile, prompts, unitOfWork: new SqliteAnalysisUnitOfWork({ database, now }), insight: { unitOfWork: new SqliteInsightUnitOfWork({ database, now }), events, clock } });
    const executor = options.executor ?? routeJobExecutors({
      ai,
      purge: createPurgeEntryJobExecutor({ database, clock, events, afterPurge: () => backupService.replaceAfterPurge().then(() => undefined) }),
      export: createExportJobExecutor({ database, outputDirectory: join(dataDirectory, "exports"), clock, events }),
      diagnostics: createDiagnosticsJobExecutor({
        database,
        outputDirectory: join(dataDirectory, "diagnostics"),
        clock,
        readEvents: (since) => diagnosticEvents.filter((item) => typeof item.timestamp === "string" && item.timestamp >= since),
        sensitiveValues: () => {
          const apiKey = credentialStore.readApiKey();
          const appSecret = credentialStore.readFeishuAppSecret();
          return [...new Set([...providerStore.sensitiveValues(), apiKey, appSecret].filter((value): value is string => Boolean(value)))];
        },
        events,
      }),
    });
    const worker = new PersistentWorker({ repository: new SqliteJobRepository(database, clock), executor, clock, events, options: { workerId: `desktop:${randomUUID()}` } });
    return { database, query, capture, governance, deletion, exportService, diagnosticsService, binding, delivery, worker };
  };

  type Runtime = ReturnType<typeof assembleRuntime>;
  let runtime: Runtime | undefined;
  let allowLifecycleWorkerStart = false;
  const requireRuntime = (): Runtime => {
    if (!runtime) throw new Error("Desktop runtime is not initialized");
    return runtime;
  };
  const buildRuntime = async (): Promise<Runtime> => {
    const database = await initializeDatabase({
      databasePath: options.databasePath,
      migrationsDirectory: options.migrationsDirectory,
      migrationBackup: backupService,
      now,
    });
    return assembleRuntime(database);
  };
  const lifecycle = createDesktopRestoreLifecycle({
    stopWorkers: async () => {
      await adapter?.disconnect();
      credentialStore.clearDecryptedCache("feishu");
      if (runtime) await runtime.worker.stop();
    },
    closeDatabase: () => { if (runtime) runtime.database.close(); },
    reopenDatabase: async () => { runtime = await buildRuntime(); },
    startWorkers: async () => {
      if (!allowLifecycleWorkerStart || !started) return;
      if (!runtime) return;
      runtime.worker.start();
      if (credentialStore.feishuStatus().isConfigured) {
        try { await adapter?.connect(); } catch { /* Adapter status remains the renderer-safe diagnostic. */ }
      }
    },
  });
  backupService = createBackupService({ databasePath: options.databasePath, backupsDirectory: join(dataDirectory, "backups"), restoreDirectory: join(dataDirectory, "restore"), lifecycle, clock, events });
  const backups = createBackupFacade(backupService);

  // Startup recovery owns the database until the journal is resolved. IPC and the
  // worker are exposed only after recovery, migration protection, and backup finish.
  try {
    await backupService.recoverInterrupted();
    if (lifecycle.availability() === "unavailable") throw new Error("Database restore recovery failed");
    runtime ??= await buildRuntime();
    await backupService.createStartupIfDue();
    allowLifecycleWorkerStart = true;
  } catch (error) {
    if (runtime) {
      await runtime.worker.stop();
      try { runtime.database.close(); } catch { /* The restore lifecycle may already have closed it. */ }
    }
    throw error;
  }

  const wake = <T>(operation: () => Promise<T>) => governanceCall(async () => { const receipt = await operation(); requireRuntime().worker.wake(); return receipt; });
  const entries: DesktopCoreServicesV1["entries"] = {
    list: async (input) => requireRuntime().query.list(input), get: async (entryId) => requireRuntime().query.get(entryId), summary: async () => requireRuntime().query.summary(),
    reviseText: (input) => wake(() => requireRuntime().governance.reviseText(input)),
    correct: (input) => governanceCall(() => requireRuntime().governance.correct(input)),
    delete: (input) => wake(() => requireRuntime().deletion.delete(input)),
  };

  const captureService: CaptureService = {
    capture: (command) => governanceCall(async () => {
      lifecycle.assertCaptureAvailable();
      return requireRuntime().capture.capture(command);
    }),
  };
  const bindingService = createBindingRuntimeProxy(requireRuntime);
  const deliveryService = createDeliveryRuntimeProxy(requireRuntime);
  adapter = (options.adapterFactory ?? createFeishuAdapter)({
    credentialProvider: credentialStore,
    captureService,
    bindingService,
    deliveryService,
    publicSettingsProvider: credentialStore,
    subscribeDomainEvents(handler) {
      domainEventSubscribers.add(handler);
      return () => domainEventSubscribers.delete(handler);
    },
    logger: {
      log(event: z.infer<typeof DiagnosticEventV1Schema>) {
        diagnosticEvents.push(event);
        if (diagnosticEvents.length > 1000) diagnosticEvents.splice(0, diagnosticEvents.length - 1000);
      },
    },
    clock,
  });
  unsubscribeAdapterStatus = adapter.subscribeStatus((event) => { void events.publish(event); });
  const services: DesktopCoreServicesV1 = {
    capture: captureService, entries,
    jobs: { retry: (input) => wake(() => requireRuntime().governance.retryJob(input)) },
    exports: { create: (input) => wake(() => requireRuntime().exportService.create(input)), get: (input) => governanceCall(() => requireRuntime().exportService.get(input)) },
    diagnostics: { create: (input) => wake(() => requireRuntime().diagnosticsService.createExport(input)), get: (input) => governanceCall(() => requireRuntime().diagnosticsService.getExport(input)) },
    backups: { list: () => governanceCall(() => backups.list({ version: 1 })), restore: (input) => governanceCall(() => backups.restore(input)), status: (restoreId) => governanceCall(() => backups.status({ version: 1, restoreId })) },
    aiConfig: {
      status: async () => credentialStore.status(),
      save: async (input) => {
        const status = credentialStore.save(input);
        providerStore.migrateLegacy(input);
        requireRuntime().worker.resumeWaiting("configuration");
        return status;
      },
      delete: async () => {
        const status = credentialStore.delete();
        providerStore.deleteLegacy();
        return status;
      },
    },
    settings: {
      getPublic: () => governanceCall(async () => {
        const profiles = providerStore.list();
        const activeProfile = profiles.profiles.find((profile) => profile.id === profiles.activeProfileId) ?? null;
        const activeResolved = activeProfile ? providerStore.resolve(activeProfile.id) : null;
        const feishu = credentialStore.feishuStatus();
        const backupsList = await backups.list({ version: 1 });
        return {
          ai: {
            configured: activeResolved !== null,
            provider: activeProfile?.kind === "direct" ? activeProfile.providerId : activeProfile ? "codex" : null,
            model: activeProfile?.model ?? null,
          },
          feishu: {
            configured: feishu.isConfigured,
            appIdMasked: feishu.appIdMasked,
            status: feishu.isConfigured ? adapter!.status() : "not_configured",
            bound: await bindingService.hasActiveBinding(),
            replyMode: await credentialStore.getFeishuReplyMode(),
            deliveryIssueCount: await deliveryService.countIssues(),
          },
          data: { databasePath: options.databasePath, lastBackupAt: backupsList.backups[0]?.createdAt ?? null },
        };
      }),
      updatePublic: (input) => governanceCall(async () => {
        if (input.feishuReplyMode) credentialStore.updateFeishuReplyMode(input.feishuReplyMode);
        return services.settings!.getPublic();
      }),
      saveAiCredential: (input) => governanceCall(async () => {
        const receipt = credentialStore.saveAiCredential(input);
        providerStore.migrateLegacy(input);
        requireRuntime().worker.resumeWaiting("configuration");
        return receipt;
      }),
      deleteAiCredential: () => governanceCall(async () => {
        credentialStore.delete();
        providerStore.deleteLegacy();
        credentialStore.clearDecryptedCache("ai");
        return { configured: false as const };
      }),
      saveFeishuCredential: (input) => governanceCall(async () => {
        await adapter!.disconnect();
        return credentialStore.saveFeishu(input);
      }),
      deleteFeishuCredential: () => governanceCall(async () => {
        await adapter!.disconnect();
        const receipt = credentialStore.deleteFeishu();
        credentialStore.clearDecryptedCache("feishu");
        return receipt;
      }),
    },
    aiProviders: createAiProviderServices({
      store: providerStore,
      worker: { resumeWaiting: (reason) => requireRuntime().worker.resumeWaiting(reason) },
      now,
      afterSave: (profile) => { if (profile.id === LEGACY_PROVIDER_PROFILE_ID) credentialStore.delete(); },
      afterDelete: (profileId) => { if (profileId === LEGACY_PROVIDER_PROFILE_ID) credentialStore.delete(); },
    }),
    feishu: {
      connect: () => governanceCall(async () => { await adapter!.connect(); return { status: adapter!.status() }; }),
      disconnect: () => governanceCall(async () => { await adapter!.disconnect(); return { status: adapter!.status() }; }),
      createBindingCode: () => governanceCall(() => bindingService.createCode()),
      listDeliveryIssues: (input) => governanceCall(() => deliveryService.listIssues({ ...(input.cursor ? { cursor: input.cursor } : {}), limit: input.limit })),
      resolveDeliveryIssue: (input) => governanceCall(() => deliveryService.resolveIssue(input)),
    },
  };

  return {
    databasePath: options.databasePath,
    credentialsPath: options.credentialsPath,
    publicSettingsPath,
    providerProfilesPath,
    services,
    get worker() { return requireRuntime().worker; },
    async start() {
      if (started || closed) return;
      started = true;
      requireRuntime().worker.start();
      if (credentialStore.feishuStatus().isConfigured) {
        try { await adapter!.connect(); } catch { /* Desktop remains usable; status event carries the stable failure code. */ }
      }
    },
    async checkConnectionAfterWake() {
      if (!started || closed || !credentialStore.feishuStatus().isConfigured) return;
      await governanceCall(() => adapter!.checkConnectionAfterWake());
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await adapter!.disconnect();
      } finally {
        unsubscribeAdapterStatus?.();
        unsubscribeAdapterStatus = undefined;
        credentialStore.clearDecryptedCache("all");
        try {
          await requireRuntime().worker.stop();
        } finally {
          if (lifecycle.availability() === "available") requireRuntime().database.close();
        }
      }
    },
  };
}

export function routeJobExecutors(executors: { ai: JobExecutor; purge: JobExecutor; export: JobExecutor; diagnostics: JobExecutor }): JobExecutor {
  const select = (job: Parameters<JobExecutor["preflight"]>[0]) => job.type === "purge_entry" ? executors.purge : job.type === "create_export" ? executors.export : job.type === "create_diagnostics_export" ? executors.diagnostics : executors.ai;
  return { preflight: (job) => select(job).preflight(job), execute: (job, signal) => select(job).execute(job, signal) };
}

export async function governanceCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const parsedCode = ErrorCodeSchema.safeParse((error as { code?: unknown } | null)?.code);
    if (!(error instanceof GovernanceError) && !parsedCode.success) throw error;
    const code = error instanceof GovernanceError ? error.code : parsedCode.data;
    throw {
      code,
      message: error instanceof Error ? error.message : "Data operation failed",
      retryable: typeof (error as { retryable?: unknown } | null)?.retryable === "boolean"
        ? (error as { retryable: boolean }).retryable
        : code === "DATABASE_UNAVAILABLE",
      correlationId: randomUUID(),
    };
  }
}

function createBindingRuntimeProxy(requireRuntime: () => { binding: BindingService }): BindingService {
  return {
    createCode: (ttlMs) => requireRuntime().binding.createCode(ttlMs),
    isBound: (input) => requireRuntime().binding.isBound(input),
    hasActiveBinding: () => requireRuntime().binding.hasActiveBinding(),
    consumeCode: (input) => requireRuntime().binding.consumeCode(input),
    unbind: (input) => requireRuntime().binding.unbind(input),
  };
}

function createDeliveryRuntimeProxy(requireRuntime: () => { delivery: ExternalDeliveryService }): ExternalDeliveryService {
  return {
    listDue: (input) => requireRuntime().delivery.listDue(input),
    claimReply: (input) => requireRuntime().delivery.claimReply(input),
    renewReplyLease: (input) => requireRuntime().delivery.renewReplyLease(input),
    completeReply: (input) => requireRuntime().delivery.completeReply(input),
    failReply: (input) => requireRuntime().delivery.failReply(input),
    claimControlEvent: (input) => requireRuntime().delivery.claimControlEvent(input),
    completeControlEvent: (input) => requireRuntime().delivery.completeControlEvent(input),
    listIssues: (input) => requireRuntime().delivery.listIssues(input),
    countIssues: () => requireRuntime().delivery.countIssues(),
    resolveIssue: (input) => requireRuntime().delivery.resolveIssue(input),
    recoverStaleClaims: (input) => requireRuntime().delivery.recoverStaleClaims(input),
  };
}

export function createAiConfigServices(store: AiCredentialStore, worker: Pick<PersistentWorker, "resumeWaiting">): DesktopCoreServicesV1["aiConfig"] {
  return {
    status: async (): Promise<AiConfigStatusV1> => store.status(),
    save: async (input: AiConfigSaveRequestV1): Promise<AiConfigStatusV1> => {
      const status = store.save(input);
      worker.resumeWaiting("configuration");
      return status;
    },
    delete: async (): Promise<AiConfigStatusV1> => store.delete(),
  };
}

export function resolveRuntimeResources(
  appPath: string,
  isPackaged: boolean,
  resourcesPath = join(appPath, "resources"),
): { migrationsDirectory: string; promptsDirectory: string } {
  if (isPackaged) {
    return {
      migrationsDirectory: join(resourcesPath, "migrations"),
      promptsDirectory: join(resourcesPath, "prompts"),
    };
  }
  return {
    migrationsDirectory: join(appPath, "..", "packages", "infrastructure", "src", "database", "migrations"),
    promptsDirectory: join(appPath, "..", "prompts"),
  };
}
