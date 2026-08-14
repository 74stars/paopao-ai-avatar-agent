import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, Tray } from "electron";
import type { DomainEventV1 } from "@paopao/contracts";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isAllowedNavigation, resolveDevServerUrl } from "./navigation.js";
import { createDesktopApi, IPC_CHANNELS, registerPaopaoIpc } from "./ipc.js";
import { createMainComposition, resolveRuntimeResources } from "./composition.js";
import { createPetClickScheduler, createPetWindowDragController, isPetPrimaryMouseButton } from "./pet-gesture.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const devServerUrl = resolveDevServerUrl(process.env.PAOPAO_DEV_SERVER_URL);
const applicationName = "泡泡";
const applicationId = "com.paopao.desktop";
let petWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;
const libraryWindowsReady = new WeakSet<BrowserWindow>();
let tray: Tray | null = null;
let composition: Awaited<ReturnType<typeof bootstrap>> | null = null;
let quitting = false;
let latestFeishuStatus: Extract<DomainEventV1, { type: "feishu:status" }> | null = null;
const petClickScheduler = createPetClickScheduler({
  onSingle: toggleCapture,
  onDouble: openLibrary
});
const petDrag = createPetWindowDragController();
const handleSystemResume = () => { void composition?.checkConnectionAfterWake().catch(() => undefined); };

app.whenReady().then(startApplication).catch(handleStartupFailure);

async function startApplication() {
  configureApplicationIdentity();
  setApplicationIcon();
  composition = await bootstrap();
  await composition.start();
  registerPaopaoIpc(ipcMain, createDesktopApi(composition.services));
  createWindows();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleCapture);
  registerWindowIpc();
  powerMonitor.on("resume", handleSystemResume);
}

function configureApplicationIdentity() {
  app.setName(applicationName);
  if (process.platform === "win32") app.setAppUserModelId(applicationId);
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
  petClickScheduler.cancel();
  petDrag.cancel();
  petClickScheduler.dispose();
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
  const icon = getRendererAssetPath("app-icon.png");
  petWindow = new BrowserWindow({ width: 112, height: 112, transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, acceptFirstMouse: true, icon, webPreferences: secureWebPreferences(preload) });
  captureWindow = new BrowserWindow({ width: 430, height: 548, frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, skipTaskbar: true, icon, webPreferences: secureWebPreferences(preload) });
  captureWindow.on("show", () => broadcastCaptureVisibility(true));
  captureWindow.on("hide", () => broadcastCaptureVisibility(false));
  loadSurface(petWindow, "pet");
  loadSurface(captureWindow, "capture");
  createLibraryWindow(false);
  attachLatestStatusReplay(petWindow);
  attachLatestStatusReplay(captureWindow);
  registerPetMouseEvents(petWindow);
  petWindow.once("ready-to-show", () => petWindow?.showInactive());
}

function registerPetMouseEvents(window: BrowserWindow) {
  window.on("blur", () => {
    petDrag.cancel();
  });
  window.webContents.on("before-mouse-event", (event, mouse) => {
    if (!isPetPrimaryMouseButton(mouse.button)) return;
    const point = resolveGlobalMousePoint(window, mouse);
    if (!point) {
      petDrag.cancel();
      return;
    }

    if (mouse.type === "mouseDown") {
      const [windowX, windowY] = window.getPosition();
      petDrag.pointerDown(point.x, point.y, windowX, windowY);
      return;
    }

    if (mouse.type === "mouseMove") {
      const target = petDrag.pointerMove(point.x, point.y);
      if (!target) return;
      petClickScheduler.cancel();
      window.setPosition(target.x, target.y, false);
      return;
    }

    if (mouse.type === "mouseUp") {
      if (petDrag.pointerUp(point.x, point.y) === "click") petClickScheduler.click();
    }
  });
}

function resolveGlobalMousePoint(window: BrowserWindow, mouse: Electron.MouseInputEvent): { x: number; y: number } | null {
  if (Number.isFinite(mouse.globalX) && Number.isFinite(mouse.globalY)) {
    return { x: mouse.globalX as number, y: mouse.globalY as number };
  }

  const [windowX, windowY] = window.getPosition();
  const x = windowX + mouse.x;
  const y = windowY + mouse.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function createLibraryWindow(showWhenReady: boolean): BrowserWindow {
  const preload = join(currentDir, "preload.cjs");
  const window = new BrowserWindow({ width: 1440, height: 900, minWidth: 1180, minHeight: 720, show: false, backgroundColor: "#1a1511", title: "泡泡 · 活书房", icon: getRendererAssetPath("app-icon.png"), webPreferences: secureWebPreferences(preload) });
  libraryWindow = window;
  window.once("closed", () => {
    if (libraryWindow === window) libraryWindow = null;
  });
  window.once("ready-to-show", () => {
    libraryWindowsReady.add(window);
    if (showWhenReady) showLibraryWindowWhenReady(window);
  });
  attachLatestStatusReplay(window);
  loadSurface(window, "library");
  return window;
}

function attachLatestStatusReplay(window: BrowserWindow) {
  window.webContents.on("did-finish-load", () => {
    if (window.isDestroyed()) return;
    if (latestFeishuStatus) window.webContents.send(IPC_CHANNELS.domainEvent, latestFeishuStatus);
    window.webContents.send(IPC_CHANNELS.windowCaptureVisibilityChanged, captureWindow?.isVisible() ?? false);
  });
}

function broadcastCaptureVisibility(visible: boolean) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (isWindowDestroyed(window) || window.webContents.isDestroyed()) continue;
    window.webContents.send(IPC_CHANNELS.windowCaptureVisibilityChanged, visible);
  }
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
  const icon = nativeImage.createFromPath(getTrayIconPath());
  if (icon.isEmpty()) throw new Error("TRAY_ICON_MISSING");
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("泡泡");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "快速记录", click: toggleCapture }, { label: "打开活书房", click: openLibrary }, { type: "separator" }, { label: "退出泡泡", click: () => app.quit() }]));
}

function getTrayIconPath() {
  const filename = process.platform === "darwin"
    ? "trayTemplate.png"
    : process.platform === "win32"
      ? "tray.ico"
      : "tray.png";
  return getRendererAssetPath(filename);
}

function setApplicationIcon() {
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(getRendererAssetPath("app-icon.png"));
}

function getRendererAssetPath(filename: string) {
  return app.isPackaged
    ? join(app.getAppPath(), "dist", "assets", filename)
    : join(app.getAppPath(), "public", "assets", filename);
}

function getRendererEntryPath() {
  return join(app.getAppPath(), "dist", "index.html");
}

function toggleCapture() {
  if (!captureWindow) return;
  captureWindow.isVisible() ? captureWindow.hide() : captureWindow.show();
}

function openLibrary() {
  if (!libraryWindow || isWindowDestroyed(libraryWindow)) {
    createLibraryWindow(true);
    return;
  }
  showLibraryWindow(libraryWindow);
}

function isWindowDestroyed(window: BrowserWindow): boolean {
  try {
    return window.isDestroyed();
  } catch {
    return true;
  }
}

function showLibraryWindow(window: BrowserWindow) {
  try {
    if (window.isDestroyed()) {
      if (libraryWindow === window) libraryWindow = null;
      createLibraryWindow(true);
      return;
    }
    // Wait for the renderer's first paint before revealing the window, so opening
    // the library never flashes the dark backgroundColor (#1a1511) as a blank frame.
    if (libraryWindowsReady.has(window)) {
      window.show();
      window.focus();
    } else {
      window.once("ready-to-show", () => showLibraryWindowWhenReady(window));
    }
  } catch {
    if (libraryWindow === window) libraryWindow = null;
    createLibraryWindow(true);
  }
}

function showLibraryWindowWhenReady(window: BrowserWindow) {
  try {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
  } catch {
    if (libraryWindow === window) libraryWindow = null;
  }
}
