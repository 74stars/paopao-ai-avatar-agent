import { contextBridge, ipcRenderer } from "electron";
import {
  CaptureReceiptV1Schema,
  DesktopCaptureRequestV1Schema,
  DomainEventV1Schema,
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
  DeliveryIssueListRequestV1Schema,
  FeishuConnectionReceiptV1Schema,
  FeishuDeliveryIssueListResponseV1Schema,
  PublicSettingsRequestV1Schema,
  PublicSettingsV1Schema,
  ResolveFeishuDeliveryIssueRequestV1Schema,
  ResolveFeishuDeliveryIssueReceiptV1Schema,
  ActivateAiProviderProfileRequestV2Schema,
  AiProviderDeleteReceiptV2Schema,
  AiProviderProfileReceiptV2Schema,
  AiProviderProbeResultV2Schema,
  AiProviderProfilesV2Schema,
  CodexDiscoveryRequestV2Schema,
  CodexDiscoveryV2Schema,
  DeleteAiProviderProfileRequestV2Schema,
  ProbeAiProviderProfileRequestV2Schema,
  SaveAiProviderProfileRequestV2Schema,
  SaveAiCredentialRequestV1Schema,
  SaveFeishuCredentialRequestV1Schema,
  UpdatePublicSettingsRequestV1Schema,
  ResultSchema
} from "@paopao/contracts";
import { z } from "zod";

import { IPC_CHANNELS } from "./preload-shared/ipc-channels.js";
import {
  BackupListRequestV1Schema, BackupListResponseV1Schema, BackupRestoreRequestV1Schema, BackupRestoreReceiptV1Schema, BackupRestoreStatusRequestV1Schema, BackupRestoreStatusV1Schema,
  DiagnosticsExportCreateRequestV1Schema, DiagnosticsExportReceiptV1Schema, DiagnosticsExportGetRequestV1Schema, DiagnosticsExportStatusV1Schema,
  EntryDeleteRequestV1Schema, EntryDeleteReceiptV1Schema, ExportCreateRequestV1Schema, ExportReceiptV1Schema, ExportGetRequestV1Schema, ExportStatusV1Schema,
} from "./preload-shared/maintenance-contracts.js";

type DomainEvent = z.infer<typeof DomainEventV1Schema>;
const domainHandlers = new Set<(event: DomainEvent) => void>();
const captureVisibilityHandlers = new Set<(visible: boolean) => void>();
let latestFeishuStatus: Extract<DomainEvent, { type: "feishu:status" }> | null = null;
let captureVisible = false;

ipcRenderer.on(IPC_CHANNELS.domainEvent, (_event, rawEvent: unknown) => {
  const event = DomainEventV1Schema.safeParse(rawEvent);
  if (!event.success) return;
  if (event.data.type === "feishu:status") latestFeishuStatus = event.data;
  for (const handler of [...domainHandlers]) handler(event.data);
});

ipcRenderer.on(IPC_CHANNELS.windowCaptureVisibilityChanged, (_event, visible: unknown) => {
  if (typeof visible !== "boolean") return;
  captureVisible = visible;
  for (const handler of [...captureVisibilityHandlers]) handler(visible);
});

contextBridge.exposeInMainWorld("paopao", {
  capture: {
    create: (input: unknown) => invokeTyped(IPC_CHANNELS.captureCreate, DesktopCaptureRequestV1Schema, ResultSchema(CaptureReceiptV1Schema), input)
  },
  entries: {
    list: (input: unknown) => invokeTyped(IPC_CHANNELS.entryList, EntryListRequestV1Schema, ResultSchema(EntryListResponseV1Schema), input),
    get: (input: unknown) => invokeTyped(IPC_CHANNELS.entryGet, EntryGetRequestV1Schema, ResultSchema(EntryDetailV1Schema), input),
    reviseText: (input: unknown) => invokeTyped(IPC_CHANNELS.entryReviseText, EntryReviseTextRequestV1Schema, ResultSchema(TextRevisionReceiptV1Schema), input),
    correct: (input: unknown) => invokeTyped(IPC_CHANNELS.entryCorrect, EntryCorrectRequestV1Schema, ResultSchema(CorrectionReceiptV1Schema), input),
    delete: (input: unknown) => invokeTyped(IPC_CHANNELS.entryDelete, EntryDeleteRequestV1Schema, ResultSchema(EntryDeleteReceiptV1Schema), input)
  },
  jobs: {
    retry: (input: unknown) => invokeTyped(IPC_CHANNELS.jobRetry, JobRetryRequestV1Schema, ResultSchema(JobRetryResponseV1Schema), input)
  },
  exports: {
    create: (input: unknown) => invokeTyped(IPC_CHANNELS.exportCreate, ExportCreateRequestV1Schema, ResultSchema(ExportReceiptV1Schema), input),
    get: (input: unknown) => invokeTyped(IPC_CHANNELS.exportGet, ExportGetRequestV1Schema, ResultSchema(ExportStatusV1Schema), input)
  },
  diagnostics: {
    createExport: (input: unknown) => invokeTyped(IPC_CHANNELS.diagnosticsCreate, DiagnosticsExportCreateRequestV1Schema, ResultSchema(DiagnosticsExportReceiptV1Schema), input),
    getExport: (input: unknown) => invokeTyped(IPC_CHANNELS.diagnosticsGet, DiagnosticsExportGetRequestV1Schema, ResultSchema(DiagnosticsExportStatusV1Schema), input)
  },
  backups: {
    list: (input: unknown) => invokeTyped(IPC_CHANNELS.backupList, BackupListRequestV1Schema, ResultSchema(BackupListResponseV1Schema), input),
    restore: (input: unknown) => invokeTyped(IPC_CHANNELS.backupRestore, BackupRestoreRequestV1Schema, ResultSchema(BackupRestoreReceiptV1Schema), input),
    status: (input: unknown) => invokeTyped(IPC_CHANNELS.backupStatus, BackupRestoreStatusRequestV1Schema, ResultSchema(BackupRestoreStatusV1Schema), input)
  },
  library: {
    summary: (input: unknown) => invokeTyped(IPC_CHANNELS.librarySummary, LibrarySummaryRequestV1Schema, ResultSchema(LibrarySummaryV1Schema), input)
  },
  settings: {
    getPublic: (input: unknown) => invokeTyped(IPC_CHANNELS.settingsGetPublic, PublicSettingsRequestV1Schema, ResultSchema(PublicSettingsV1Schema), input),
    updatePublic: (input: unknown) => invokeTyped(IPC_CHANNELS.settingsUpdatePublic, UpdatePublicSettingsRequestV1Schema, ResultSchema(PublicSettingsV1Schema), input),
    saveAiCredential: (input: unknown) => invokeTyped(IPC_CHANNELS.settingsSaveAiCredential, SaveAiCredentialRequestV1Schema, ResultSchema(CredentialReceiptV1Schema), input),
    deleteAiCredential: (input: unknown) => invokeTyped(IPC_CHANNELS.settingsDeleteAiCredential, PublicSettingsRequestV1Schema, ResultSchema(z.object({ configured: z.literal(false) }).strict()), input),
    saveFeishuCredential: (input: unknown) => invokeTyped(IPC_CHANNELS.settingsSaveFeishuCredential, SaveFeishuCredentialRequestV1Schema, ResultSchema(CredentialReceiptV1Schema), input),
    deleteFeishuCredential: (input: unknown) => invokeTyped(IPC_CHANNELS.settingsDeleteFeishuCredential, PublicSettingsRequestV1Schema, ResultSchema(z.object({ configured: z.literal(false) }).strict()), input)
  },
  aiProviders: {
    list: (input: unknown) => invokeTyped(IPC_CHANNELS.aiProvidersList, z.object({ version: z.literal(2) }).strict(), ResultSchema(AiProviderProfilesV2Schema), input),
    save: (input: unknown) => invokeTyped(IPC_CHANNELS.aiProvidersSave, SaveAiProviderProfileRequestV2Schema, ResultSchema(AiProviderProfileReceiptV2Schema), input),
    activate: (input: unknown) => invokeTyped(IPC_CHANNELS.aiProvidersActivate, ActivateAiProviderProfileRequestV2Schema, ResultSchema(AiProviderProfilesV2Schema), input),
    delete: (input: unknown) => invokeTyped(IPC_CHANNELS.aiProvidersDelete, DeleteAiProviderProfileRequestV2Schema, ResultSchema(AiProviderDeleteReceiptV2Schema), input),
    probe: (input: unknown) => invokeTyped(IPC_CHANNELS.aiProvidersProbe, ProbeAiProviderProfileRequestV2Schema, ResultSchema(AiProviderProbeResultV2Schema), input),
    discoverCodex: (input: unknown) => invokeTyped(IPC_CHANNELS.aiProvidersDiscoverCodex, CodexDiscoveryRequestV2Schema, ResultSchema(CodexDiscoveryV2Schema), input),
  },
  feishu: {
    connect: (input: unknown) => invokeTyped(IPC_CHANNELS.feishuConnect, PublicSettingsRequestV1Schema, ResultSchema(FeishuConnectionReceiptV1Schema), input),
    disconnect: (input: unknown) => invokeTyped(IPC_CHANNELS.feishuDisconnect, PublicSettingsRequestV1Schema, ResultSchema(FeishuConnectionReceiptV1Schema), input),
    createBindingCode: (input: unknown) => invokeTyped(IPC_CHANNELS.feishuCreateBindingCode, PublicSettingsRequestV1Schema, ResultSchema(BindingCodeReceiptV1Schema), input),
    listDeliveryIssues: (input: unknown) => invokeTyped(IPC_CHANNELS.feishuListDeliveryIssues, DeliveryIssueListRequestV1Schema, ResultSchema(FeishuDeliveryIssueListResponseV1Schema), input),
    resolveDeliveryIssue: (input: unknown) => invokeTyped(IPC_CHANNELS.feishuResolveDeliveryIssue, ResolveFeishuDeliveryIssueRequestV1Schema, ResultSchema(ResolveFeishuDeliveryIssueReceiptV1Schema), input)
  },
  windows: {
    toggleCapture: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleCapture),
    hideCapture: () => ipcRenderer.invoke(IPC_CHANNELS.windowHideCapture),
    openLibrary: () => ipcRenderer.invoke(IPC_CHANNELS.windowOpenLibrary),
    onCaptureVisibilityChanged: (handler: (visible: boolean) => void) => {
      captureVisibilityHandlers.add(handler);
      queueMicrotask(() => {
        if (captureVisibilityHandlers.has(handler)) handler(captureVisible);
      });
      return () => captureVisibilityHandlers.delete(handler);
    }
  },
  onDomainEvent: (handler: (event: unknown) => void) => {
    const typedHandler = handler as (event: DomainEvent) => void;
    domainHandlers.add(typedHandler);
    if (latestFeishuStatus) queueMicrotask(() => {
      if (domainHandlers.has(typedHandler) && latestFeishuStatus) typedHandler(latestFeishuStatus);
    });
    return () => domainHandlers.delete(typedHandler);
  }
});

async function invokeTyped<Input, Output>(channel: string, inputSchema: z.ZodType<Input>, outputSchema: z.ZodType<Output>, rawInput: unknown): Promise<Output | ReturnType<typeof invalidResult>> {
  const input = inputSchema.safeParse(rawInput);
  if (!input.success) return invalidResult("VALIDATION_FAILED");

  try {
    const rawOutput: unknown = await ipcRenderer.invoke(channel, input.data);
    const output = outputSchema.safeParse(rawOutput);
    return output.success ? output.data : invalidResult("INTERNAL_ERROR");
  } catch {
    return invalidResult("INTERNAL_ERROR");
  }
}

function invalidResult(code: "VALIDATION_FAILED" | "INTERNAL_ERROR") {
  return { ok: false as const, error: { code, message: "请求未能完成。", retryable: code === "INTERNAL_ERROR", correlationId: createCorrelationId() } };
}

function createCorrelationId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
