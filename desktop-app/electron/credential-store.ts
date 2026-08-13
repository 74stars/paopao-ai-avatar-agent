import {
  AI_MODEL_ID,
  AI_PROVIDER_ID,
  type SaveFeishuCredentialRequestV1Schema,
} from "@paopao/contracts";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AiConfigSaveRequestV1, AiConfigStatusV1 } from "./preload-shared/ai-config-contracts.js";

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export {
  AiConfigDeleteRequestV1Schema,
  AiConfigReceiptV1Schema,
  AiConfigSaveRequestV1Schema,
  AiConfigStatusRequestV1Schema,
  AiConfigStatusV1Schema,
  type AiConfigDeleteRequestV1,
  type AiConfigSaveRequestV1,
  type AiConfigStatusRequestV1,
  type AiConfigStatusV1,
} from "./preload-shared/ai-config-contracts.js";

const storedAiCredentialSchema = strict({
  provider: z.literal(AI_PROVIDER_ID),
  model: z.literal(AI_MODEL_ID),
  encryptedApiKey: z.string().min(1),
  updatedAt: z.string(),
});

const storedFeishuCredentialSchema = strict({
  encryptedAppSecret: z.string().min(1),
  updatedAt: z.string(),
});

const storedCredentialsSchema = strict({
  version: z.literal(1),
  ai: storedAiCredentialSchema.optional(),
  feishu: storedFeishuCredentialSchema.optional(),
});

// Wave 1 stored the AI credential directly at the root. Read it once and
// normalize it into the shared envelope on the next write.
const legacyStoredCredentialSchema = strict({
  version: z.literal(1),
  ...storedAiCredentialSchema.shape,
});

const publicSettingsSchema = strict({
  version: z.literal(1),
  feishu: strict({
    appId: z.string().min(1).max(200).nullable(),
    replyMode: z.enum(["ack_only", "insight"]),
  }),
});

type StoredCredentials = z.infer<typeof storedCredentialsSchema>;
type PublicSettings = z.infer<typeof publicSettingsSchema>;
type SaveFeishuCredentialRequestV1 = z.infer<typeof SaveFeishuCredentialRequestV1Schema>;

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface AiCredentialStore {
  /** Renderer-safe read model: never includes the API key. */
  status(): AiConfigStatusV1;
  /** Persists an encrypted key. Throws SAFE_STORAGE_UNAVAILABLE when encryption is unavailable. */
  save(input: AiConfigSaveRequestV1): AiConfigStatusV1;
  /** Removes the stored credential and invalidates any cached provider generation. */
  delete(): AiConfigStatusV1;
  /** Main-only transient read; never exposed over IPC. */
  readApiKey(): string | null;
  /** Bumped on every save/delete so cached provider instances can be invalidated. */
  generation(): number;
}

export interface FeishuCredentialStatusV1 {
  isConfigured: boolean;
  appIdMasked: string | null;
}

export interface MainCredentialProviderV1 {
  getAiCredential(): Promise<{ provider: string; model: string; apiKey: string } | null>;
  getFeishuCredential(): Promise<{ appId: string; appSecret: string } | null>;
  clearDecryptedCache(scope: "ai" | "feishu" | "all"): void;
}

export interface MainCredentialStoreV1 extends AiCredentialStore, MainCredentialProviderV1 {
  saveAiCredential(input: AiConfigSaveRequestV1): { configured: true; updatedAt: string };
  feishuStatus(): FeishuCredentialStatusV1;
  saveFeishu(input: SaveFeishuCredentialRequestV1): { configured: true; updatedAt: string };
  deleteFeishu(): { configured: false };
  /** Main-only diagnostics canary; never expose through IPC. */
  readFeishuAppSecret(): string | null;
  getFeishuReplyMode(): Promise<"ack_only" | "insight">;
  updateFeishuReplyMode(mode: "ack_only" | "insight"): void;
}

export interface MainCredentialStoreOptions {
  filePath: string;
  publicSettingsPath?: string;
  safeStorage: SafeStorageLike;
  now?: () => string;
}

export function createMainCredentialStore(options: MainCredentialStoreOptions): MainCredentialStoreV1 {
  return new FileCredentialStore(options);
}

export function createAiCredentialStore(options: MainCredentialStoreOptions): AiCredentialStore {
  return createMainCredentialStore(options);
}

class FileCredentialStore implements MainCredentialStoreV1 {
  readonly #filePath: string;
  readonly #publicSettingsPath: string;
  readonly #safeStorage: SafeStorageLike;
  readonly #now: () => string;
  #credentials: StoredCredentials;
  #publicSettings: PublicSettings;
  #generation = 0;
  #decryptedAi: { provider: string; model: string; apiKey: string } | null | undefined;
  #decryptedFeishu: { appId: string; appSecret: string } | null | undefined;

  constructor(options: MainCredentialStoreOptions) {
    this.#filePath = options.filePath;
    this.#publicSettingsPath = options.publicSettingsPath ?? join(dirname(options.filePath), "public-settings.v1.json");
    this.#safeStorage = options.safeStorage;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#credentials = this.#loadCredentials();
    this.#publicSettings = this.#loadPublicSettings();
  }

  status(): AiConfigStatusV1 {
    const stored = this.#credentials.ai;
    if (!this.#safeStorage.isEncryptionAvailable() || !stored) return notConfigured();
    return { version: 1, isConfigured: true, provider: stored.provider, model: stored.model };
  }

  save(input: AiConfigSaveRequestV1): AiConfigStatusV1 {
    this.saveAiCredential(input);
    return this.status();
  }

  saveAiCredential(input: AiConfigSaveRequestV1): { configured: true; updatedAt: string } {
    this.#assertEncryptionAvailable();
    const updatedAt = this.#now();
    this.#credentials.ai = {
      provider: input.provider,
      model: input.model,
      encryptedApiKey: this.#safeStorage.encryptString(input.apiKey).toString("base64"),
      updatedAt,
    };
    this.#persistCredentials();
    this.#generation += 1;
    this.clearDecryptedCache("ai");
    return { configured: true, updatedAt };
  }

  delete(): AiConfigStatusV1 {
    delete this.#credentials.ai;
    this.#persistCredentials();
    this.#generation += 1;
    this.clearDecryptedCache("ai");
    return notConfigured();
  }

  readApiKey(): string | null {
    return this.#getAiCredential()?.apiKey ?? null;
  }

  generation(): number {
    return this.#generation;
  }

  feishuStatus(): FeishuCredentialStatusV1 {
    const configured = this.#safeStorage.isEncryptionAvailable()
      && Boolean(this.#credentials.feishu)
      && Boolean(this.#publicSettings.feishu.appId);
    return {
      isConfigured: configured,
      appIdMasked: configured ? maskAppId(this.#publicSettings.feishu.appId!) : null,
    };
  }

  saveFeishu(input: SaveFeishuCredentialRequestV1): { configured: true; updatedAt: string } {
    this.#assertEncryptionAvailable();
    const updatedAt = this.#now();
    const nextPublicSettings: PublicSettings = {
      ...this.#publicSettings,
      feishu: { ...this.#publicSettings.feishu, appId: input.appId },
    };
    const nextCredentials: StoredCredentials = {
      ...this.#credentials,
      feishu: {
        encryptedAppSecret: this.#safeStorage.encryptString(input.appSecret).toString("base64"),
        updatedAt,
      },
    };

    // A crash between the two writes can expose only a public App ID. The
    // facade still reports not configured until both files are present.
    atomicWriteJson(this.#publicSettingsPath, nextPublicSettings);
    atomicWriteJson(this.#filePath, nextCredentials);
    this.#publicSettings = nextPublicSettings;
    this.#credentials = nextCredentials;
    this.clearDecryptedCache("feishu");
    return { configured: true, updatedAt };
  }

  deleteFeishu(): { configured: false } {
    delete this.#credentials.feishu;
    this.#persistCredentials();
    this.#publicSettings = {
      ...this.#publicSettings,
      feishu: { ...this.#publicSettings.feishu, appId: null },
    };
    atomicWriteJson(this.#publicSettingsPath, this.#publicSettings);
    this.clearDecryptedCache("feishu");
    return { configured: false };
  }

  async getAiCredential(): Promise<{ provider: string; model: string; apiKey: string } | null> {
    return this.#getAiCredential();
  }

  async getFeishuCredential(): Promise<{ appId: string; appSecret: string } | null> {
    return this.#getFeishuCredential();
  }

  readFeishuAppSecret(): string | null {
    return this.#getFeishuCredential()?.appSecret ?? null;
  }

  #getFeishuCredential(): { appId: string; appSecret: string } | null {
    if (this.#decryptedFeishu !== undefined) return this.#decryptedFeishu;
    if (!this.#safeStorage.isEncryptionAvailable()) return (this.#decryptedFeishu = null);
    const stored = this.#credentials.feishu;
    const appId = this.#publicSettings.feishu.appId;
    if (!stored || !appId) return (this.#decryptedFeishu = null);
    try {
      return (this.#decryptedFeishu = {
        appId,
        appSecret: this.#safeStorage.decryptString(Buffer.from(stored.encryptedAppSecret, "base64")),
      });
    } catch {
      return (this.#decryptedFeishu = null);
    }
  }

  clearDecryptedCache(scope: "ai" | "feishu" | "all"): void {
    if (scope === "ai" || scope === "all") this.#decryptedAi = undefined;
    if (scope === "feishu" || scope === "all") this.#decryptedFeishu = undefined;
  }

  async getFeishuReplyMode(): Promise<"ack_only" | "insight"> {
    return this.#publicSettings.feishu.replyMode;
  }

  updateFeishuReplyMode(mode: "ack_only" | "insight"): void {
    this.#publicSettings = {
      ...this.#publicSettings,
      feishu: { ...this.#publicSettings.feishu, replyMode: mode },
    };
    atomicWriteJson(this.#publicSettingsPath, this.#publicSettings);
  }

  #getAiCredential(): { provider: string; model: string; apiKey: string } | null {
    if (this.#decryptedAi !== undefined) return this.#decryptedAi;
    if (!this.#safeStorage.isEncryptionAvailable()) return (this.#decryptedAi = null);
    const stored = this.#credentials.ai;
    if (!stored) return (this.#decryptedAi = null);
    try {
      return (this.#decryptedAi = {
        provider: stored.provider,
        model: stored.model,
        apiKey: this.#safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64")),
      });
    } catch {
      return (this.#decryptedAi = null);
    }
  }

  #assertEncryptionAvailable(): void {
    if (!this.#safeStorage.isEncryptionAvailable()) throw credentialError();
  }

  #persistCredentials(): void {
    if (!this.#credentials.ai && !this.#credentials.feishu) {
      rmSync(this.#filePath, { force: true });
      return;
    }
    atomicWriteJson(this.#filePath, this.#credentials);
  }

  #loadCredentials(): StoredCredentials {
    const raw = readJson(this.#filePath);
    const current = storedCredentialsSchema.safeParse(raw);
    if (current.success) return current.data;
    const legacy = legacyStoredCredentialSchema.safeParse(raw);
    if (legacy.success) {
      const { version, ...ai } = legacy.data;
      return { version, ai };
    }
    return { version: 1 };
  }

  #loadPublicSettings(): PublicSettings {
    const parsed = publicSettingsSchema.safeParse(readJson(this.#publicSettingsPath));
    return parsed.success
      ? parsed.data
      : { version: 1, feishu: { appId: null, replyMode: "ack_only" } };
  }
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  try {
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function maskAppId(appId: string): string {
  if (appId.length <= 6) return `${appId.slice(0, 1)}...${appId.slice(-1)}`;
  return `${appId.slice(0, 4)}...${appId.slice(-4)}`;
}

function notConfigured(): AiConfigStatusV1 {
  return { version: 1, isConfigured: false, provider: null, model: null };
}

function credentialError() {
  return {
    code: "SAFE_STORAGE_UNAVAILABLE" as const,
    message: "系统安全存储不可用，无法加密保存凭据。",
    retryable: false,
    correlationId: randomUUID(),
  };
}
