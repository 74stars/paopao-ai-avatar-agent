import {
  AiProviderProfileDraftV2Schema,
  type AiProviderProfileDraftV2,
  type AiProviderProfileV2,
  type AiProviderProfilesV2,
  type SaveAiProviderProfileRequestV2,
} from "@paopao/contracts";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import type { SafeStorageLike } from "./credential-store.js";

export const LEGACY_PROVIDER_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const FORBIDDEN_AUTH_HEADERS = new Set(["authorization", "host", "content-length", "connection", "transfer-encoding", "cookie", "set-cookie"]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CODEX_PROFILE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,99}$/;

const storedDirectProfileSchema = AiProviderProfileDraftV2Schema.options[0].extend({
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  encryptedCredential: z.string().min(1).optional(),
});
const storedCodexProfileSchema = AiProviderProfileDraftV2Schema.options[1].extend({
  revision: z.number().int().positive(),
  updatedAt: z.string(),
});
const storedProfileSchema = z.discriminatedUnion("kind", [storedDirectProfileSchema, storedCodexProfileSchema]);
const storedProfilesSchema = z.object({
  version: z.literal(2),
  activeProfileId: z.string().uuid().nullable(),
  profiles: z.array(storedProfileSchema).max(32),
}).strict();

type StoredProfile = z.infer<typeof storedProfileSchema>;
type StoredProfiles = z.infer<typeof storedProfilesSchema>;

export interface ProviderProfileStoreOptions {
  filePath: string;
  safeStorage: SafeStorageLike;
  now?: () => string;
}

export interface ResolvedProviderProfile {
  profile: AiProviderProfileV2;
  credential: string | null;
  generation: number;
}

export interface ProviderProfileStore {
  list(): AiProviderProfilesV2;
  save(input: SaveAiProviderProfileRequestV2): AiProviderProfileV2;
  activate(profileId: string): AiProviderProfilesV2;
  delete(profileId: string): AiProviderProfilesV2;
  resolve(profileId: string): ResolvedProviderProfile | null;
  resolveActive(): ResolvedProviderProfile | null;
  generation(): number;
  sensitiveValues(): string[];
  migrateLegacy(input: { provider: string; model: string; apiKey: string }): boolean;
  deleteLegacy(): boolean;
}

export function createProviderProfileStore(options: ProviderProfileStoreOptions): ProviderProfileStore {
  return new FileProviderProfileStore(options);
}

class FileProviderProfileStore implements ProviderProfileStore {
  readonly #filePath: string;
  readonly #safeStorage: SafeStorageLike;
  readonly #now: () => string;
  #state: StoredProfiles;
  #generation = 0;

  constructor(options: ProviderProfileStoreOptions) {
    this.#filePath = options.filePath;
    this.#safeStorage = options.safeStorage;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#state = loadState(this.#filePath);
  }

  list(): AiProviderProfilesV2 {
    return {
      version: 2,
      activeProfileId: this.#state.activeProfileId,
      profiles: this.#state.profiles.map((profile) => this.#toPublic(profile)),
    };
  }

  save(input: SaveAiProviderProfileRequestV2): AiProviderProfileV2 {
    const draft = validateDraft(input.profile);
    const existing = this.#state.profiles.find((profile) => profile.id === draft.id);
    if (!existing && this.#state.profiles.length >= 32) throw invalidProfile("AI Provider 配置最多保存 32 个");
    const updatedAt = this.#now();
    const revision = existing ? existing.revision + 1 : 1;
    let next: StoredProfile;

    if (draft.kind === "direct") {
      const previousEncrypted = existing?.kind === "direct" && canReuseCredential(existing, draft)
        ? existing.encryptedCredential
        : undefined;
      const credential = input.credential?.trim();
      const encryptedCredential = draft.authMode === "none"
        ? undefined
        : credential
          ? this.#encrypt(credential)
          : previousEncrypted;
      next = {
        ...draft,
        revision,
        updatedAt,
        ...(encryptedCredential ? { encryptedCredential } : {}),
      };
    } else {
      next = { ...draft, revision, updatedAt };
    }

    const profiles = existing
      ? this.#state.profiles.map((profile) => profile.id === next.id ? next : profile)
      : [...this.#state.profiles, next];
    this.#state = {
      version: 2,
      activeProfileId: this.#state.activeProfileId ?? next.id,
      profiles,
    };
    this.#persist();
    this.#generation += 1;
    return this.#toPublic(next);
  }

  activate(profileId: string): AiProviderProfilesV2 {
    if (!this.#state.profiles.some((profile) => profile.id === profileId)) throw profileNotFound();
    if (this.#state.activeProfileId !== profileId) {
      this.#state = { ...this.#state, activeProfileId: profileId };
      this.#persist();
      this.#generation += 1;
    }
    return this.list();
  }

  delete(profileId: string): AiProviderProfilesV2 {
    if (!this.#state.profiles.some((profile) => profile.id === profileId)) throw profileNotFound();
    this.#state = {
      version: 2,
      activeProfileId: this.#state.activeProfileId === profileId ? null : this.#state.activeProfileId,
      profiles: this.#state.profiles.filter((profile) => profile.id !== profileId),
    };
    this.#persist();
    this.#generation += 1;
    return this.list();
  }

  resolveActive(): ResolvedProviderProfile | null {
    return this.#state.activeProfileId ? this.resolve(this.#state.activeProfileId) : null;
  }

  resolve(profileId: string): ResolvedProviderProfile | null {
    const stored = this.#state.profiles.find((profile) => profile.id === profileId);
    if (!stored) return null;
    const profile = this.#toPublic(stored);
    if (stored.kind === "codex") return { profile, credential: null, generation: this.#generation };
    if (stored.authMode === "none") return { profile, credential: null, generation: this.#generation };
    const credential = this.#decrypt(stored.encryptedCredential);
    return credential ? { profile, credential, generation: this.#generation } : null;
  }

  generation(): number {
    return this.#generation;
  }

  sensitiveValues(): string[] {
    return this.#state.profiles.flatMap((profile) => {
      if (profile.kind !== "direct") return [];
      const credential = this.#decrypt(profile.encryptedCredential);
      return credential ? [credential] : [];
    });
  }

  migrateLegacy(input: { provider: string; model: string; apiKey: string }): boolean {
    if (this.#state.profiles.length > 0 || !input.apiKey.trim()) return false;
    this.save({
      version: 2,
      credential: input.apiKey,
      profile: {
        id: LEGACY_PROVIDER_PROFILE_ID,
        kind: "direct",
        name: "OpenAI",
        providerId: input.provider,
        protocol: "openai_chat_completions",
        baseUrl: "https://api.openai.com/v1",
        model: input.model,
        authMode: "bearer",
        authHeaderName: null,
        structuredOutput: "json_schema",
        timeoutMs: 60_000,
      },
    });
    return true;
  }

  deleteLegacy(): boolean {
    if (!this.#state.profiles.some((profile) => profile.id === LEGACY_PROVIDER_PROFILE_ID)) return false;
    this.delete(LEGACY_PROVIDER_PROFILE_ID);
    return true;
  }

  #toPublic(profile: StoredProfile): AiProviderProfileV2 {
    if (profile.kind === "codex") return { ...profile, credentialConfigured: true };
    const { encryptedCredential: _encryptedCredential, ...publicProfile } = profile;
    const credentialConfigured = profile.authMode === "none" || Boolean(this.#decrypt(profile.encryptedCredential));
    return { ...publicProfile, credentialConfigured };
  }

  #encrypt(value: string): string {
    if (!this.#safeStorage.isEncryptionAvailable()) throw safeStorageUnavailable();
    return this.#safeStorage.encryptString(value).toString("base64");
  }

  #decrypt(value?: string): string | null {
    if (!value || !this.#safeStorage.isEncryptionAvailable()) return null;
    try {
      return this.#safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return null;
    }
  }

  #persist(): void {
    if (this.#state.profiles.length === 0) {
      rmSync(this.#filePath, { force: true });
      return;
    }
    atomicWriteJson(this.#filePath, this.#state);
  }
}

function validateDraft(raw: AiProviderProfileDraftV2): AiProviderProfileDraftV2 {
  const parsed = AiProviderProfileDraftV2Schema.parse(raw);
  const name = parsed.name.trim();
  if (!name) throw invalidProfile("配置名称不能为空");
  if (parsed.kind === "codex") {
    const profile = optionalTrim(parsed.profile);
    const model = optionalTrim(parsed.model);
    const codexHome = optionalTrim(parsed.codexHome);
    if (profile && !CODEX_PROFILE_PATTERN.test(profile)) throw invalidProfile("Codex Profile 只能包含字母、数字、点、下划线和连字符");
    if (codexHome && !isAbsolute(codexHome) && codexHome !== "~" && !codexHome.startsWith("~/") && !codexHome.startsWith("~\\")) {
      throw invalidProfile("Codex Home 必须是绝对路径或以 ~ 开头的用户目录路径");
    }
    return { ...parsed, name, profile, model, codexHome };
  }
  const providerId = parsed.providerId.trim();
  const model = parsed.model.trim();
  if (!providerId || !model) throw invalidProfile("Provider ID 和模型不能为空");
  let url: URL;
  try {
    url = new URL(parsed.baseUrl.trim());
  } catch {
    throw invalidProfile("Provider URL 无效");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw invalidProfile("Provider URL 必须使用 HTTPS，本机 loopback 除外");
  if (url.username || url.password || url.search || url.hash) throw invalidProfile("Provider URL 不得包含凭据、查询参数或片段");
  const baseUrl = url.toString().replace(/\/$/, "");
  if (parsed.authMode === "api_key_header") {
    const name = parsed.authHeaderName?.trim() ?? "";
    if (!HEADER_NAME_PATTERN.test(name) || FORBIDDEN_AUTH_HEADERS.has(name.toLowerCase())) throw invalidProfile("自定义认证 Header 名称无效");
  } else if (parsed.authHeaderName !== null) {
    throw invalidProfile("只有 API Key Header 模式可以设置 Header 名称");
  }
  return { ...parsed, name, providerId, model, baseUrl, authHeaderName: parsed.authMode === "api_key_header" ? parsed.authHeaderName!.trim() : null };
}

function optionalTrim(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function canReuseCredential(existing: Extract<StoredProfile, { kind: "direct" }>, next: Extract<AiProviderProfileDraftV2, { kind: "direct" }>): boolean {
  return existing.baseUrl === next.baseUrl
    && existing.authMode === next.authMode
    && existing.authHeaderName === next.authHeaderName;
}

function loadState(filePath: string): StoredProfiles {
  try {
    const parsed = storedProfilesSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // Fail closed to an empty profile set; the invalid file is left untouched.
  }
  return { version: 2, activeProfileId: null, profiles: [] };
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

function invalidProfile(message: string) {
  return { code: "VALIDATION_FAILED" as const, message, retryable: false, correlationId: randomUUID() };
}

function profileNotFound() {
  return { code: "NOT_FOUND" as const, message: "AI Provider 配置不存在。", retryable: false, correlationId: randomUUID() };
}

function safeStorageUnavailable() {
  return { code: "SAFE_STORAGE_UNAVAILABLE" as const, message: "系统安全存储不可用，无法加密保存凭据。", retryable: false, correlationId: randomUUID() };
}
