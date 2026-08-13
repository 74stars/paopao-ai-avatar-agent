import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, powerMonitor, safeStorage, Tray } from "electron";
import type { DomainEventV1 } from "@paopao/contracts";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isAllowedNavigation, resolveDevServerUrl } from "./navigation.js";
import { createDesktopApi, IPC_CHANNELS, registerPaopaoIpc } from "./ipc.js";
import { createMainComposition, resolveRuntimeResources } from "./composition.js";
import { moveWindowBy } from "./window-movement.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const devServerUrl = resolveDevServerUrl(process.env.PAOPAO_DEV_SERVER_URL);
let petWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let composition: Awaited<ReturnType<typeof bootstrap>> | null = null;
let quitting = false;
let latestFeishuStatus: Extract<DomainEventV1, { type: "feishu:status" }> | null = null;
const handleSystemResume = () => { void composition?.checkConnectionAfterWake().catch(() => undefined); };

app.whenReady().then(startApplication).catch(handleStartupFailure);

async function startApplication() {
  composition = await bootstrap();
  await composition.start();
  registerPaopaoIpc(ipcMain, createDesktopApi(composition.services));
  createWindows();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleCapture);
  registerWindowIpc();
  powerMonitor.on("resume", handleSystemResume);
}

function handleStartupFailure(error: unknown) {
  const correlationId = randomUUID();
  console.error("Paopao startup failed", { code: startupFailureCode(error), correlationId });
  dialog.showErrorBox("泡泡未能启动", "泡泡这次没有正常打开。请完全退出后重新启动。");
  app.quit();
}

function startupFailureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : "STARTUP_FAILED";
}

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    const allowed = isAllowedNavigation(url, {
      packaged: app.isPackaged,
      devServerUrl,
      packagedEntryPath: getRendererEntryPath()
    });
    if (!allowed) event.preventDefault();
  });
});

app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
  globalShortcut.unregisterAll();
  powerMonitor.removeListener("resume", handleSystemResume);
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  const closing = composition?.close() ?? Promise.resolve();
  void closing.finally(() => app.quit());
});

function registerWindowIpc() {
  ipcMain.handle(IPC_CHANNELS.windowToggleCapture, toggleCapture);
  ipcMain.handle(IPC_CHANNELS.windowHideCapture, () => captureWindow?.hide());
  ipcMain.handle(IPC_CHANNELS.windowOpenLibrary, openLibrary);
  ipcMain.handle(IPC_CHANNELS.windowMoveBy, (event, rawInput) => {
    moveWindowBy(rawInput, BrowserWindow.fromWebContents(event.sender));
  });
}

async function bootstrap() {
  const resources = resolveRuntimeResources(app.getAppPath(), app.isPackaged, process.resourcesPath);
  const databasePath = join(app.getPath("userData"), "db", "paopao.sqlite");
  const publisher = { publish: (event: DomainEventV1) => {
    if (event.type === "feishu:status") latestFeishuStatus = event;
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.domainEvent, event);
  } };
  const result = await createMainComposition({
    databasePath,
    migrationsDirectory: resources.migrationsDirectory,
    promptsDirectory: resources.promptsDirectory,
    credentialsPath: join(app.getPath("userData"), "secrets", "credentials.v1.json"),
    safeStorage,
    publish: publisher,
  });
  return result;
}

function createWindows() {
  const preload = join(currentDir, "preload.cjs");
  petWindow = new BrowserWindow({ width: 112, height: 112, transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, webPreferences: secureWebPreferences(preload) });
  captureWindow = new BrowserWindow({ width: 430, height: 548, frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, skipTaskbar: true, webPreferences: secureWebPreferences(preload) });
  loadSurface(petWindow, "pet");
  loadSurface(captureWindow, "capture");
  createLibraryWindow(false);
  attachLatestStatusReplay(petWindow);
  attachLatestStatusReplay(captureWindow);
  petWindow.once("ready-to-show", () => petWindow?.showInactive());
}

function createLibraryWindow(showWhenReady: boolean): BrowserWindow {
  const preload = join(currentDir, "preload.cjs");
  const window = new BrowserWindow({ width: 1440, height: 900, minWidth: 1180, minHeight: 720, show: false, backgroundColor: "#1a1511", title: "泡泡 · 活书房", webPreferences: secureWebPreferences(preload) });
  libraryWindow = window;
  window.once("closed", () => {
    if (libraryWindow === window) libraryWindow = null;
  });
  if (showWhenReady) {
    window.once("ready-to-show", () => {
      if (window.isDestroyed()) return;
      window.show();
      window.focus();
    });
  }
  attachLatestStatusReplay(window);
  loadSurface(window, "library");
  return window;
}

function attachLatestStatusReplay(window: BrowserWindow) {
  window.webContents.on("did-finish-load", () => {
    if (latestFeishuStatus && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.domainEvent, latestFeishuStatus);
  });
}

function secureWebPreferences(preload: string) {
  return {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    webSecurity: true
  } as const;
}

function loadSurface(window: BrowserWindow, surface: string) {
  if (app.isPackaged) window.loadFile(getRendererEntryPath(), { query: { surface } });
  else window.loadURL(`${devServerUrl}?surface=${surface}`);
}

function createTray() {
  tray = new Tray(getTrayIconPath());
  tray.setToolTip("泡泡正在替你记住");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "快速记录", click: toggleCapture }, { label: "打开活书房", click: openLibrary }, { type: "separator" }, { label: "退出泡泡", click: () => app.quit() }]));
}

function getTrayIconPath() {
  return app.isPackaged
    ? join(app.getAppPath(), "dist", "assets", "tray.png")
    : join(app.getAppPath(), "public", "assets", "tray.png");
}

function getRendererEntryPath() {
  return join(app.getAppPath(), "dist", "index.html");
}

function toggleCapture() {
  if (!captureWindow) return;
  captureWindow.isVisible() ? captureWindow.hide() : captureWindow.show();
}

function openLibrary() {
  if (!libraryWindow || libraryWindow.isDestroyed()) {
    createLibraryWindow(true);
    return;
  }
  libraryWindow.show();
  libraryWindow.focus();
}
