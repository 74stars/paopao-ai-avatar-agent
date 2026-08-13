import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { isAllowedNavigation, resolveDevServerUrl, type NavigationPolicy } from "../electron/navigation.js";

const devServerUrl = "http://127.0.0.1:5173";
const packagedEntryPath = resolve("fixtures/app.asar/dist/index.html");

describe("isAllowedNavigation", () => {
  it("allows only the configured development origin and root path", () => {
    const policy: NavigationPolicy = { packaged: false, devServerUrl, packagedEntryPath };

    expect(isAllowedNavigation(`${devServerUrl}/?surface=pet`, policy)).toBe(true);
    expect(isAllowedNavigation(`${devServerUrl}/#pet`, policy)).toBe(true);
    expect(isAllowedNavigation("http://127.0.0.1:5173@evil.example/", policy)).toBe(false);
    expect(isAllowedNavigation("http://127.0.0.1:51730/", policy)).toBe(false);
    expect(isAllowedNavigation(`${devServerUrl}/other`, policy)).toBe(false);
  });

  it("allows only the packaged renderer entry while preserving query and hash", () => {
    const policy: NavigationPolicy = { packaged: true, devServerUrl, packagedEntryPath };
    const entryUrl = pathToFileURL(packagedEntryPath);
    entryUrl.searchParams.set("surface", "library");
    entryUrl.hash = "detail";

    expect(isAllowedNavigation(entryUrl.href, policy)).toBe(true);
    expect(isAllowedNavigation(pathToFileURL(resolve("fixtures/other/index.html")).href, policy)).toBe(false);
    expect(isAllowedNavigation("file:///etc/passwd", policy)).toBe(false);
    expect(isAllowedNavigation("file:///C:/Windows/System32/drivers/etc/hosts", policy)).toBe(false);
    expect(isAllowedNavigation("not a url", policy)).toBe(false);
  });
});

describe("resolveDevServerUrl", () => {
  it("uses the stable local default and accepts an explicit loopback port", () => {
    expect(resolveDevServerUrl(undefined)).toBe(devServerUrl);
    expect(resolveDevServerUrl("http://127.0.0.1:43127")).toBe("http://127.0.0.1:43127");
  });

  it.each([
    "https://127.0.0.1:43127",
    "http://localhost:43127",
    "http://127.0.0.1",
    "http://127.0.0.1:43127/other",
    "http://user@127.0.0.1:43127"
  ])("rejects a development URL outside the loopback-origin contract: %s", (value) => {
    expect(() => resolveDevServerUrl(value)).toThrow("PAOPAO_DEV_SERVER_URL");
  });
});
