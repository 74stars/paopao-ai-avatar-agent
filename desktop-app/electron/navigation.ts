import { fileURLToPath } from "node:url";

export interface NavigationPolicy {
  packaged: boolean;
  devServerUrl: string;
  packagedEntryPath: string;
}

export function resolveDevServerUrl(rawUrl: string | undefined) {
  if (rawUrl === undefined) return "http://127.0.0.1:5173";

  const candidate = new URL(rawUrl);
  const port = Number(candidate.port);
  if (
    candidate.protocol !== "http:" ||
    candidate.hostname !== "127.0.0.1" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    candidate.username ||
    candidate.password ||
    candidate.pathname !== "/" ||
    candidate.search ||
    candidate.hash
  ) {
    throw new Error("PAOPAO_DEV_SERVER_URL must be an http://127.0.0.1:<port> origin");
  }
  return candidate.origin;
}

export function isAllowedNavigation(rawUrl: string, policy: NavigationPolicy) {
  try {
    const target = new URL(rawUrl);

    if (policy.packaged) {
      return target.protocol === "file:" && fileURLToPath(target) === policy.packagedEntryPath;
    }

    const devServer = new URL(policy.devServerUrl);
    return target.origin === devServer.origin && target.pathname === "/";
  } catch {
    return false;
  }
}
