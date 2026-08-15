"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const { PNG } = require("pngjs");

const rootDirectory = path.resolve(__dirname, "../..");
const desktopDirectory = path.join(rootDirectory, "desktop-app");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const resultDirectory = path.join(rootDirectory, "test-results", "e2e-wave4", runId);
const userDataDirectory = mkdtempSync(path.join(os.tmpdir(), "paopao-wave4-e2e-"));
const report = {
  schemaVersion: 1,
  scope: "engineering",
  evidencePolicy: "Screenshots and pixel metrics describe render integrity only; they are not an art-quality judgment.",
  runId,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  result: "RUNNING",
  cases: [],
  artifacts: [],
  diagnostics: {}
};

mkdirSync(resultDirectory, { recursive: true });

let electronApplication;
let viteProcess;
let electronAbiPrepared = false;
let activeError;
const viteLog = [];
const electronLog = [];

async function main() {
  try {
    await runCommand(npmCommand, ["run", "build"]);
    electronAbiPrepared = true;
    await runCommand(npmCommand, ["run", "rebuild:native"]);
    await runWave4E2E();
    report.result = "PASS";
  } catch (error) {
    activeError = error;
    report.result = "FAIL";
    report.error = serializeError(error);
    process.exitCode = 1;
  } finally {
    await closeElectron();
    await stopProcess(viteProcess);
    writeLog("vite.log", viteLog);
    writeLog("electron.log", electronLog);
    rmSync(userDataDirectory, { recursive: true, force: true });

    if (electronAbiPrepared) {
      try {
        await runCommand(npmCommand, ["run", "rebuild:native:node"]);
        report.nodeAbiRestored = true;
      } catch (error) {
        report.result = "FAIL";
        report.nodeAbiRestored = false;
        report.nodeAbiRestoreError = serializeError(error);
        process.exitCode = 1;
        if (!activeError) activeError = error;
      }
    }

    report.finishedAt = new Date().toISOString();
    const reportPath = path.join(resultDirectory, "report.json");
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Wave 4 E2E ${report.result}: ${path.relative(rootDirectory, reportPath)}\n`);
  }

  if (activeError) throw activeError;
}

async function runWave4E2E() {
  const vitePort = await getAvailablePort();
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  viteProcess = startVite(vitePort);
  await waitForHttp(viteUrl, 20_000);

  electronApplication = await electron.launch({
    executablePath: require("electron"),
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: rootDirectory,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      PAOPAO_DEV_SERVER_URL: viteUrl
    },
    timeout: 30_000
  });
  captureProcessOutput(electronApplication.process(), electronLog);

  const pages = await waitForSurfaces(["pet", "capture", "library"]);
  const pet = pages.pet;
  const capture = pages.capture;
  let library = pages.library;
  const rendererErrors = [];
  const resourceFailures = [];
  let firstEntryToken = "";
  let secondEntryToken = "";

  const observeSurface = (surface, page) => {
    page.on("console", (message) => electronLog.push(`[renderer:${surface}:${message.type()}] ${message.text()}\n`));
    page.on("pageerror", (error) => {
      const detail = error.stack || error.message;
      rendererErrors.push({ surface, detail });
      electronLog.push(`[renderer:${surface}:error] ${detail}\n`);
    });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText || "request failed";
      // net::ERR_ABORTED means the browser cancelled/superseded the request
      // (e.g. an image re-requested during a scene switch), not a load failure.
      if (errorText === "net::ERR_ABORTED") return;
      resourceFailures.push({ surface, url: request.url(), error: errorText });
    });
    page.on("response", (response) => {
      if (response.status() >= 400) resourceFailures.push({ surface, url: response.url(), status: response.status() });
    });
  };

  for (const [surface, page] of Object.entries(pages)) {
    observeSurface(surface, page);
  }

  report.diagnostics.runtime = await electronApplication.evaluate(async ({ app }) => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userDataIsIsolated: app.getPath("userData").includes("paopao-wave4-e2e-")
  }));
  report.diagnostics.library = await electronApplication.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => {
      try { return new URL(candidate.webContents.getURL()).searchParams.get("surface") === "library"; } catch { return false; }
    });
    return win ? { bounds: win.getBounds(), contentSize: win.getContentSize() } : null;
  });
  report.diagnostics.runtime.devServerOrigin = viteUrl;
  assert.equal(report.diagnostics.runtime.userDataIsIsolated, true, "Electron did not use the isolated E2E userData directory");

  await runCase("renderer security boundary", async () => {
    for (const [surface, page] of Object.entries(pages)) {
      const boundary = await page.evaluate(() => ({
        require: typeof globalThis.require,
        process: typeof globalThis.process,
        buffer: typeof globalThis.Buffer,
        ipcRenderer: typeof globalThis.ipcRenderer,
        bridge: typeof window.paopao
      }));
      assert.deepEqual(boundary, {
        require: "undefined",
        process: "undefined",
        buffer: "undefined",
        ipcRenderer: "undefined",
        bridge: "object"
      }, `${surface} Renderer exposed a forbidden Node or raw IPC global`);
    }
    return { surfaces: Object.keys(pages) };
  });

  await runCase("pet transparent pixels and bubble edge", async () => {
    await pet.locator(".pet-window").waitFor({ state: "visible" });
    await pet.waitForTimeout(300);
    const screenshotPath = await screenshot(pet, "pet-transparent.png", { omitBackground: true });
    const pixels = analyzePetPng(readFileSync(screenshotPath));
    assert.ok(pixels.nonTransparentPixels > 500, "Pet screenshot does not contain a rendered bubble");
    assert.ok(pixels.meanCornerAlpha <= 16, `Pet corner regions are not transparent enough (mean alpha ${pixels.meanCornerAlpha}/255)`);
    assert.ok(pixels.opaqueCornerRatio <= 0.1, `Pet corner regions contain an opaque background (${pixels.opaqueCornerRatio})`);
    assert.ok(pixels.darkEdgeRatio <= 0.02, `Pet edge contains too many near-black pixels (${pixels.darkEdgeRatio})`);
    return pixels;
  });

  await runCase("pet uses one unified click and drag surface", async () => {
    const regions = await pet.locator(".pet-window").evaluate((root) => [root, ...root.querySelectorAll("*")].map((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region")));
    assert.equal(regions.some((region) => region === "drag" || region === "no-drag"), false, "Pet still splits interaction through app-region CSS");
    return { mainProcessDrag: true, clickSurfaceSplit: false };
  });

  await runCase("single click is delayed and opens Capture", async () => {
    assert.equal((await surfaceState("capture")).visible, false, "Capture must start hidden");
    const started = Date.now();
    await pet.locator(".pet-window").click();
    await delay(220);
    assert.equal((await surfaceState("capture")).visible, false, "Single-click action fired inside the double-click interval");
    await waitForSurfaceVisibility("capture", true, 1_200);
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs >= 330, `Single click fired too early (${elapsedMs}ms)`);
    await capture.locator("[data-testid='capture-window']").waitFor({ state: "visible" });
    await screenshot(capture, "capture-open.png");
    return { elapsedMs };
  });

  await runCase("double click cancels single click and opens Library", async () => {
    await capture.locator("[data-testid='capture-window']").evaluate(() => window.paopao.windows.hideCapture());
    assert.equal((await surfaceState("capture")).visible, false);
    assert.equal((await surfaceState("library")).visible, false);
    await pet.locator(".pet-window").click();
    await delay(90);
    await pet.locator(".pet-window").click();
    await waitForSurfaceVisibility("library", true, 1_000);
    await delay(420);
    assert.equal((await surfaceState("capture")).visible, false, "Double click also triggered the single-click Capture action");
    return { intervalMs: 90 };
  });

  await runCase("pet keyboard opens Library without opening Capture", async () => {
    await electronApplication.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const surface = (window) => {
        try { return new URL(window.webContents.getURL()).searchParams.get("surface"); } catch { return null; }
      };
      windows.find((window) => surface(window) === "library")?.hide();
      windows.find((window) => surface(window) === "pet")?.focus();
    });
    await waitForSurfaceVisibility("library", false, 1_000);
    const petControl = pet.locator(".pet-window");
    await petControl.focus();
    assert.equal(await petControl.getAttribute("aria-keyshortcuts"), "Enter Space Shift+Enter");
    await petControl.press("Shift+Enter");
    await waitForSurfaceVisibility("library", true, 1_000);
    assert.equal((await surfaceState("capture")).visible, false, "Pet Library keyboard action also opened Capture");
    return { shortcut: "Shift+Enter", libraryOpened: true, captureStayedHidden: true };
  });

  await runCase("pet drag suppresses click on one native surface", async () => {
    await library.evaluate(() => window.paopao?.windows.openLibrary && window.paopao.windows.openLibrary());
    await library.waitForTimeout(100);
    const captureBefore = await surfaceState("capture");
    const dragResult = await dragSurfaceFrom("pet", pet.locator(".pet-window"), 20, 16);
    assert.ok(dragResult.distance >= 8, `Pet BrowserWindow did not move far enough (${dragResult.distance}px)`);
    await delay(450);
    assert.equal((await surfaceState("capture")).visible, captureBefore.visible, "Pet drag triggered the single-click Capture action");
    return { mainProcessDrag: true, clickSuppressed: true, movedPixels: dragResult.distance };
  });

  await runCase("library screenshot and viewport evidence", async () => {
    await setLibraryContentSize(1180, 720);
    await library.locator("[data-testid='library-window']").waitFor({ state: "attached" });
    await library.waitForTimeout(500);
    const geometry = await library.evaluate(() => {
      const root = document.querySelector("[data-testid='library-window']");
      if (!root) return null;
      const rect = root.getBoundingClientRect();
      const images = Array.from(root.querySelectorAll("img")).map((image) => ({
        src: image.currentSrc || image.src,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight
      }));
      const canvases = Array.from(root.querySelectorAll("canvas")).map((canvas) => {
        const canvasRect = canvas.getBoundingClientRect();
        return {
          width: canvas.width,
          height: canvas.height,
          cssWidth: canvasRect.width,
          cssHeight: canvasRect.height
        };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        root: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scroll: {
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          bodyWidth: document.body.scrollWidth,
          bodyHeight: document.body.scrollHeight
        },
        images,
        canvases
      };
    });
    assert.ok(geometry, "Living Library root is missing");
    assert.ok(geometry.root.x <= 1 && geometry.root.y <= 1, `Living Library does not start at the viewport origin: ${JSON.stringify(geometry.root)}`);
    assert.ok(geometry.root.width >= geometry.viewport.width - 1 && geometry.root.height >= geometry.viewport.height - 1, `Living Library does not cover the viewport: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.scroll.documentWidth <= geometry.viewport.width + 1 && geometry.scroll.bodyWidth <= geometry.viewport.width + 1, `Living Library overflows horizontally: ${JSON.stringify(geometry.scroll)}`);
    assert.equal(geometry.images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), true, `Living Library contains undecoded images: ${JSON.stringify(geometry.images)}`);

    const screenshotPath = await screenshot(library, "library-render-evidence.png");
    const pixels = analyzeRenderedPng(readFileSync(screenshotPath));
    assert.ok(pixels.opaqueRatio >= 0.5, `Living Library screenshot has insufficient rendered coverage: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.distinctColorBuckets >= 16, `Living Library screenshot appears blank or uniform: ${JSON.stringify(pixels)}`);
    await library.locator("[data-testid='library-master-image']").evaluate((image) => image.decode());
    const sceneContract = await library.evaluate(() => {
      const scene = document.querySelector("[data-testid='library-master-scene']");
      const image = document.querySelector("[data-testid='library-master-image']");
      return {
        state: scene?.getAttribute("data-state") ?? null,
        imageDecoded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        hitIds: Array.from(document.querySelectorAll("[data-scene-hit]")).map((element) => element.getAttribute("data-scene-hit")).sort(),
        canvasCount: document.querySelectorAll("canvas").length
      };
    });
    assert.deepEqual(sceneContract, {
      state: "idle",
      imageDecoded: true,
      hitIds: ["letterbox", "shelf-diary", "shelf-goal", "shelf-other", "shelf-person", "shelf-reading", "shelf-thought", "theme-lamp", "typewriter"],
      canvasCount: 0
    }, `Living Library master scene contract is incomplete: ${JSON.stringify(sceneContract)}`);
    return { geometry, pixels, sceneContract };
  });

  await runCase("Capture declares drag region and preserves control hit targets", async () => {
    // Show the Capture window explicitly: earlier cases hide it, and Windows
    // occludes hidden renderers so CDP-driven clicks time out on invisible
    // elements. The case asserts control hit-targets on a visible surface.
    await electronApplication.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const surface = (window) => {
        try { return new URL(window.webContents.getURL()).searchParams.get("surface"); } catch { return null; }
      };
      windows.find((window) => surface(window) === "capture")?.show();
    });
    await waitForSurfaceVisibility("capture", true, 1_000);
    assert.equal(await appRegion(capture, ".capture-window header"), "drag");
    assert.equal(await appRegion(capture, ".capture-window header button"), "no-drag");
    const dragResult = await dragSurfaceFrom("capture", capture.locator(".capture-window header strong"), 28, 20);

    const stableBounds = (await surfaceState("capture")).bounds;
    await capture.getByRole("button", { name: "思考", exact: true }).click();
    assert.match(await capture.getByRole("button", { name: "思考", exact: true }).getAttribute("class"), /active/);
    assert.deepEqual((await surfaceState("capture")).bounds, stableBounds, "Capture mode control moved the window");

    await capture.getByRole("button", { name: "关闭", exact: true }).click();
    await waitForSurfaceVisibility("capture", false, 1_000);
    return { cdpNativeDragProbePixels: dragResult.distance, nativeDragRequiresPlatformAcceptance: true };
  });

  await runCase("Library controls are reachable and do not trigger window drag", async () => {
    assert.equal(await appRegion(library, ".scene-drag-region"), "drag");
    const sceneGeometry = await library.evaluate(() => {
      const root = document.querySelector("[data-testid='library-window']").getBoundingClientRect();
      const dragRegion = document.querySelector(".scene-drag-region").getBoundingClientRect();
      return { innerWidth, innerHeight, root: { x: root.x, y: root.y, width: root.width, height: root.height }, dragRegion: { x: dragRegion.x, y: dragRegion.y, right: dragRegion.right, bottom: dragRegion.bottom, width: dragRegion.width, height: dragRegion.height } };
    });
    report.diagnostics.sceneGeometry = sceneGeometry;
    const dragResult = await dragSurfaceFrom("library", library.locator(".scene-drag-region"), 24, 16);

    const stableBounds = (await surfaceState("library")).bounds;
    const search = await openSearch(library);
    await search.fill("control-hit-check");
    assert.equal(await search.inputValue(), "control-hit-check");
    assert.deepEqual((await surfaceState("library")).bounds, stableBounds, "Library search control moved the window");
    await search.fill("");
    assert.equal(await library.locator("[data-testid='scene-search-submit']").isDisabled(), true, "Blank search submit remained enabled");
    await search.press("Enter");
    assert.equal(await library.locator("[data-testid='reader-sheet']").count(), 0, "Blank search opened the recent-record reader");
    assert.equal(await search.isVisible(), true, "Blank search unexpectedly closed the search control");

    const settingsTrigger = library.locator("[data-testid='scene-settings']");
    await settingsTrigger.focus();
    await settingsTrigger.press("Enter");
    const settingsDialog = library.locator("[data-testid='settings-panel']");
    await settingsDialog.waitFor({ state: "visible" });
    assert.equal(await settingsDialog.getAttribute("role"), "dialog");
    assert.equal(await settingsDialog.getAttribute("aria-modal"), "true");
    assert.equal(await settingsDialog.evaluate((element) => element.contains(document.activeElement)), true, "Settings did not receive focus");
    await library.keyboard.press("Shift+Tab");
    assert.equal(await settingsDialog.evaluate((element) => element.contains(document.activeElement)), true, "Shift+Tab escaped the settings dialog");
    await library.keyboard.press("Tab");
    assert.equal(await settingsDialog.evaluate((element) => element.contains(document.activeElement)), true, "Tab escaped the settings dialog");
    assert.deepEqual((await surfaceState("library")).bounds, stableBounds, "Library settings control moved the window");
    await library.getByRole("button", { name: "关闭设置", exact: true }).click();
    await settingsDialog.waitFor({ state: "detached" });
    assert.equal(await library.evaluate(() => document.activeElement?.getAttribute("data-testid")), "scene-settings", "Settings did not restore focus to its trigger");

    const browseTrigger = library.locator("[data-testid='library-master-hit-letterbox']");
    await browseTrigger.focus();
    const sceneFocusStyle = await browseTrigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
    });
    assert.equal(sceneFocusStyle.outlineStyle, "solid", "Scene focus outline is not visible: " + JSON.stringify(sceneFocusStyle));
    assert.ok(Number.parseFloat(sceneFocusStyle.outlineWidth) >= 2, "Scene focus outline is too thin: " + JSON.stringify(sceneFocusStyle));
    assert.notEqual(sceneFocusStyle.outlineColor, "rgba(0, 0, 0, 0)", "Scene focus outline is transparent: " + JSON.stringify(sceneFocusStyle));
    await browseTrigger.press("Enter");
    const readerDialog = library.locator(".reader-sheet");
    await readerDialog.waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await readerDialog.getAttribute("role"), "dialog");
    assert.equal(await readerDialog.getAttribute("aria-modal"), "true");
    assert.equal(await readerDialog.evaluate((element) => element.contains(document.activeElement)), true, "Reader did not receive focus");
    await library.keyboard.press("Shift+Tab");
    assert.equal(await readerDialog.evaluate((element) => element.contains(document.activeElement)), true, "Shift+Tab escaped the reader dialog");
    await library.keyboard.press("Tab");
    assert.equal(await readerDialog.evaluate((element) => element.contains(document.activeElement)), true, "Tab escaped the reader dialog");
    await library.locator("[data-testid='reader-close']").click();
    await readerDialog.waitFor({ state: "detached" });
    assert.equal(await library.evaluate(() => document.activeElement?.getAttribute("data-testid")), "library-master-hit-letterbox", "Reader did not restore focus to its trigger");
    return { cdpNativeDragProbePixels: dragResult.distance, nativeDragRequiresPlatformAcceptance: true, modalFocusManaged: true };
  });

  await runCase("AI Provider profiles stay write-only and fit the settings panel", async () => {
    await library.locator("[data-testid='scene-settings']").evaluate((button) => button.click());
    const panel = library.locator("[data-testid='settings-panel']");
    await panel.waitFor({ state: "visible" });
    await library.locator("[data-testid='ai-providers-settings']").waitFor({ state: "visible" });

    const geometry = await panel.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewportWidth: innerWidth,
    }));
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `Provider settings overflow horizontally: ${JSON.stringify(geometry)}`);
    assert.equal(await library.locator("[data-testid='ai-provider-tab-direct']").getAttribute("class"), "active");

    const preset = library.locator("[data-testid='ai-provider-preset']");
    assert.equal(await preset.inputValue(), "openai", "OpenAI should be the default provider preset");
    assert.equal(await library.locator("[data-testid='ai-provider-advanced']").getAttribute("open"), null, "Known-provider technical fields should be collapsed");
    await preset.selectOption("custom");
    await library.locator("[data-testid='ai-provider-custom-fields']").waitFor({ state: "visible" });

    await library.locator("[data-testid='ai-provider-name']").fill("E2E Provider");
    await library.locator("[data-testid='ai-provider-provider-id']").fill("e2e-compatible");
    await library.locator("[data-testid='ai-provider-base-url']").fill("https://provider.invalid/v1");
    await library.locator("[data-testid='ai-provider-model']").fill("e2e-model");
    await library.locator("[data-testid='ai-provider-api-key']").fill("e2e-provider-write-only-secret");
    await library.locator("[data-testid='ai-provider-save']").click();
    await library.locator(".ai-provider-row", { hasText: "E2E Provider" }).waitFor({ state: "visible" });
    assert.equal(await library.locator("[data-testid='ai-provider-api-key']").inputValue(), "", "Provider credential remained in the Renderer input");

    const profilePath = path.join(userDataDirectory, "secrets", "ai-providers.v2.json");
    assert.equal(existsSync(profilePath), true, "Provider profile store was not created");
    assert.equal(readFileSync(profilePath, "utf8").includes("e2e-provider-write-only-secret"), false, "Provider credential was stored in plaintext");

    const row = library.locator(".ai-provider-row", { hasText: "E2E Provider" });
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("button", { name: "删除", exact: true }).waitFor({ state: "visible" });
    await screenshot(library, "settings-provider-direct.png");
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await row.getByRole("button", { name: "确认删除", exact: true }).click();
    await row.waitFor({ state: "detached" });

    await library.locator("[data-testid='ai-provider-tab-codex']").click();
    await library.locator("[data-testid='ai-provider-codex-profile']").waitFor({ state: "visible" });
    await library.locator("[data-testid='ai-provider-codex-home']").fill("~/.codex");
    await screenshot(library, "settings-provider-codex.png");
    await library.getByRole("button", { name: "关闭设置", exact: true }).click();
    return { ...geometry, encryptedProfileStore: true, directProfileDeleted: true, codexEditorVisible: true };
  });

  await runCase("Capture persists to SQLite and Library search opens detail", async () => {
    await pet.locator(".pet-window").click();
    await waitForSurfaceVisibility("capture", true, 1_200);
    const token = `wave4e2e${Date.now()}`;
    firstEntryToken = token;
    const rawText = `E2E 验收记忆 ${token}，用于验证 Capture、SQLite 与活书房闭环。`;
    await capture.getByRole("button", { name: "记住", exact: true }).click();
    await capture.locator("[data-testid='capture-input']").fill(rawText);
    await capture.locator("[data-testid='capture-submit']").click();
    await capture.locator("[data-testid='capture-status']").filter({ hasText: "已保存" }).waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await capture.locator("[data-testid='capture-input']").inputValue(), "", "Capture cleared state did not reach the input");
    await screenshot(capture, "capture-saved.png");

    const databasePath = path.join(userDataDirectory, "db", "paopao.sqlite");
    assert.equal(existsSync(databasePath), true, "Capture did not create the real SQLite database");
    const databaseBytes = statSync(databasePath).size;
    assert.ok(databaseBytes > 0, "SQLite database is empty");

    const search = await openSearch(library);
    await search.fill(token);
    await search.press("Enter");
    const entry = library.locator(".entry-row", { hasText: token }).first();
    await entry.waitFor({ state: "visible", timeout: 5_000 });
    assert.match(await entry.locator(".entry-title").innerText(), new RegExp(token), "Library row did not preserve the user record");
    await entry.click();
    const detail = library.locator("[data-testid='entry-detail']");
    await detail.locator(".current-record-text", { hasText: token }).waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await detail.getByText("记录内容", { exact: true }).count(), 1, "Accepted record heading is missing");
    assert.equal(await detail.getByText("最初记录", { exact: true }).count(), 0, "Unedited record exposed a redundant original section");
    assert.equal(await detail.getByText("记录入口：桌面端", { exact: true }).count(), 1, "Capture channel is not labeled as a record entry point");
    assert.equal(await detail.getByText("正文", { exact: true }).count(), 0, "Obsolete body terminology is still visible");
    assert.equal(await detail.getByText("纠正派生", { exact: true }).count(), 0, "Internal derivation terminology is still visible");
    await screenshot(library, "library-entry.png");
    return { token, databaseBytes, userRecordVisibleInList: true, recordSemanticsVisibleInDetail: true };
  });

  await runCase("reader transient state is scoped to one entry and closing clears search", async () => {
    await library.locator("[data-testid='reader-close']").click();
    const search = await openSearch(library);
    assert.equal(await search.inputValue(), "", "Closing the reader retained a hidden search draft");

    secondEntryToken = `wave4other${Date.now()}`;
    const secondRawText = `E2E 验收记忆 ${secondEntryToken}，用于验证记录状态隔离。`;
    await capture.locator("[data-testid='capture-input']").fill(secondRawText);
    await capture.locator("[data-testid='capture-submit']").click();
    await capture.locator("[data-testid='capture-status']").filter({ hasText: "已保存" }).waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await capture.locator("[data-testid='capture-input']").inputValue(), "", "Second Capture did not complete before Library verification");
    await library.waitForFunction(() => document.body.innerText.includes("共有 2 条记录"), undefined, { timeout: 5_000 });

    await search.fill("E2E 验收记忆");
    await search.press("Enter");
    const firstEntry = library.locator(".entry-row", { hasText: firstEntryToken });
    const secondEntry = library.locator(".entry-row", { hasText: secondEntryToken });
    await firstEntry.waitFor({ state: "visible", timeout: 5_000 });
    await secondEntry.waitFor({ state: "visible", timeout: 5_000 });

    await firstEntry.click();
    await library.getByRole("button", { name: "编辑记录内容", exact: true }).click();
    await library.getByRole("button", { name: "删除记录", exact: true }).click();
    assert.equal(await library.getByRole("button", { name: "确认删除记录", exact: true }).count(), 1, "First entry did not enter confirmation state");

    await secondEntry.click();
    await library.locator("[data-testid='entry-detail'] .current-record-text", { hasText: secondEntryToken }).waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await library.locator("[data-testid='revision-input']").count(), 0, "Edit state leaked into the second entry");
    assert.equal(await library.getByRole("button", { name: "删除记录", exact: true }).count(), 1, "Delete confirmation leaked into the second entry");
    assert.equal(await library.getByText("旧导出不会被删除", { exact: false }).count(), 0, "Delete export warning leaked into the second entry");

    await library.locator("[data-testid='reader-close']").click();
    assert.equal(await searchInputValue(library), "", "Closing a filtered reader retained the committed query draft");
    return { firstEntryToken, secondEntryToken, editStateIsolated: true, deleteConfirmationIsolated: true, searchCleared: true };
  });

  await runCase("backup restore publishes progress and refreshes Library without restart", async () => {
    await library.locator("[data-testid='scene-settings']").evaluate((button) => button.click());
    const dataManagement = library.locator("[data-testid='data-management']");
    const initialBackup = dataManagement.locator(".backup-row").first();
    await initialBackup.waitFor({ state: "visible", timeout: 5_000 });
    await initialBackup.getByRole("button", { name: "恢复", exact: true }).click();
    await dataManagement.getByText("再次点击确认恢复。恢复期间将暂停记录。", { exact: true }).waitFor({ state: "visible" });
    await initialBackup.getByRole("button", { name: "确认恢复", exact: true }).click();

    await dataManagement.locator(".operation-status", { hasText: "恢复完成" }).waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await dataManagement.getByText("再次点击确认恢复。恢复期间将暂停记录。", { exact: true }).count(), 0, "Restore confirmation remained after completion");
    await dataManagement.locator(".backup-row").nth(1).waitFor({ state: "visible", timeout: 5_000 });
    await capture.locator("[data-testid='capture-status']").filter({ hasText: "备份恢复完成。" }).waitFor({ state: "visible", timeout: 5_000 });

    await library.getByRole("button", { name: "关闭设置", exact: true }).click();
    await library.getByText("共有 0 条记录", { exact: true }).waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await searchInputValue(library), "", "Restore left a stale search query in the Library scene");
    assert.equal(await library.getByText(firstEntryToken, { exact: false }).count(), 0, "Restored Library still rendered the first removed entry");
    assert.equal(await library.getByText(secondEntryToken, { exact: false }).count(), 0, "Restored Library still rendered the second removed entry");
    return { progressPublished: true, captureResumed: true, libraryRefreshed: true, backupsRefreshed: true };
  });

  await runCase("Library recreates after its native window is closed", async () => {
    const closedPage = library;
    const pageClosed = closedPage.waitForEvent("close");
    const closedWindowId = await electronApplication.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => {
        try { return new URL(candidate.webContents.getURL()).searchParams.get("surface") === "library"; } catch { return false; }
      });
      if (!win) return null;
      const id = win.id;
      win.close();
      return id;
    });
    assert.ok(closedWindowId, "Library BrowserWindow was not available to close");
    await pageClosed;

    const reopenedPagePromise = electronApplication.waitForEvent("window");
    await pet.evaluate(() => window.paopao.windows.openLibrary());
    const reopenedPage = await reopenedPagePromise;
    observeSurface("library-reopened", reopenedPage);
    await reopenedPage.waitForLoadState("domcontentloaded");
    await reopenedPage.locator("[data-testid='library-window']").waitFor({ state: "visible", timeout: 5_000 });
    await reopenedPage.locator("[data-testid='library-master-image']").evaluate((image) => image.decode());
    await reopenedPage.waitForTimeout(300);
    library = reopenedPage;

    const reopenedState = await surfaceState("library");
    const reopenedWindowId = await electronApplication.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => {
        try { return new URL(candidate.webContents.getURL()).searchParams.get("surface") === "library"; } catch { return false; }
      });
      return win?.id ?? null;
    });
    assert.ok(reopenedWindowId, "Reopened Library BrowserWindow was not found");
    assert.notEqual(reopenedWindowId, closedWindowId, "Library reused a destroyed BrowserWindow");
    assert.equal(reopenedState.visible, true, "Recreated Library did not become visible");
    const screenshotPath = await screenshot(library, "library-reopened.png");
    const pixels = analyzeRenderedPng(readFileSync(screenshotPath));
    assert.ok(pixels.distinctColorBuckets >= 16, `Recreated Library did not render its scene: ${JSON.stringify(pixels)}`);
    return { closedWindowId, reopenedWindowId, visible: reopenedState.visible, pixels };
  });

  await runCase("Renderer and resource loading remain error-free", async () => {
    assert.deepEqual(rendererErrors, [], `Renderer errors: ${JSON.stringify(rendererErrors)}`);
    assert.deepEqual(resourceFailures, [], `Resource failures: ${JSON.stringify(resourceFailures)}`);
    return { rendererErrors, resourceFailures };
  });
}

async function runCase(name, action) {
  const record = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.cases.push(record);
  process.stdout.write(`E2E: ${name}\n`);
  const started = Date.now();
  try {
    record.evidence = await action();
    record.status = "PASS";
  } catch (error) {
    record.status = "FAIL";
    record.error = serializeError(error);
    throw error;
  } finally {
    record.durationMs = Date.now() - started;
    record.finishedAt = new Date().toISOString();
  }
}

async function waitForSurfaces(surfaceNames) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const pages = {};
    for (const page of electronApplication.windows()) {
      try {
        const surface = new URL(page.url()).searchParams.get("surface");
        if (surfaceNames.includes(surface)) pages[surface] = page;
      } catch {
        // A BrowserWindow can briefly expose about:blank while loadURL is pending.
      }
    }
    if (surfaceNames.every((surface) => pages[surface])) {
      await Promise.all(Object.values(pages).map((page) => page.waitForLoadState("domcontentloaded")));
      return pages;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for Electron surfaces: ${surfaceNames.join(", ")}`);
}

async function surfaceState(surface) {
  const state = await electronApplication.evaluate(async ({ BrowserWindow }, requestedSurface) => {
    const target = BrowserWindow.getAllWindows().find((window) => {
      try {
        return new URL(window.webContents.getURL()).searchParams.get("surface") === requestedSurface;
      } catch {
        return false;
      }
    });
    return target ? { visible: target.isVisible(), focused: target.isFocused(), bounds: target.getBounds() } : null;
  }, surface);
  assert.ok(state, `Electron surface not found: ${surface}`);
  return state;
}

async function setLibraryContentSize(width, height) {
  const result = await electronApplication.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => {
      try { return new URL(candidate.webContents.getURL()).searchParams.get("surface") === "library"; } catch { return false; }
    });
    if (!win) return null;
    win.setContentSize(size.width, size.height);
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { contentSize: win.getContentSize(), bounds: win.getBounds() };
  }, { width, height });
  assert.ok(result, "Library BrowserWindow not found");
  return result;
}

async function waitForSurfaceVisibility(surface, visible, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await surfaceState(surface)).visible === visible) return;
    await delay(20);
  }
  assert.equal((await surfaceState(surface)).visible, visible, `${surface} visibility did not become ${visible}`);
}

async function dragSurfaceFrom(surface, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  assert.ok(box, `No draggable bounding box for ${surface}`);
  const before = await surfaceState(surface);
  const x = box.x + Math.min(box.width / 2, 42);
  const y = box.y + box.height / 2;
  const page = locator.page();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 6 });
  await page.mouse.up();
  await delay(180);
  const after = await surfaceState(surface);
  return {
    before: before.bounds,
    after: after.bounds,
    distance: Math.abs(after.bounds.x - before.bounds.x) + Math.abs(after.bounds.y - before.bounds.y)
  };
}

async function appRegion(page, selector) {
  return page.locator(selector).evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"));
}

async function searchInputValue(page) {
  return (await openSearch(page)).inputValue();
}

async function openSearch(page) {
  const input = page.locator("[data-testid='scene-search-input']");
  if (await input.count() === 0) await page.locator("[data-testid='scene-search-toggle']").click();
  await input.waitFor({ state: "visible" });
  return input;
}

async function screenshot(page, filename, options = {}) {
  const target = path.join(resultDirectory, filename);
  await page.screenshot({ path: target, animations: "disabled", ...options });
  report.artifacts.push(filename);
  return target;
}

function analyzePetPng(buffer) {
  const png = PNG.sync.read(buffer);
  const cornerSize = Math.max(2, Math.min(8, Math.floor(Math.min(png.width, png.height) / 8)));
  let maxCornerAlpha = 0;
  let cornerAlphaTotal = 0;
  let cornerPixels = 0;
  let opaqueCornerPixels = 0;
  let nonTransparentPixels = 0;
  let boundaryPixels = 0;
  let darkBoundaryPixels = 0;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];
      const inCorner = (x < cornerSize || x >= png.width - cornerSize) && (y < cornerSize || y >= png.height - cornerSize);
      if (inCorner) {
        maxCornerAlpha = Math.max(maxCornerAlpha, alpha);
        cornerAlphaTotal += alpha;
        cornerPixels += 1;
        if (alpha >= 32) opaqueCornerPixels += 1;
      }
      if (alpha >= 16) nonTransparentPixels += 1;
      if (alpha < 32 || !hasTransparentNeighbor(png, x, y)) continue;
      boundaryPixels += 1;
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (luminance <= 20) darkBoundaryPixels += 1;
    }
  }

  return {
    width: png.width,
    height: png.height,
    maxCornerAlpha,
    meanCornerAlpha: Number((cornerAlphaTotal / cornerPixels).toFixed(2)),
    opaqueCornerRatio: Number((opaqueCornerPixels / cornerPixels).toFixed(4)),
    nonTransparentPixels,
    boundaryPixels,
    darkBoundaryPixels,
    darkEdgeRatio: boundaryPixels === 0 ? 0 : Number((darkBoundaryPixels / boundaryPixels).toFixed(4))
  };
}

function analyzeRenderedPng(buffer) {
  const png = PNG.sync.read(buffer);
  const buckets = new Set();
  let opaquePixels = 0;
  let sampledPixels = 0;
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const offset = (y * png.width + x) * 4;
      const alpha = png.data[offset + 3];
      sampledPixels += 1;
      if (alpha < 16) continue;
      opaquePixels += 1;
      buckets.add(`${png.data[offset] >> 4}:${png.data[offset + 1] >> 4}:${png.data[offset + 2] >> 4}:${alpha >> 4}`);
    }
  }
  return {
    width: png.width,
    height: png.height,
    sampledPixels,
    opaqueRatio: Number((opaquePixels / Math.max(1, sampledPixels)).toFixed(4)),
    distinctColorBuckets: buckets.size
  };
}

function hasTransparentNeighbor(png, x, y) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (neighborX < 0 || neighborY < 0 || neighborX >= png.width || neighborY >= png.height) continue;
      if (png.data[(neighborY * png.width + neighborX) * 4 + 3] < 16) return true;
    }
  }
  return false;
}

function startVite(port) {
  const vitePackage = require.resolve("vite/package.json", { paths: [desktopDirectory] });
  const viteCli = path.join(path.dirname(vitePackage), "bin", "vite.js");
  const child = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: desktopDirectory,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  captureProcessOutput(child, viteLog);
  return child;
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to reserve an E2E Vite port")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function captureProcessOutput(child, destination) {
  if (!child) return;
  child.stdout?.on("data", (chunk) => destination.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => destination.push(chunk.toString()));
}

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(probe, 100);
    };
    const probe = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      request.on("error", retry);
      request.setTimeout(1_000, () => request.destroy());
    };
    probe();
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDirectory,
      env: process.env,
      stdio: "inherit",
      // Windows cannot CreateProcess a .cmd/.bat directly; spawn through the
      // shell so npm.cmd resolves (spawn EINVAL otherwise).
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal || code})`));
    });
  });
}

async function closeElectron() {
  if (!electronApplication) return;
  try {
    await electronApplication.close();
  } catch (error) {
    electronLog.push(`[close:error] ${error.stack || error.message}\n`);
  }
  electronApplication = undefined;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => child.kill("SIGKILL"))
  ]);
}

function writeLog(filename, chunks) {
  const target = path.join(resultDirectory, filename);
  writeFileSync(target, chunks.join(""));
  report.artifacts.push(filename);
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, stack: error.stack };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
});
