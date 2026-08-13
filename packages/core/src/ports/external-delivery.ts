import {
  ClaimedExternalDeliveryV1Schema,
  FeishuDeliveryIssueListResponseV1Schema,
  FeishuRecipientV1Schema,
  ResolveFeishuDeliveryIssueRequestV1Schema,
  ResolveFeishuDeliveryIssueReceiptV1Schema,
  type ErrorCode,
} from "@paopao/contracts";
import type { SanitizedFailureV1 } from "./jobs.js";

export type ExternalDeliveryPhase = "ack" | "result";
export type ControlKind = "bind" | "unbind" | "binding_required" | "unsupported_message" | "p2p_only" | "help";
export type ControlReplyCode = "bound" | "unbound" | "binding_required" | "unsupported_message" | "p2p_only" | "help" | "binding_error";
export type ControlOutcome = "bound" | "unbound" | "ignored" | "rejected";
export type FeishuRecipient = ReturnType<typeof FeishuRecipientV1Schema.parse>;
export type ClaimedExternalDelivery = ReturnType<typeof ClaimedExternalDeliveryV1Schema.parse>;
export type FeishuDeliveryIssueListResponse = ReturnType<typeof FeishuDeliveryIssueListResponseV1Schema.parse>;
export type ResolveFeishuDeliveryIssueRequest = ReturnType<typeof ResolveFeishuDeliveryIssueRequestV1Schema.parse>;
export type ResolveFeishuDeliveryIssueReceipt = ReturnType<typeof ResolveFeishuDeliveryIssueReceiptV1Schema.parse>;

export interface DueExternalDeliveryRef {
  messageKey: string;
  entryId: string | null;
  phase: ExternalDeliveryPhase;
  attempts: number;
}

export class ExternalDeliveryError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryable = false) {
    super(message);
    this.name = "ExternalDeliveryError";
  }
}

export interface ExternalDeliveryService {
  listDue(input: { now: string; phase?: ExternalDeliveryPhase; entryId?: string; limit: number }): Promise<DueExternalDeliveryRef[]>;
  claimReply(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    leaseMs: number;
    now: string;
  }): Promise<{ decision: "send"; delivery: ClaimedExternalDelivery } | { decision: "skip" | "ambiguous"; delivery: null }>;
  renewReplyLease(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    fencingToken: number;
    leaseMs: number;
    now: string;
  }): Promise<boolean>;
  completeReply(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    fencingToken: number;
    externalReplyId: string;
  }): Promise<boolean>;
  failReply(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    fencingToken: number;
    outcome: "confirmed_not_sent" | "unknown";
    error: SanitizedFailureV1;
    now: string;
  }): Promise<boolean>;
  claimControlEvent(input: {
    provider: "feishu";
    eventKey: string;
    messageKey: string;
    controlKind: ControlKind;
    recipient: FeishuRecipient;
    owner: string;
    leaseMs: number;
    now: string;
  }): Promise<{ decision: "process" | "skip"; fencingToken: number | null }>;
  completeControlEvent(input: {
    provider: "feishu";
    eventKey: string;
    messageKey: string;
    owner: string;
    fencingToken: number;
    outcome: ControlOutcome;
    replyCode: ControlReplyCode;
  }): Promise<boolean>;
  listIssues(input: { cursor?: string; limit: number }): Promise<FeishuDeliveryIssueListResponse>;
  countIssues(): Promise<number>;
  resolveIssue(command: ResolveFeishuDeliveryIssueRequest): Promise<ResolveFeishuDeliveryIssueReceipt>;
  recoverStaleClaims(input: { now: string; providerSupportsIdempotentSend: boolean }): Promise<{ controlsReleased: number; repliesMarkedAmbiguous: number }>;
}

export interface ExternalDeliveryRepository extends ExternalDeliveryService {}
