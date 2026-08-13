import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { BindingRepository, BindingService } from "../ports/binding.js";
import type { Clock, IdGenerator } from "../ports/runtime.js";

export const DEFAULT_BINDING_TTL_MS = 10 * 60 * 1_000;
const MAX_BINDING_TTL_MS = 24 * 60 * 60 * 1_000;

export interface BindingCrypto {
  generateCode(): string;
  generateSalt(): string;
  hash(code: string, salt: string): string;
  verify(code: string, salt: string, expectedHash: string): boolean;
}

const defaultCrypto: BindingCrypto = {
  generateCode: () => randomInt(0, 1_000_000).toString().padStart(6, "0"),
  generateSalt: () => randomBytes(16).toString("hex"),
  hash: hashBindingCode,
  verify(code, salt, expectedHash) {
    const actual = Buffer.from(hashBindingCode(code, salt), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  },
};

const defaultIds: IdGenerator = { next: randomUUID };

export function createBindingService(dependencies: {
  repository: BindingRepository;
  clock: Clock;
  ids?: IdGenerator;
  crypto?: BindingCrypto;
}): BindingService {
  const ids = dependencies.ids ?? defaultIds;
  const crypto = dependencies.crypto ?? defaultCrypto;
  return {
    async createCode(ttlMs = DEFAULT_BINDING_TTL_MS) {
      if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_BINDING_TTL_MS) throw new RangeError("Invalid binding code TTL");
      const now = dependencies.clock.now();
      const code = crypto.generateCode();
      if (!/^\d{6}$/.test(code)) throw new Error("Binding code generator must return six digits");
      const salt = crypto.generateSalt();
      const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
      dependencies.repository.replaceActiveCode({ id: ids.next(), salt, codeHash: crypto.hash(code, salt), expiresAt, createdAt: now });
      return { code, expiresAt };
    },
    async isBound(input) {
      return dependencies.repository.isBound(input);
    },
    async hasActiveBinding() {
      return dependencies.repository.hasActiveBinding();
    },
    async consumeCode(input) {
      const operationCodeSalt = crypto.generateSalt();
      return dependencies.repository.consumeCode({
        ...input,
        operationCodeSalt,
        operationCodeHash: crypto.hash(input.code, operationCodeSalt),
        now: dependencies.clock.now(),
        verifyCode: crypto.verify,
      });
    },
    async unbind(input) {
      dependencies.repository.unbind({ ...input, now: dependencies.clock.now() });
    },
  };
}

function hashBindingCode(code: string, salt: string): string {
  // scrypt makes an offline search of the six-digit space materially more expensive.
  return scryptSync(code, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
}
