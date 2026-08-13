import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("Wave 3 adapter has no HTTP server, Electron dependency, or second persistence implementation", () => {
  const adapterSources = sourceFiles(join(process.cwd(), "adapters", "feishu", "src"));
  const source = adapterSources.map((path) => readFileSync(path, "utf8")).join("\n");

  const forbidden = [
    /from\s+["']electron["']/,
    /from\s+["']node:http(?:s)?["']/,
    /from\s+["']node:fs["']/,
    /better-sqlite3/,
    /createServer\s*\(/,
    /\.listen\s*\(/,
    /\bexpress\s*\(/,
    /\b(?:writeFile|appendFile|createWriteStream)\w*\s*\(/,
    /supabase|postgres|mongodb|firebase/i,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `adapter production source violates boundary: ${pattern}`);
  }
  assert.match(source, /@larksuiteoapi\/node-sdk/, "official Feishu Node SDK must remain the transport implementation");
});

test("preload exposes semantic write-only credential commands without credential reads or raw IPC", () => {
  const preload = readFileSync(join(process.cwd(), "desktop-app", "electron", "preload.ts"), "utf8");
  assert.match(preload, /contextBridge\.exposeInMainWorld\("paopao"/);
  assert.match(preload, /saveFeishuCredential/);
  assert.doesNotMatch(preload, /getFeishuCredential|readFeishuAppSecret|getAiCredential|readApiKey/);
  assert.doesNotMatch(preload, /\bipcRenderer\s*[:,]/, "raw ipcRenderer must not be a contextBridge property");
  assert.doesNotMatch(preload, /\binvoke\s*:\s*ipcRenderer\.invoke/, "generic invoke must not cross contextBridge");
});
