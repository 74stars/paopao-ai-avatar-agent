import { randomUUID } from "node:crypto";
import {
  AppErrorSchema,
  ActivateAiProviderProfileRequestV2Schema,
  AiProviderDeleteReceiptV2Schema,
  AiProviderProfileReceiptV2Schema,
  AiProviderProbeResultV2Schema,
  AiProviderProfilesV2Schema,
  CaptureReceiptV1Schema,
  DesktopCaptureRequestV1Schema,
  EntryDetailV1Schema,
  EntryGetRequestV1Schema,
  EntryListRequestV1Schema,
  EntryListResponseV1Schema,
  EntryReviseTextRequestV1Schema,
  EntryCorrectRequestV1Schema,
  TextRevisionReceiptV1Schema,
  CorrectionReceiptV1Schema,
  JobRetryRequestV1Schema,
  JobRetryResponseV1Schema,
  LibrarySummaryRequestV1Schema,
  LibrarySummaryV1Schema,
  BindingCodeReceiptV1Schema,
  CredentialReceiptV1Schema,
  CodexDiscoveryRequestV2Schema,
  CodexDiscoveryV2Schema,
  DeleteAiProviderProfileRequestV2Schema,
  DeliveryIssueListRequestV1Schema,
  FeishuConnectionReceiptV1Schema,
  FeishuDeliveryIssueListResponseV1Schema,
  PublicSettingsRequestV1Schema,
  PublicSettingsV1Schema,
  ProbeAiProviderProfileRequestV2Schema,
  ResolveFeishuDeliveryIssueRequestV1Schema,
  ResolveFeishuDeliveryIssueReceiptV1Schema,
  SaveAiCredentialRequestV1Schema,
  SaveAiProviderProfileRequestV2Schema,
  SaveFeishuCredentialRequestV1Schema,
  UpdatePublicSettingsRequestV1Schema,
  ResultSchema,
  type CaptureCommandV1,
  type CaptureReceiptV1,
  type DesktopCaptureRequestV1,
  type EntryDetailV1,
  type EntryListRequestV1,
  type EntryListResponseV1,
  type EntryCorrectRequestV1,
  type ErrorCode,
  type PaopaoApiV1,
  type Result
} from "@paopao/contracts";
import { z } from "zod";
import { IPC_CHANNELS } from "./preload-shared/ipc-channels.js";
import {
  BackupListRequestV1Schema, BackupListResponseV1Schema, BackupRestoreRequestV1Schema, BackupRestoreReceiptV1Schema, BackupRestoreStatusRequestV1Schema, BackupRestoreStatusV1Schema,
  DiagnosticsExportCreateRequestV1Schema, DiagnosticsExportReceiptV1Schema, DiagnosticsExportGetRequestV1Schema, DiagnosticsExportStatusV1Schema,
  EntryDeleteRequestV1Schema, EntryDeleteReceiptV1Schema, ExportCreateRequestV1Schema, ExportReceiptV1Schema, ExportGetRequestV1Schema, ExportStatusV1Schema,
} from "./maintenance-contracts.js";
import {
  type AiConfigSaveRequestV1,
  type AiConfigStatusV1
} from "./credential-store.js";

export { IPC_CHANNELS } from "./preload-shared/ipc-channels.js";

export type DesktopApiV1 = Pick<PaopaoApiV1, "capture" | "library" | "jobs" | "exports" | "diagnostics"> & {
  entries: Pick<PaopaoApiV1["entries"], "list" | "get" | "reviseText" | "correct" | "delete">;
  backups: {
    list(input: z.infer<typeof BackupListRequestV1Schema>): Promise<Result<z.infer<typeof BackupListResponseV1Schema>>>;
    restore(input: z.infer<typeof BackupRestoreRequestV1Schema>): Promise<Result<z.infer<typeof BackupRestoreReceiptV1Schema>>>;
    status(input: z.infer<typeof BackupRestoreStatusRequestV1Schema>): Promise<Result<z.infer<typeof BackupRestoreStatusV1Schema>>>;
  };
  settings: {
    getPublic(input: z.infer<typeof PublicSettingsRequestV1Schema>): Promise<Result<z.infer<typeof PublicSettingsV1Schema>>>;
    updatePublic(input: z.infer<typeof UpdatePublicSettingsRequestV1Schema>): Promise<Result<z.infer<typeof PublicSettingsV1Schema>>>;
    saveAiCredential(input: z.infer<typeof SaveAiCredentialRequestV1Schema>): Promise<Result<z.infer<typeof CredentialReceiptV1Schema>>>;
    deleteAiCredential(input: z.infer<typeof PublicSettingsRequestV1Schema>): Promise<Result<{ configured: false }>>;
    saveFeishuCredential(input: z.infer<typeof SaveFeishuCredentialRequestV1Schema>): Promise<Result<z.infer<typeof CredentialReceiptV1Schema>>>;
    deleteFeishuCredential(input: z.infer<typeof PublicSettingsRequestV1Schema>): Promise<Result<{ configured: false }>>;
  };
  aiProviders: {
    list(input: { version: 2 }): Promise<Result<z.infer<typeof AiProviderProfilesV2Schema>>>;
    save(input: z.infer<typeof SaveAiProviderProfileRequestV2Schema>): Promise<Result<z.infer<typeof AiProviderProfileReceiptV2Schema>>>;
    activate(input: z.infer<typeof ActivateAiProviderProfileRequestV2Schema>): Promise<Result<z.infer<typeof AiProviderProfilesV2Schema>>>;
    delete(input: z.infer<typeof DeleteAiProviderProfileRequestV2Schema>): Promise<Result<z.infer<typeof AiProviderDeleteReceiptV2Schema>>>;
    probe(input: z.infer<typeof ProbeAiProviderProfileRequestV2Schema>): Promise<Result<z.infer<typeof AiProviderProbeResultV2Schema>>>;
    discoverCodex(input: z.infer<typeof CodexDiscoveryRequestV2Schema>): Promise<Result<z.infer<typeof CodexDiscoveryV2Schema>>>;
  };
  feishu: {
    connect(input: z.infer<typeof PublicSettingsRequestV1Schema>): Promise<Result<z.infer<typeof FeishuConnectionReceiptV1Schema>>>;
    disconnect(input: z.infer<typeof PublicSettingsRequestV1Schema>): Promise<Result<z.infer<typeof FeishuConnectionReceiptV1Schema>>>;
    createBindingCode(input: z.infer<typeof PublicSettingsRequestV1Schema>): Promise<Result<z.infer<typeof BindingCodeReceiptV1Schema>>>;
    listDeliveryIssues(input: z.infer<typeof DeliveryIssueListRequestV1Schema>): Promise<Result<z.infer<typeof FeishuDeliveryIssueListResponseV1Schema>>>;
    resolveDeliveryIssue(input: z.infer<typeof ResolveFeishuDeliveryIssueRequestV1Schema>): Promise<Result<z.infer<typeof ResolveFeishuDeliveryIssueReceiptV1Schema>>>;
  };
};

export interface DesktopCoreServicesV1 {
  capture: { capture(command: CaptureCommandV1): Promise<CaptureReceiptV1> };
  entries: {
    list(input: EntryListRequestV1): Promise<EntryListResponseV1>;
    get(entryId: string): Promise<EntryDetailV1>;
    summary(): Promise<z.infer<typeof LibrarySummaryV1Schema>>;
    reviseText?(input: z.infer<typeof EntryReviseTextRequestV1Schema>): Promise<z.infer<typeof TextRevisionReceiptV1Schema>>;
    correct?(input: EntryCorrectRequestV1): Promise<z.infer<typeof CorrectionReceiptV1Schema>>;
    delete?(input: z.infer<typeof EntryDeleteRequestV1Schema>): Promise<z.infer<typeof EntryDeleteReceiptV1Schema>>;
  };
  jobs?: { retry(input: z.infer<typeof JobRetryRequestV1Schema>): Promise<z.infer<typeof JobRetryResponseV1Schema>> };
  exports?: { create(input: z.infer<typeof ExportCreateRequestV1Schema>): Promise<z.infer<typeof ExportReceiptV1Schema>>; get(input: z.infer<typeof ExportGetRequestV1Schema>): Promise<z.infer<typeof ExportStatusV1Schema>> };
  diagnostics?: { create(input: z.infer<typeof DiagnosticsExportCreateRequestV1Schema>): Promise<z.infer<typeof DiagnosticsExportReceiptV1Schema>>; get(input: z.infer<typeof DiagnosticsExportGetRequestV1Schema>): Promise<z.infer<typeof DiagnosticsExportStatusV1Schema>> };
  backups?: { list(): Promise<z.infer<typeof BackupListResponseV1Schema>>; restore(input: z.infer<typeof BackupRestoreRequestV1Schema>): Promise<z.infer<typeof BackupRestoreReceiptV1Schema>>; status(restoreId: string): Promise<z.infer<typeof BackupRestoreStatusV1Schema>> };
  aiConfig: {
    status(): Promise<AiConfigStatusV1>;
    save(input: AiConfigSaveRequestV1): Promise<AiConfigStatusV1>;
    delete(): Promise<AiConfigStatusV1>;
  };
  settings?: {
    getPublic(): Promise<z.infer<typeof PublicSettingsV1Schema>>;
    updatePublic(input: z.infer<typeof UpdatePublicSettingsRequestV1Schema>): Promise<z.infer<typeof PublicSettingsV1Schema>>;
    saveAiCredential(input: z.infer<typeof SaveAiCredentialRequestV1Schema>): Promise<z.infer<typeof CredentialReceiptV1Schema>>;
    deleteAiCredential(): Promise<{ configured: false }>;
    saveFeishuCredential(input: z.infer<typeof SaveFeishuCredentialRequestV1Schema>): Promise<z.infer<typeof CredentialReceiptV1Schema>>;
    deleteFeishuCredential(): Promise<{ configured: false }>;
  };
  aiProviders?: {
    list(): Promise<z.infer<typeof AiProviderProfilesV2Schema>>;
    save(input: z.infer<typeof SaveAiProviderProfileRequestV2Schema>): Promise<z.infer<typeof AiProviderProfileReceiptV2Schema>>;
    activate(profileId: string): Promise<z.infer<typeof AiProviderProfilesV2Schema>>;
    delete(profileId: string): Promise<z.infer<typeof AiProviderDeleteReceiptV2Schema>>;
    probe(profileId: string): Promise<z.infer<typeof AiProviderProbeResultV2Schema>>;
    discoverCodex(input: z.infer<typeof CodexDiscoveryRequestV2Schema>): Promise<z.infer<typeof CodexDiscoveryV2Schema>>;
  };
  feishu?: {
    connect(): Promise<z.infer<typeof FeishuConnectionReceiptV1Schema>>;
    disconnect(): Promise<z.infer<typeof FeishuConnectionReceiptV1Schema>>;
    createBindingCode(): Promise<z.infer<typeof BindingCodeReceiptV1Schema>>;
    listDeliveryIssues(input: z.infer<typeof DeliveryIssueListRequestV1Schema>): Promise<z.infer<typeof FeishuDeliveryIssueListResponseV1Schema>>;
    resolveDeliveryIssue(input: z.infer<typeof ResolveFeishuDeliveryIssueRequestV1Schema>): Promise<z.infer<typeof ResolveFeishuDeliveryIssueReceiptV1Schema>>;
  };
}

const deleteCredentialReceiptSchema = z.object({ configured: z.literal(false) }).strict();
const providerListRequestSchema = z.object({ version: z.literal(2) }).strict();

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

interface Route<Input, Output> {
  channel: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  invoke(input: Input): Promise<Output>;
}

export function registerPaopaoIpc(ipc: IpcMainRegistrar, api: DesktopApiV1) {
  const removeRoutes = [
    registerRoute(ipc, route(IPC_CHANNELS.captureCreate, DesktopCaptureRequestV1Schema, ResultSchema(CaptureReceiptV1Schema), (input) => api.capture.create(input))),
    registerRoute(ipc, route(IPC_CHANNELS.entryList, EntryListRequestV1Schema, ResultSchema(EntryListResponseV1Schema), (input) => api.entries.list(input))),
    registerRoute(ipc, route(IPC_CHANNELS.entryGet, EntryGetRequestV1Schema, ResultSchema(EntryDetailV1Schema), (input) => api.entries.get(input))),
    registerRoute(ipc, route(IPC_CHANNELS.entryReviseText, EntryReviseTextRequestV1Schema, ResultSchema(TextRevisionReceiptV1Schema), (input) => api.entries.reviseText(input))),
    registerRoute(ipc, route(IPC_CHANNELS.entryCorrect, EntryCorrectRequestV1Schema, ResultSchema(CorrectionReceiptV1Schema), (input) => api.entries.correct(input))),
    registerRoute(ipc, route(IPC_CHANNELS.jobRetry, JobRetryRequestV1Schema, ResultSchema(JobRetryResponseV1Schema), (input) => api.jobs.retry(input))),
    registerRoute(ipc, route(IPC_CHANNELS.entryDelete, EntryDeleteRequestV1Schema, ResultSchema(EntryDeleteReceiptV1Schema), (input) => api.entries.delete(input))),
    registerRoute(ipc, route(IPC_CHANNELS.exportCreate, ExportCreateRequestV1Schema, ResultSchema(ExportReceiptV1Schema), (input) => api.exports.create(input))),
    registerRoute(ipc, route(IPC_CHANNELS.exportGet, ExportGetRequestV1Schema, ResultSchema(ExportStatusV1Schema), (input) => api.exports.get(input))),
    registerRoute(ipc, route(IPC_CHANNELS.diagnosticsCreate, DiagnosticsExportCreateRequestV1Schema, ResultSchema(DiagnosticsExportReceiptV1Schema), (input) => api.diagnostics.createExport(input))),
    registerRoute(ipc, route(IPC_CHANNELS.diagnosticsGet, DiagnosticsExportGetRequestV1Schema, ResultSchema(DiagnosticsExportStatusV1Schema), (input) => api.diagnostics.getExport(input))),
    registerRoute(ipc, route(IPC_CHANNELS.backupList, BackupListRequestV1Schema, ResultSchema(BackupListResponseV1Schema), (input) => api.backups.list(input))),
    registerRoute(ipc, route(IPC_CHANNELS.backupRestore, BackupRestoreRequestV1Schema, ResultSchema(BackupRestoreReceiptV1Schema), (input) => api.backups.restore(input))),
    registerRoute(ipc, route(IPC_CHANNELS.backupStatus, BackupRestoreStatusRequestV1Schema, ResultSchema(BackupRestoreStatusV1Schema), (input) => api.backups.status(input))),
    registerRoute(ipc, route(IPC_CHANNELS.librarySummary, LibrarySummaryRequestV1Schema, ResultSchema(LibrarySummaryV1Schema), (input) => api.library.summary(input))),
    registerRoute(ipc, route(IPC_CHANNELS.settingsGetPublic, PublicSettingsRequestV1Schema, ResultSchema(PublicSettingsV1Schema), (input) => api.settings.getPublic(input))),
    registerRoute(ipc, route(IPC_CHANNELS.settingsUpdatePublic, UpdatePublicSettingsRequestV1Schema, ResultSchema(PublicSettingsV1Schema), (input) => api.settings.updatePublic(input))),
    registerRoute(ipc, route(IPC_CHANNELS.settingsSaveAiCredential, SaveAiCredentialRequestV1Schema, ResultSchema(CredentialReceiptV1Schema), (input) => api.settings.saveAiCredential(input))),
    registerRoute(ipc, route(IPC_CHANNELS.settingsDeleteAiCredential, PublicSettingsRequestV1Schema, ResultSchema(deleteCredentialReceiptSchema), (input) => api.settings.deleteAiCredential(input))),
    registerRoute(ipc, route(IPC_CHANNELS.aiProvidersList, providerListRequestSchema, ResultSchema(AiProviderProfilesV2Schema), (input) => api.aiProviders.list(input))),
    registerRoute(ipc, route(IPC_CHANNELS.aiProvidersSave, SaveAiProviderProfileRequestV2Schema, ResultSchema(AiProviderProfileReceiptV2Schema), (input) => api.aiProviders.save(input))),
    registerRoute(ipc, route(IPC_CHANNELS.aiProvidersActivate, ActivateAiProviderProfileRequestV2Schema, ResultSchema(AiProviderProfilesV2Schema), (input) => api.aiProviders.activate(input))),
    registerRoute(ipc, route(IPC_CHANNELS.aiProvidersDelete, DeleteAiProviderProfileRequestV2Schema, ResultSchema(AiProviderDeleteReceiptV2Schema), (input) => api.aiProviders.delete(input))),
    registerRoute(ipc, route(IPC_CHANNELS.aiProvidersProbe, ProbeAiProviderProfileRequestV2Schema, ResultSchema(AiProviderProbeResultV2Schema), (input) => api.aiProviders.probe(input))),
    registerRoute(ipc, route(IPC_CHANNELS.aiProvidersDiscoverCodex, CodexDiscoveryRequestV2Schema, ResultSchema(CodexDiscoveryV2Schema), (input) => api.aiProviders.discoverCodex(input))),
    registerRoute(ipc, route(IPC_CHANNELS.settingsSaveFeishuCredential, SaveFeishuCredentialRequestV1Schema, ResultSchema(CredentialReceiptV1Schema), (input) => api.settings.saveFeishuCredential(input))),
    registerRoute(ipc, route(IPC_CHANNELS.settingsDeleteFeishuCredential, PublicSettingsRequestV1Schema, ResultSchema(deleteCredentialReceiptSchema), (input) => api.settings.deleteFeishuCredential(input))),
    registerRoute(ipc, route(IPC_CHANNELS.feishuConnect, PublicSettingsRequestV1Schema, ResultSchema(FeishuConnectionReceiptV1Schema), (input) => api.feishu.connect(input))),
    registerRoute(ipc, route(IPC_CHANNELS.feishuDisconnect, PublicSettingsRequestV1Schema, ResultSchema(FeishuConnectionReceiptV1Schema), (input) => api.feishu.disconnect(input))),
    registerRoute(ipc, route(IPC_CHANNELS.feishuCreateBindingCode, PublicSettingsRequestV1Schema, ResultSchema(BindingCodeReceiptV1Schema), (input) => api.feishu.createBindingCode(input))),
    registerRoute(ipc, route(IPC_CHANNELS.feishuListDeliveryIssues, DeliveryIssueListRequestV1Schema, ResultSchema(FeishuDeliveryIssueListResponseV1Schema), (input) => api.feishu.listDeliveryIssues(input))),
    registerRoute(ipc, route(IPC_CHANNELS.feishuResolveDeliveryIssue, ResolveFeishuDeliveryIssueRequestV1Schema, ResultSchema(ResolveFeishuDeliveryIssueReceiptV1Schema), (input) => api.feishu.resolveDeliveryIssue(input)))
  ];

  return () => removeRoutes.forEach((removeRoute) => removeRoute());
}

export function createDesktopApi(services: DesktopCoreServicesV1, now: () => Date = () => new Date()): DesktopApiV1 {
  return {
    capture: {
      create: (input) => callCore(() => services.capture.capture({
        version: 1,
        requestId: input.requestId,
        source: "desktop",
        modality: "text",
        rawText: input.rawText,
        mode: input.mode,
        receivedAt: now().toISOString(),
        sourceKey: `desktop:${input.requestId}`
      }))
    },
    entries: {
      list: (input) => callCore(() => services.entries.list(input)),
      get: (input) => callCore(() => services.entries.get(input.entryId)),
      reviseText: (input) => services.entries.reviseText ? callCore(() => services.entries.reviseText!(input)) : unavailableService(),
      correct: (input) => services.entries.correct ? callCore(() => services.entries.correct!(input)) : unavailableService(),
      delete: (input) => services.entries.delete ? callCore(() => services.entries.delete!(input)) : unavailableService()
    },
    jobs: { retry: (input) => services.jobs ? callCore(() => services.jobs!.retry(input)) : unavailableService() },
    exports: {
      create: (input) => services.exports ? callCore(() => services.exports!.create(input)) : unavailableService(),
      get: (input) => services.exports ? callCore(() => services.exports!.get(input)) : unavailableService(),
    },
    diagnostics: {
      createExport: (input) => services.diagnostics ? callCore(() => services.diagnostics!.create(input)) : unavailableService(),
      getExport: (input) => services.diagnostics ? callCore(() => services.diagnostics!.get(input)) : unavailableService(),
    },
    backups: {
      list: (_input) => services.backups ? callCore(() => services.backups!.list()) : unavailableService(),
      restore: (input) => services.backups ? callCore(() => services.backups!.restore(input)) : unavailableService(),
      status: (input) => services.backups ? callCore(() => services.backups!.status(input.restoreId)) : unavailableService(),
    },
    library: { summary: (_input) => callCore(() => services.entries.summary()) },
    settings: {
      getPublic: (_input) => services.settings ? callCore(() => services.settings!.getPublic()) : unavailableService(),
      updatePublic: (input) => services.settings ? callCore(() => services.settings!.updatePublic(input)) : unavailableService(),
      saveAiCredential: (input) => services.settings ? callCore(() => services.settings!.saveAiCredential(input)) : unavailableService(),
      deleteAiCredential: (_input) => services.settings ? callCore(() => services.settings!.deleteAiCredential()) : unavailableService(),
      saveFeishuCredential: (input) => services.settings ? callCore(() => services.settings!.saveFeishuCredential(input)) : unavailableService(),
      deleteFeishuCredential: (_input) => services.settings ? callCore(() => services.settings!.deleteFeishuCredential()) : unavailableService(),
    },
    aiProviders: {
      list: (_input) => services.aiProviders ? callCore(() => services.aiProviders!.list()) : unavailableService(),
      save: (input) => services.aiProviders ? callCore(() => services.aiProviders!.save(input)) : unavailableService(),
      activate: (input) => services.aiProviders ? callCore(() => services.aiProviders!.activate(input.profileId)) : unavailableService(),
      delete: (input) => services.aiProviders ? callCore(() => services.aiProviders!.delete(input.profileId)) : unavailableService(),
      probe: (input) => services.aiProviders ? callCore(() => services.aiProviders!.probe(input.profileId)) : unavailableService(),
      discoverCodex: (input) => services.aiProviders ? callCore(() => services.aiProviders!.discoverCodex(input)) : unavailableService(),
    },
    feishu: {
      connect: (_input) => services.feishu ? callCore(() => services.feishu!.connect()) : unavailableService(),
      disconnect: (_input) => services.feishu ? callCore(() => services.feishu!.disconnect()) : unavailableService(),
      createBindingCode: (_input) => services.feishu ? callCore(() => services.feishu!.createBindingCode()) : unavailableService(),
      listDeliveryIssues: (input) => services.feishu ? callCore(() => services.feishu!.listDeliveryIssues(input)) : unavailableService(),
      resolveDeliveryIssue: (input) => services.feishu ? callCore(() => services.feishu!.resolveDeliveryIssue(input)) : unavailableService(),
    },
  };
}

function unavailableService<T>(): Promise<Result<T>> {
  return Promise.resolve(failure("DATABASE_UNAVAILABLE", true));
}

function route<Input, Output>(channel: string, input: z.ZodType<Input>, output: z.ZodType<Output>, invoke: (input: Input) => Promise<Output>): Route<Input, Output> {
  return { channel, input, output, invoke };
}

function registerRoute<Input, Output>(ipc: IpcMainRegistrar, current: Route<Input, Output>) {
  ipc.removeHandler(current.channel);
  ipc.handle(current.channel, async (_event, rawInput) => {
    const parsedInput = current.input.safeParse(rawInput);
    if (!parsedInput.success) return failure("VALIDATION_FAILED", false);

    try {
      const rawOutput = await current.invoke(parsedInput.data);
      const parsedOutput = current.output.safeParse(rawOutput);
      if (!parsedOutput.success) return failure("INTERNAL_ERROR", false);
      return sanitizeResult(parsedOutput.data);
    } catch (error) {
      const knownError = AppErrorSchema.safeParse(error);
      if (knownError.success) return sanitizedFailure(knownError.data);
      return failure("INTERNAL_ERROR", true);
    }
  });
  return () => ipc.removeHandler(current.channel);
}

function failure(code: ErrorCode, retryable: boolean) {
  return {
    ok: false as const,
    error: { code, message: "请求未能完成。", retryable, correlationId: randomUUID() }
  };
}

function sanitizeResult<Output>(output: Output): Output {
  if (!output || typeof output !== "object" || !("ok" in output) || output.ok !== false || !("error" in output)) return output;
  const error = AppErrorSchema.safeParse(output.error);
  return error.success ? sanitizedFailure(error.data) as Output : output;
}

function sanitizedFailure(error: z.infer<typeof AppErrorSchema>) {
  return {
    ok: false as const,
    error: {
      code: error.code,
      message: "请求未能完成。",
      retryable: error.retryable,
      correlationId: error.correlationId,
    },
  };
}

async function callCore<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const knownError = AppErrorSchema.safeParse(error);
    if (knownError.success) return sanitizedFailure(knownError.data);
    return failure("INTERNAL_ERROR", true);
  }
}
