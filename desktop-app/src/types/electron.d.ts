import type {
  DesktopCaptureRequestV1,
  DomainEventV1,
  EntryDetailV1,
  EntryListRequestV1,
  EntryListResponseV1,
  EntryCorrectRequestV1,
  MemoryType,
  PaopaoApiV1,
  Result,
  BindingCodeReceiptV1Schema,
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
  CredentialReceiptV1Schema,
  DeliveryIssueListRequestV1Schema,
  FeishuConnectionReceiptV1Schema,
  FeishuDeliveryIssueListResponseV1Schema,
  PublicSettingsRequestV1Schema,
  PublicSettingsV1Schema,
  ResolveFeishuDeliveryIssueRequestV1Schema,
  ResolveFeishuDeliveryIssueReceiptV1Schema,
  SaveAiCredentialRequestV1Schema,
  SaveFeishuCredentialRequestV1Schema,
  UpdatePublicSettingsRequestV1Schema
} from "@paopao/contracts";
import type { BackupListRequestV1, BackupRestoreStatusRequestV1, DiagnosticsExportGetRequestV1, ExportGetRequestV1 } from "../../electron/maintenance-contracts.js";
import type { BackupListResponseV1Schema, BackupRestoreRequestV1Schema, BackupRestoreReceiptV1Schema, BackupRestoreStatusV1Schema } from "@paopao/contracts";
import type { z } from "zod";

export interface PaopaoRendererApi {
  capture: {
    create(input: DesktopCaptureRequestV1): ReturnType<PaopaoApiV1["capture"]["create"]>;
  };
  entries: {
    list(input: EntryListRequestV1): Promise<Result<EntryListResponseV1>>;
    get(input: { version: 1; entryId: string }): Promise<Result<EntryDetailV1>>;
    reviseText(input: Parameters<PaopaoApiV1["entries"]["reviseText"]>[0]): ReturnType<PaopaoApiV1["entries"]["reviseText"]>;
    correct(input: EntryCorrectRequestV1): ReturnType<PaopaoApiV1["entries"]["correct"]>;
    delete(input: Parameters<PaopaoApiV1["entries"]["delete"]>[0]): ReturnType<PaopaoApiV1["entries"]["delete"]>;
  };
  jobs: PaopaoApiV1["jobs"];
  exports: { create: PaopaoApiV1["exports"]["create"]; get(input: ExportGetRequestV1): ReturnType<PaopaoApiV1["exports"]["get"]> };
  diagnostics: { createExport: PaopaoApiV1["diagnostics"]["createExport"]; getExport(input: DiagnosticsExportGetRequestV1): ReturnType<PaopaoApiV1["diagnostics"]["getExport"]> };
  backups: {
    list(input: BackupListRequestV1): Promise<Result<z.infer<typeof BackupListResponseV1Schema>>>;
    restore(input: z.infer<typeof BackupRestoreRequestV1Schema>): Promise<Result<z.infer<typeof BackupRestoreReceiptV1Schema>>>;
    status(input: BackupRestoreStatusRequestV1): Promise<Result<z.infer<typeof BackupRestoreStatusV1Schema>>>;
  };
  library: {
    summary(input: { version: 1 }): Promise<Result<{ total: number; shelves: Array<{ type: MemoryType; count: number }> }>>;
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
  windows: {
    toggleCapture(): Promise<void>;
    hideCapture(): Promise<void>;
    openLibrary(): Promise<void>;
    onCaptureVisibilityChanged(handler: (visible: boolean) => void): () => void;
  };
  onDomainEvent(handler: (event: DomainEventV1) => void): () => void;
}

declare global {
  interface Window {
    paopao?: PaopaoRendererApi;
  }
}

export {};
