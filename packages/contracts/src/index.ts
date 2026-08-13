import { z } from "zod";

export const CONTRACT_VERSION = "v1" as const;
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const uuid = z.string().uuid();
const isoUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, "UTC ISO timestamp required");
const boundedText = (max: number) => z.string().max(max);
const codePointText = (max: number) => z.string().refine((value) => Array.from(value).length <= max, `must be at most ${max} code points`);
const nonEmptyText = (max: number) => z.string().min(1).max(max);
const confidence = z.number().finite().min(0).max(1);

export const EntrySourceSchema = z.enum(["desktop", "feishu"]);
export const EntryModalitySchema = z.literal("text");
export const CaptureModeSchema = z.enum(["remember", "think"]);
export const EntryStatusSchema = z.enum(["stored", "processing", "retry_wait", "needs_review", "ready", "failed_final", "deleting", "purged"]);
export const JobTypeSchema = z.enum(["analyze_entry", "generate_insight", "purge_entry", "create_export", "create_diagnostics_export"]);
export const JobStatusSchema = z.enum(["queued", "running", "retry_wait", "waiting_for_network", "waiting_for_configuration", "succeeded", "failed_final", "cancelled"]);
export const MemoryTypeSchema = z.enum(["diary", "thought", "person", "reading", "goal", "other"]);
export const DerivationKindSchema = z.enum(["classification", "summary", "entities", "goals", "next_actions", "insight_reply"]);
export const CreatedBySchema = z.enum(["ai", "user", "system"]);

export const ErrorCodeSchema = z.enum([
  "VALIDATION_FAILED", "NOT_FOUND", "REVISION_CONFLICT", "ALREADY_DELETED", "DATABASE_UNAVAILABLE", "NETWORK_OFFLINE", "SAFE_STORAGE_UNAVAILABLE", "JOB_NOT_RETRYABLE", "AI_NOT_CONFIGURED", "AI_AUTH_FAILED", "AI_NETWORK_ERROR", "AI_TIMEOUT", "AI_RATE_LIMITED", "AI_SAFETY_BLOCKED", "AI_INPUT_TOO_LARGE", "AI_INVALID_OUTPUT", "AI_FAILED_FINAL", "FEISHU_NOT_CONFIGURED", "FEISHU_AUTH_FAILED", "FEISHU_NOT_CONNECTED", "FEISHU_NOT_BOUND", "FEISHU_PERMISSION_DENIED", "BINDING_CODE_INVALID", "BINDING_CODE_EXPIRED", "BINDING_CODE_CONSUMED", "BINDING_RATE_LIMITED", "DELIVERY_AMBIGUOUS", "DELIVERY_FAILED_FINAL", "BACKUP_INVALID", "RESTORE_FAILED", "EXPORT_FAILED", "DIAGNOSTICS_EXPORT_FAILED", "INTERNAL_ERROR"
]);

export const AI_PROVIDER_ID = "openai" as const;
export const AI_MODEL_ID = "gpt-4o-mini-2024-07-18" as const;
export const AiProviderProtocolV2Schema = z.enum(["openai_responses", "openai_chat_completions"]);
export const AiProviderAuthModeV2Schema = z.enum(["bearer", "api_key_header", "none"]);
export const AiStructuredOutputModeV2Schema = z.enum(["json_schema", "json_object", "prompt_json"]);

const aiProviderProfileBaseV2Shape = {
  id: uuid,
  name: nonEmptyText(80),
  model: boundedText(200).nullable(),
  revision: z.number().int().positive(),
  updatedAt: isoUtc,
} as const;

export const DirectAiProviderProfileV2Schema = strict({
  ...aiProviderProfileBaseV2Shape,
  kind: z.literal("direct"),
  providerId: nonEmptyText(100),
  protocol: AiProviderProtocolV2Schema,
  baseUrl: nonEmptyText(1000),
  model: nonEmptyText(200),
  authMode: AiProviderAuthModeV2Schema,
  authHeaderName: boundedText(100).nullable(),
  structuredOutput: AiStructuredOutputModeV2Schema,
  timeoutMs: z.number().int().min(1_000).max(300_000),
  credentialConfigured: z.boolean(),
});

export const CodexAiProviderProfileV2Schema = strict({
  ...aiProviderProfileBaseV2Shape,
  kind: z.literal("codex"),
  profile: boundedText(100).nullable(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).nullable(),
  codexHome: boundedText(1000).nullable(),
  credentialConfigured: z.literal(true),
});

export const AiProviderProfileV2Schema = z.discriminatedUnion("kind", [DirectAiProviderProfileV2Schema, CodexAiProviderProfileV2Schema]);

const directAiProviderDraftV2Schema = strict({
  id: uuid,
  kind: z.literal("direct"),
  name: nonEmptyText(80),
  providerId: nonEmptyText(100),
  protocol: AiProviderProtocolV2Schema,
  baseUrl: nonEmptyText(1000),
  model: nonEmptyText(200),
  authMode: AiProviderAuthModeV2Schema,
  authHeaderName: boundedText(100).nullable(),
  structuredOutput: AiStructuredOutputModeV2Schema,
  timeoutMs: z.number().int().min(1_000).max(300_000),
});

const codexAiProviderDraftV2Schema = strict({
  id: uuid,
  kind: z.literal("codex"),
  name: nonEmptyText(80),
  profile: boundedText(100).nullable(),
  model: boundedText(200).nullable(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).nullable(),
  codexHome: boundedText(1000).nullable(),
});

export const AiProviderProfileDraftV2Schema = z.discriminatedUnion("kind", [directAiProviderDraftV2Schema, codexAiProviderDraftV2Schema]);
export const AiProviderProfilesV2Schema = strict({
  version: z.literal(2),
  activeProfileId: uuid.nullable(),
  profiles: z.array(AiProviderProfileV2Schema).max(32),
});
export const SaveAiProviderProfileRequestV2Schema = strict({
  version: z.literal(2),
  profile: AiProviderProfileDraftV2Schema,
  credential: z.string().min(1).max(4096).optional(),
});
export const DeleteAiProviderProfileRequestV2Schema = strict({ version: z.literal(2), profileId: uuid });
export const ActivateAiProviderProfileRequestV2Schema = strict({ version: z.literal(2), profileId: uuid });
export const ProbeAiProviderProfileRequestV2Schema = strict({ version: z.literal(2), profileId: uuid });
export const AiProviderProfileReceiptV2Schema = strict({ version: z.literal(2), profile: AiProviderProfileV2Schema, activeProfileId: uuid.nullable() });
export const AiProviderDeleteReceiptV2Schema = strict({ version: z.literal(2), deletedProfileId: uuid, activeProfileId: uuid.nullable() });
export const AiProviderProbeStatusV2Schema = z.enum(["ready", "not_configured", "unavailable", "auth_failed", "model_unavailable", "invalid_output", "timeout"]);
export const AiProviderProbeResultV2Schema = strict({
  version: z.literal(2),
  profileId: uuid,
  status: AiProviderProbeStatusV2Schema,
  provider: boundedText(100).nullable(),
  model: boundedText(200).nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  checkedAt: isoUtc,
});
export const CodexDiscoveryRequestV2Schema = strict({ version: z.literal(2), codexHome: boundedText(1000).nullable().optional(), profile: boundedText(100).nullable().optional() });
export const CodexModelV2Schema = strict({
  id: nonEmptyText(200),
  displayName: boundedText(200).nullable(),
  isDefault: z.boolean(),
  defaultReasoningEffort: boundedText(40).nullable(),
  supportedReasoningEfforts: z.array(nonEmptyText(40)).max(16),
});
export const CodexDiscoveryV2Schema = strict({
  version: z.literal(2),
  installed: z.boolean(),
  cliVersion: boundedText(100).nullable(),
  authenticated: z.boolean(),
  authMode: boundedText(100).nullable(),
  provider: boundedText(100).nullable(),
  models: z.array(CodexModelV2Schema).max(200),
  errorCode: z.enum(["CODEX_NOT_INSTALLED", "CODEX_NOT_AUTHENTICATED", "CODEX_DISCOVERY_FAILED"]).nullable(),
});

export const AppErrorSchema = strict({ code: ErrorCodeSchema, message: nonEmptyText(240), retryable: z.boolean(), correlationId: uuid, details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() });
export const ResultSchema = <T extends z.ZodTypeAny>(schema: T) => z.discriminatedUnion("ok", [strict({ ok: z.literal(true), data: schema }), strict({ ok: z.literal(false), error: AppErrorSchema })]);

export const DesktopCaptureRequestV1Schema = strict({ version: z.literal(1), requestId: uuid, rawText: codePointText(50_000), mode: CaptureModeSchema }).superRefine((v, ctx) => { if (!v.rawText.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rawText"], message: "rawText must contain non-whitespace" }); });
export const ExternalRefSchema = strict({ provider: z.literal("feishu"), appId: nonEmptyText(200), tenantKey: nonEmptyText(200), openId: nonEmptyText(200), chatId: nonEmptyText(200), chatType: z.literal("p2p"), messageId: nonEmptyText(200), eventId: nonEmptyText(200), messageKey: nonEmptyText(200), eventKey: nonEmptyText(200) });
export const CaptureCommandV1Schema = strict({ version: z.literal(1), requestId: uuid, source: EntrySourceSchema, modality: z.literal("text"), rawText: codePointText(50_000), mode: CaptureModeSchema, receivedAt: isoUtc, sourceKey: nonEmptyText(300), externalRef: ExternalRefSchema.optional() }).superRefine((v, ctx) => { if (!v.rawText.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rawText"], message: "rawText must contain non-whitespace" }); if (v.source === "feishu" && !v.externalRef) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalRef"], message: "required for feishu source" }); if (v.source === "desktop" && v.externalRef) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalRef"], message: "forbidden for desktop source" }); });
export const CaptureReceiptV1Schema = strict({ entryId: uuid, jobId: uuid, status: z.literal("stored"), deduplicated: z.boolean(), createdAt: isoUtc });

export const EntryListRequestV1Schema = strict({ version: z.literal(1), cursor: boundedText(500).optional(), limit: z.number().int().min(1).max(100).optional(), query: boundedText(200).optional(), types: z.array(MemoryTypeSchema).max(6).optional(), statuses: z.array(EntryStatusSchema).max(9).optional(), sources: z.array(EntrySourceSchema).max(2).optional() });
export const EntryListItemV1Schema = strict({ id: uuid, source: EntrySourceSchema, currentTextPreview: boundedText(240), title: boundedText(80), summary: boundedText(500).nullable(), memoryType: MemoryTypeSchema.nullable(), status: EntryStatusSchema, createdAt: isoUtc, updatedAt: isoUtc, latestRevision: z.number().int().positive(), lastErrorCode: ErrorCodeSchema.nullable() });
export const EntryListResponseV1Schema = strict({ items: z.array(EntryListItemV1Schema), nextCursor: boundedText(500).nullable() });

export const ClassificationValueV1Schema = strict({ inputType: MemoryTypeSchema, confidence, evidence: nonEmptyText(500) });
export const SummaryValueV1Schema = strict({ text: nonEmptyText(500), confidence, evidence: z.array(nonEmptyText(500)).min(1).max(20) });
export const EntitiesValueV1Schema = strict({ items: z.array(strict({ type: z.enum(["person", "book", "place", "topic", "organization"]), name: nonEmptyText(120), confidence, evidence: nonEmptyText(500) })).max(20) });
export const GoalsValueV1Schema = strict({ items: z.array(strict({ title: nonEmptyText(240), confidence, evidence: nonEmptyText(500) })).max(10) });
export const NextActionsValueV1Schema = strict({ items: z.array(strict({ title: nonEmptyText(240), dueHint: boundedText(120).nullable(), confidence, evidence: nonEmptyText(500) })).max(10) });

export const RetrievedMemoryV1Schema = strict({ memoryId: uuid, entryId: uuid, summary: nonEmptyText(500), evidenceQuote: nonEmptyText(500), createdAt: isoUtc, score: z.number().finite().min(0) });
export const InsightCitationSchema = strict({ memoryId: uuid, entryId: uuid, evidenceQuote: nonEmptyText(500) });
export const InsightReplyV1Schema = strict({ schemaVersion: z.literal("insight-reply.v1"), text: nonEmptyText(1200), grounding: z.enum(["grounded", "no_relevant_memory"]), citations: z.array(InsightCitationSchema).max(8), nextAction: strict({ title: nonEmptyText(240) }).optional() }).superRefine((v, ctx) => { if (v.grounding === "grounded" && v.citations.length < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["citations"], message: "grounded requires citation" }); if (v.grounding === "no_relevant_memory" && v.citations.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["citations"], message: "no_relevant_memory cannot cite" }); });
export const MemoryAnalysisV1Schema = strict({ schemaVersion: z.literal("memory-analysis.v1"), classification: ClassificationValueV1Schema, summary: SummaryValueV1Schema, entities: EntitiesValueV1Schema, goals: GoalsValueV1Schema, nextActions: NextActionsValueV1Schema, needsUserReview: z.boolean() });

const valueMap = { classification: ClassificationValueV1Schema, summary: SummaryValueV1Schema, entities: EntitiesValueV1Schema, goals: GoalsValueV1Schema, next_actions: NextActionsValueV1Schema, insight_reply: InsightReplyV1Schema } as const;
export const DerivationV1Schema = z.discriminatedUnion("kind", Object.entries(valueMap).map(([kind, value]) => strict({ id: uuid, kind: z.literal(kind), value, textRevision: z.number().int().positive(), artifactRevision: z.number().int().positive(), supersedesId: uuid.nullable(), isCurrent: z.boolean(), createdBy: CreatedBySchema, promptVersion: boundedText(100).nullable(), schemaVersion: nonEmptyText(100), createdAt: isoUtc })) as unknown as [any, any, ...any[]]);
export const EntryDetailV1Schema = strict({ id: uuid, source: EntrySourceSchema, rawText: z.string(), currentText: z.string(), textRevisions: z.array(strict({ revision: z.number().int().positive(), text: z.string(), createdBy: CreatedBySchema, createdAt: isoUtc })), status: EntryStatusSchema, createdAt: isoUtc, updatedAt: isoUtc, memory: strict({ type: MemoryTypeSchema, summary: nonEmptyText(500), confidence }).nullable(), derivations: z.array(DerivationV1Schema), sources: z.array(strict({ artifactType: z.enum(["derivation", "memory"]), artifactId: uuid, entryId: uuid, quote: nonEmptyText(500) })), activeJobs: z.array(strict({ id: uuid, type: JobTypeSchema, status: JobStatusSchema, attempts: z.number().int().nonnegative(), nextRunAt: isoUtc.nullable(), lastErrorCode: ErrorCodeSchema.nullable() })) });

export const EntryReviseTextRequestV1Schema = strict({ version: z.literal(1), requestId: uuid, entryId: uuid, expectedTextRevision: z.number().int().positive(), text: codePointText(50_000) }).superRefine((v, ctx) => { if (!v.text.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "text must contain non-whitespace" }); });
export const EditableDerivationValueMapV1Schema = z.object(valueMap).strict();
export const EntryCorrectRequestV1Schema = z.discriminatedUnion("kind", (Object.keys(valueMap).filter(k => k !== "insight_reply") as Array<keyof typeof valueMap>).map(kind => strict({ version: z.literal(1), requestId: uuid, entryId: uuid, kind: z.literal(kind), expectedDerivationId: uuid.nullable(), value: valueMap[kind] })) as unknown as [any, any, ...any[]]);
export const TextRevisionReceiptV1Schema = strict({ entryId: uuid, textRevision: z.number().int().positive(), affectedJobIds: z.array(uuid) });
export const CorrectionReceiptV1Schema = strict({ entryId: uuid, textRevision: z.number().int().positive(), derivationId: uuid, supersedesDerivationId: uuid.nullable(), affectedJobIds: z.array(uuid) });
export const EntryDeleteRequestV1Schema = strict({ version: z.literal(1), requestId: uuid, entryId: uuid, expectedTextRevision: z.number().int().positive(), confirmation: z.literal("DELETE") });
export const EntryDeleteReceiptV1Schema = strict({ entryId: uuid, deletionJobId: uuid, status: z.literal("deleting") });
export const JobRetryRequestV1Schema = strict({ version: z.literal(1), jobId: uuid });

export const AnalyzeEntryJobPayloadV1Schema = strict({ schemaVersion: z.literal("analyze-entry-job.v1"), entryId: uuid, textRevision: z.number().int().positive() });
export const GenerateInsightJobPayloadV1Schema = strict({ schemaVersion: z.literal("generate-insight-job.v1"), entryId: uuid, textRevision: z.number().int().positive(), analysisDerivationId: uuid });
export const PurgeEntryJobPayloadV1Schema = strict({ schemaVersion: z.literal("purge-entry-job.v1"), entryId: uuid });
export const CreateExportJobPayloadV1Schema = strict({ schemaVersion: z.literal("create-export-job.v1"), exportId: uuid });
export const CreateDiagnosticsExportJobPayloadV1Schema = strict({ schemaVersion: z.literal("create-diagnostics-export-job.v1"), diagnosticExportId: uuid });
export const ClaimedJobBaseV1Schema = strict({ id: uuid, attempts: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(), leaseOwner: nonEmptyText(200), leaseExpiresAt: isoUtc, fencingToken: z.number().int().nonnegative() });
const claimedJobBaseShape = { id: uuid, attempts: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(), leaseOwner: nonEmptyText(200), leaseExpiresAt: isoUtc, fencingToken: z.number().int().nonnegative() } as const;
export const ClaimedJobV1Schema = z.discriminatedUnion("type", [
  strict({ ...claimedJobBaseShape, type: z.literal("analyze_entry"), entryId: uuid, payload: AnalyzeEntryJobPayloadV1Schema }),
  strict({ ...claimedJobBaseShape, type: z.literal("generate_insight"), entryId: uuid, payload: GenerateInsightJobPayloadV1Schema }),
  strict({ ...claimedJobBaseShape, type: z.literal("purge_entry"), entryId: uuid, payload: PurgeEntryJobPayloadV1Schema }),
  strict({ ...claimedJobBaseShape, type: z.literal("create_export"), entryId: z.null(), payload: CreateExportJobPayloadV1Schema }),
  strict({ ...claimedJobBaseShape, type: z.literal("create_diagnostics_export"), entryId: z.null(), payload: CreateDiagnosticsExportJobPayloadV1Schema }),
]);
export const AiRunMetadataV1Schema = strict({ provider: nonEmptyText(100), model: nonEmptyText(200), promptVersion: nonEmptyText(100), schemaVersion: nonEmptyText(100), latencyMs: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), providerRequestId: boundedText(300).nullable() });
export const SanitizedFailureV1Schema = strict({ code: ErrorCodeSchema, retryable: z.boolean(), message: nonEmptyText(240), correlationId: uuid });
export const ValidatedAnalysisV1Schema = strict({ jobId: uuid, fencingToken: z.number().int().nonnegative(), entryId: uuid, textRevision: z.number().int().positive(), output: MemoryAnalysisV1Schema, aiRun: AiRunMetadataV1Schema });
export const ValidatedInsightV1Schema = strict({ jobId: uuid, fencingToken: z.number().int().nonnegative(), entryId: uuid, textRevision: z.number().int().positive(), analysisDerivationId: uuid, output: InsightReplyV1Schema, aiRun: AiRunMetadataV1Schema });

export const DomainEventV1Schema = z.discriminatedUnion("type", [
  strict({ version: z.literal(1), type: z.literal("entry:stored"), entryId: uuid, status: z.literal("stored"), occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("entry:updated"), entryId: uuid, status: EntryStatusSchema, occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("insight:ready"), entryId: uuid, derivationId: uuid, occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("job:progress"), jobId: uuid, entryId: uuid.nullable(), status: JobStatusSchema, occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("job:failed"), jobId: uuid, entryId: uuid.nullable(), errorCode: ErrorCodeSchema, retryable: z.boolean(), occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("export:ready"), exportId: uuid, occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("export:failed"), exportId: uuid, errorCode: ErrorCodeSchema, occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("diagnostics:ready"), diagnosticExportId: uuid, occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("diagnostics:failed"), diagnosticExportId: uuid, errorCode: z.literal("DIAGNOSTICS_EXPORT_FAILED"), occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("backup:restore-progress"), restoreId: uuid, status: z.enum(["queued", "validating", "quiescing", "replacing", "reopening", "succeeded", "failed_invalid", "failed_rolled_back", "failed_unavailable"]), occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("pet:state"), state: z.enum(["quiet", "listening", "remembering", "thinking", "insight", "sleeping"]), occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("feishu:status"), status: z.enum(["not_configured", "disconnected", "connecting", "connected", "reconnecting", "error"]), errorCode: ErrorCodeSchema.optional(), occurredAt: isoUtc }),
  strict({ version: z.literal(1), type: z.literal("feishu:delivery-issue"), messageKey: nonEmptyText(300), phase: z.enum(["ack", "result"]), status: z.enum(["ambiguous", "failed_final"]), occurredAt: isoUtc })
]);

export const ExportCreateRequestV1Schema = strict({ version: z.literal(1), requestId: uuid, format: z.enum(["json", "markdown"]), includeDeleted: z.literal(false) });
export const ExportReceiptV1Schema = strict({ exportId: uuid, status: z.literal("queued") });
export const ExportStatusV1Schema = z.union([strict({ exportId: uuid, status: z.enum(["queued", "running"]), path: z.null(), sha256: z.null(), errorCode: z.null() }), strict({ exportId: uuid, status: z.literal("ready"), path: nonEmptyText(500), sha256: z.string().regex(/^[a-f0-9]{64}$/), errorCode: z.null() }), strict({ exportId: uuid, status: z.literal("failed"), path: z.null(), sha256: z.null(), errorCode: ErrorCodeSchema })]);
export const DiagnosticsExportCreateRequestV1Schema = strict({ version: z.literal(1), requestId: uuid, includeDays: z.number().int().min(1).max(7) });
export const DiagnosticsExportReceiptV1Schema = strict({ diagnosticExportId: uuid, status: z.literal("queued") });
export const DiagnosticsExportStatusV1Schema = z.union([strict({ diagnosticExportId: uuid, status: z.enum(["queued", "running"]), path: z.null(), sha256: z.null(), errorCode: z.null() }), strict({ diagnosticExportId: uuid, status: z.literal("ready"), path: nonEmptyText(500), sha256: z.string().regex(/^[a-f0-9]{64}$/), errorCode: z.null() }), strict({ diagnosticExportId: uuid, status: z.literal("failed"), path: z.null(), sha256: z.null(), errorCode: z.literal("DIAGNOSTICS_EXPORT_FAILED") })]);
export const BackupSummaryV1Schema = strict({ backupId: uuid, createdAt: isoUtc, reason: z.enum(["startup", "pre_migration", "pre_restore", "post_purge"]), databaseSchemaVersion: z.number().int().nonnegative(), sizeBytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const BackupListResponseV1Schema = strict({ backups: z.array(BackupSummaryV1Schema).max(7) });
export const BackupListRequestV1Schema = strict({ version: z.literal(1) });
export const BackupRestoreRequestV1Schema = strict({ version: z.literal(1), requestId: uuid, backupId: uuid, confirmation: z.literal("RESTORE") });
export const BackupRestoreReceiptV1Schema = strict({ restoreId: uuid, backupId: uuid, status: z.literal("queued") });
export const BackupRestoreStatusRequestV1Schema = strict({ version: z.literal(1), restoreId: uuid });
export const BackupRestoreStatusV1Schema = z.union([strict({ restoreId: uuid, backupId: uuid, status: z.enum(["queued", "validating", "quiescing", "replacing", "reopening"]), errorCode: z.null(), updatedAt: isoUtc }), strict({ restoreId: uuid, backupId: uuid, status: z.literal("succeeded"), errorCode: z.null(), updatedAt: isoUtc }), strict({ restoreId: uuid, backupId: uuid, status: z.literal("failed_invalid"), errorCode: z.literal("BACKUP_INVALID"), updatedAt: isoUtc }), strict({ restoreId: uuid, backupId: uuid, status: z.enum(["failed_rolled_back", "failed_unavailable"]), errorCode: z.literal("RESTORE_FAILED"), updatedAt: isoUtc })]);

export const FeishuRecipientV1Schema = strict({ appId: nonEmptyText(200), tenantKey: nonEmptyText(200), openId: nonEmptyText(200), chatId: nonEmptyText(200), chatType: z.enum(["p2p", "group"]), messageId: nonEmptyText(200) });
export const FeishuReplyPayloadV1Schema = z.discriminatedUnion("kind", [strict({ kind: z.literal("capture_ack") }), strict({ kind: z.literal("control"), replyCode: z.enum(["bound", "unbound", "binding_required", "unsupported_message", "p2p_only", "help", "binding_error"]) }), strict({ kind: z.literal("insight"), reply: InsightReplyV1Schema })]);
export const DueExternalDeliveryRefV1Schema = strict({ messageKey: nonEmptyText(300), entryId: uuid.nullable(), phase: z.enum(["ack", "result"]), attempts: z.number().int().nonnegative() });
export const ClaimedExternalDeliveryV1Schema = strict({ messageKey: nonEmptyText(300), entryId: uuid.nullable(), phase: z.enum(["ack", "result"]), attempts: z.number().int().nonnegative(), owner: nonEmptyText(200), fencingToken: z.number().int().nonnegative(), recipient: FeishuRecipientV1Schema, derivationId: uuid.nullable(), payload: FeishuReplyPayloadV1Schema });
export const ExternalDeliveryClaimRequestV1Schema = strict({ provider: z.literal("feishu"), messageKey: nonEmptyText(300), phase: z.enum(["ack", "result"]), owner: nonEmptyText(200), leaseMs: z.number().int().positive(), now: isoUtc });
export const ExternalDeliveryOutcomeErrorV1Schema = strict({ code: ErrorCodeSchema, retryable: z.boolean(), message: nonEmptyText(240), correlationId: uuid });
export const ExternalDeliveryResolveV1Schema = strict({ provider: z.literal("feishu"), messageKey: nonEmptyText(300), phase: z.enum(["ack", "result"]), owner: nonEmptyText(200), fencingToken: z.number().int().nonnegative(), outcome: z.enum(["confirmed_not_sent", "unknown"]), error: ExternalDeliveryOutcomeErrorV1Schema, now: isoUtc });
export const FeishuDeliveryIssueV1Schema = strict({ messageKey: nonEmptyText(300), entryId: uuid.nullable(), phase: z.enum(["ack", "result"]), status: z.enum(["ambiguous", "failed_final"]), errorCode: ErrorCodeSchema, attempts: z.number().int().nonnegative(), manualRetryAvailable: z.boolean(), updatedAt: isoUtc });
export const FeishuDeliveryIssueListResponseV1Schema = strict({ items: z.array(FeishuDeliveryIssueV1Schema), nextCursor: boundedText(500).nullable() });
export const ResolveFeishuDeliveryIssueRequestV1Schema = z.discriminatedUnion("action", [strict({ version: z.literal(1), requestId: uuid, messageKey: nonEmptyText(300), phase: z.enum(["ack", "result"]), action: z.literal("assume_sent"), confirmation: z.literal("ASSUME_SENT") }), strict({ version: z.literal(1), requestId: uuid, messageKey: nonEmptyText(300), phase: z.enum(["ack", "result"]), action: z.literal("retry_once"), confirmation: z.literal("RETRY_MAY_DUPLICATE") })]);
export const ResolveFeishuDeliveryIssueReceiptV1Schema = strict({ status: z.enum(["sent_assumed", "pending"]) });

export const SaveAiCredentialRequestV1Schema = strict({ version: z.literal(1), provider: z.literal(AI_PROVIDER_ID), model: z.literal(AI_MODEL_ID), apiKey: nonEmptyText(512) });
export const SaveFeishuCredentialRequestV1Schema = strict({ version: z.literal(1), appId: nonEmptyText(200), appSecret: nonEmptyText(512) });
export const CredentialReceiptV1Schema = strict({ configured: z.literal(true), updatedAt: isoUtc });
export const PublicSettingsV1Schema = strict({ ai: strict({ configured: z.boolean(), provider: boundedText(100).nullable(), model: boundedText(200).nullable() }), feishu: strict({ configured: z.boolean(), appIdMasked: boundedText(200).nullable(), status: z.enum(["not_configured", "disconnected", "connecting", "connected", "reconnecting", "error"]), bound: z.boolean(), replyMode: z.enum(["ack_only", "insight"]), deliveryIssueCount: z.number().int().nonnegative() }), data: strict({ databasePath: nonEmptyText(1000), lastBackupAt: isoUtc.nullable() }) });
export const LibrarySummaryV1Schema = strict({ total: z.number().int().nonnegative(), shelves: z.array(strict({ type: MemoryTypeSchema, count: z.number().int().nonnegative() })).max(6) });
export const DiagnosticEventV1Schema = strict({ timestamp: isoUtc, level: z.enum(["debug", "info", "warn", "error"]), event: nonEmptyText(200), correlationId: uuid, entryId: uuid.optional(), jobId: uuid.optional(), provider: boundedText(100).optional(), model: boundedText(200).optional(), promptVersion: boundedText(100).optional(), schemaVersion: boundedText(100).optional(), latencyMs: z.number().int().nonnegative().optional(), inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), providerRequestId: boundedText(300).optional(), attempts: z.number().int().nonnegative().optional(), errorCode: ErrorCodeSchema.optional() });

export const AiProviderV1Schema = strict({ provider: nonEmptyText(100), model: nonEmptyText(200), promptVersion: nonEmptyText(100), schemaVersion: nonEmptyText(100), latencyMs: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), providerRequestId: boundedText(300).optional(), rawText: z.string().optional(), parsedJson: z.unknown().optional() });

export const EntryGetRequestV1Schema = strict({ version: z.literal(1), entryId: uuid });
export const LibrarySummaryRequestV1Schema = strict({ version: z.literal(1) });
export const JobRetryResponseV1Schema = strict({ jobId: uuid, status: z.literal("queued") });
export const PublicSettingsRequestV1Schema = strict({ version: z.literal(1) });
export const UpdatePublicSettingsRequestV1Schema = strict({ version: z.literal(1), feishuReplyMode: z.enum(["ack_only", "insight"]).optional() });
export const BindingCodeReceiptV1Schema = strict({ code: nonEmptyText(32), expiresAt: isoUtc });
export const FeishuConnectionReceiptV1Schema = strict({ status: z.enum(["not_configured", "disconnected", "connecting", "connected", "reconnecting", "error"]) });
export const DeliveryIssueListRequestV1Schema = strict({ version: z.literal(1), cursor: boundedText(500).optional(), limit: z.number().int().min(1).max(100) });
export const WindowVisibilityResponseV1Schema = strict({ visible: z.boolean() });

export function validateInsightReplyAgainstMemories(reply: InsightReplyV1, memories: readonly RetrievedMemoryV1[]): boolean {
  if (!InsightReplyV1Schema.safeParse(reply).success) return false;
  const allowed = new Set(memories.map((memory) => `${memory.memoryId}\0${memory.entryId}\0${memory.evidenceQuote}`));
  const seen = new Set<string>();
  for (const citation of reply.citations) {
    const key = `${citation.memoryId}\0${citation.entryId}\0${citation.evidenceQuote}`;
    if (!allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function validateAnalysisEvidence(currentText: string, analysis: MemoryAnalysisV1): boolean {
  if (!MemoryAnalysisV1Schema.safeParse(analysis).success) return false;
  const evidence = [analysis.classification.evidence, ...analysis.summary.evidence, ...analysis.entities.items.map((item) => item.evidence), ...analysis.goals.items.map((item) => item.evidence), ...analysis.nextActions.items.map((item) => item.evidence)];
  return evidence.every((quote) => currentText.includes(quote));
}

export const CaptureReceiptV1 = CaptureReceiptV1Schema;
export type EntrySource = z.infer<typeof EntrySourceSchema>;
export type CaptureMode = z.infer<typeof CaptureModeSchema>;
export type EntryStatus = z.infer<typeof EntryStatusSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type DesktopCaptureRequestV1 = z.infer<typeof DesktopCaptureRequestV1Schema>;
export type CaptureCommandV1 = z.infer<typeof CaptureCommandV1Schema>;
export type CaptureReceiptV1 = z.infer<typeof CaptureReceiptV1Schema>;
export type MemoryAnalysisV1 = z.infer<typeof MemoryAnalysisV1Schema>;
export type InsightReplyV1 = z.infer<typeof InsightReplyV1Schema>;
export type RetrievedMemoryV1 = z.infer<typeof RetrievedMemoryV1Schema>;
export type DomainEventV1 = z.infer<typeof DomainEventV1Schema>;
export type EntryListRequestV1 = z.infer<typeof EntryListRequestV1Schema>;
export type EntryListResponseV1 = z.infer<typeof EntryListResponseV1Schema>;
export type EntryDetailV1 = z.infer<typeof EntryDetailV1Schema>;
export type EntryCorrectRequestV1 = z.infer<typeof EntryCorrectRequestV1Schema>;
export type ClaimedJobV1 = z.infer<typeof ClaimedJobV1Schema>;
export type DiagnosticsExportStatusV1 = z.infer<typeof DiagnosticsExportStatusV1Schema>;
export type BackupRestoreStatusV1 = z.infer<typeof BackupRestoreStatusV1Schema>;
export type ExportStatusV1 = z.infer<typeof ExportStatusV1Schema>;
export type FeishuDeliveryIssueV1 = z.infer<typeof FeishuDeliveryIssueV1Schema>;
export type AiProviderProtocolV2 = z.infer<typeof AiProviderProtocolV2Schema>;
export type AiProviderAuthModeV2 = z.infer<typeof AiProviderAuthModeV2Schema>;
export type AiStructuredOutputModeV2 = z.infer<typeof AiStructuredOutputModeV2Schema>;
export type DirectAiProviderProfileV2 = z.infer<typeof DirectAiProviderProfileV2Schema>;
export type CodexAiProviderProfileV2 = z.infer<typeof CodexAiProviderProfileV2Schema>;
export type AiProviderProfileV2 = z.infer<typeof AiProviderProfileV2Schema>;
export type AiProviderProfileDraftV2 = z.infer<typeof AiProviderProfileDraftV2Schema>;
export type AiProviderProfilesV2 = z.infer<typeof AiProviderProfilesV2Schema>;
export type SaveAiProviderProfileRequestV2 = z.infer<typeof SaveAiProviderProfileRequestV2Schema>;
export type AiProviderProbeResultV2 = z.infer<typeof AiProviderProbeResultV2Schema>;
export type CodexDiscoveryRequestV2 = z.infer<typeof CodexDiscoveryRequestV2Schema>;
export type CodexDiscoveryV2 = z.infer<typeof CodexDiscoveryV2Schema>;
export type Result<T> = { ok: true; data: T } | { ok: false; error: z.infer<typeof AppErrorSchema> };

export interface PaopaoApiV1 {
  capture: { create(input: DesktopCaptureRequestV1): Promise<Result<CaptureReceiptV1>> };
  entries: {
    list(input: EntryListRequestV1): Promise<Result<EntryListResponseV1>>;
    get(input: z.infer<typeof EntryGetRequestV1Schema>): Promise<Result<EntryDetailV1>>;
    reviseText(input: z.infer<typeof EntryReviseTextRequestV1Schema>): Promise<Result<z.infer<typeof TextRevisionReceiptV1Schema>>>;
    correct(input: EntryCorrectRequestV1): Promise<Result<z.infer<typeof CorrectionReceiptV1Schema>>>;
    delete(input: z.infer<typeof EntryDeleteRequestV1Schema>): Promise<Result<z.infer<typeof EntryDeleteReceiptV1Schema>>>;
  };
  library: { summary(input: z.infer<typeof LibrarySummaryRequestV1Schema>): Promise<Result<z.infer<typeof LibrarySummaryV1Schema>>> };
  jobs: { retry(input: z.infer<typeof JobRetryRequestV1Schema>): Promise<Result<z.infer<typeof JobRetryResponseV1Schema>>> };
  exports: { create(input: z.infer<typeof ExportCreateRequestV1Schema>): Promise<Result<z.infer<typeof ExportReceiptV1Schema>>>; get(input: { version: 1; exportId: string }): Promise<Result<ExportStatusV1>> };
  diagnostics: { createExport(input: z.infer<typeof DiagnosticsExportCreateRequestV1Schema>): Promise<Result<z.infer<typeof DiagnosticsExportReceiptV1Schema>>>; getExport(input: { version: 1; diagnosticExportId: string }): Promise<Result<DiagnosticsExportStatusV1>> };
  backups: { list(input: z.infer<typeof BackupListRequestV1Schema>): Promise<Result<z.infer<typeof BackupListResponseV1Schema>>>; restore(input: z.infer<typeof BackupRestoreRequestV1Schema>): Promise<Result<z.infer<typeof BackupRestoreReceiptV1Schema>>>; status(input: z.infer<typeof BackupRestoreStatusRequestV1Schema>): Promise<Result<BackupRestoreStatusV1>> };
}
