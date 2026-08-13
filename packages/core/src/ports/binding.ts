export type BindingErrorCode =
  | "BINDING_CODE_INVALID"
  | "BINDING_CODE_EXPIRED"
  | "BINDING_CODE_CONSUMED"
  | "BINDING_RATE_LIMITED";

export class BindingError extends Error {
  readonly retryable: boolean;

  constructor(readonly code: BindingErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "BindingError";
    this.retryable = retryable;
  }
}

export interface BindingIdentity {
  appId: string;
  tenantKey: string;
  openId: string;
}

export interface BindingCodeRecord {
  id: string;
  salt: string;
  codeHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface BindingRepository {
  replaceActiveCode(record: BindingCodeRecord): void;
  isBound(identity: BindingIdentity): boolean;
  hasActiveBinding(): boolean;
  consumeCode(input: BindingIdentity & {
    operationKey: string;
    code: string;
    operationCodeSalt: string;
    operationCodeHash: string;
    now: string;
    verifyCode: (code: string, salt: string, expectedHash: string) => boolean;
  }): { bound: true };
  unbind(input: BindingIdentity & { operationKey: string; now: string }): void;
}

export interface BindingService {
  createCode(ttlMs?: number): Promise<{ code: string; expiresAt: string }>;
  isBound(input: BindingIdentity): Promise<boolean>;
  hasActiveBinding(): Promise<boolean>;
  consumeCode(input: BindingIdentity & { operationKey: string; code: string }): Promise<{ bound: true }>;
  unbind(input: BindingIdentity & { operationKey: string }): Promise<void>;
}
