import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const devServerUrl = "http://127.0.0.1:5173";
let petWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

app.whenReady().then(() => {
  createWindows();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleCapture);
  ipcMain.handle("capture:save", async (_event, input) => ({ archivedTo: classify(input.content), reply: input.askInsight ? "已记住。我看见这不是一句随手记，而是一条正在形成的主线。" : "已记住，泡泡会安静地替你整理。" }));
  ipcMain.handle("window:toggle-capture", toggleCapture);
  ipcMain.handle("window:hide-capture", () => captureWindow?.hide());
  ipcMain.handle("window:open-library", openLibrary);
});

app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());

function createWindows() {
  const preload = join(currentDir, "preload.js");
  petWindow = new BrowserWindow({ width: 112, height: 112, transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
  captureWindow = new BrowserWindow({ width: 430, height: 548, frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, skipTaskbar: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
  libraryWindow = new BrowserWindow({ width: 1440, height: 900, minWidth: 1180, minHeight: 720, show: false, backgroundColor: "#1a1511", title: "泡泡 · 活书房", webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
  loadSurface(petWindow, "pet");
  loadSurface(captureWindow, "capture");
  loadSurface(libraryWindow, "library");
  petWindow.once("ready-to-show", () => petWindow?.showInactive());
}

function loadSurface(window: BrowserWindow, surface: string) {
  if (app.isPackaged) window.loadFile(join(app.getAppPath(), "dist", "index.html"), { query: { surface } });
  else window.loadURL(`${devServerUrl}?surface=${surface}`);
}

function createTray() {
  tray = new Tray(join(app.getAppPath(), "public", "assets", "library-day.webp"));
  tray.setToolTip("泡泡正在替你记住");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "快速记录", click: toggleCapture }, { label: "打开活书房", click: openLibrary }, { type: "separator" }, { label: "退出泡泡", click: () => app.quit() }]));
}

function toggleCapture() {
  if (!captureWindow) return;
  captureWindow.isVisible() ? captureWindow.hide() : captureWindow.show();
}

function openLibrary() {
  libraryWindow?.show();
  libraryWindow?.focus();
}

function classify(value: string) {
  if (/目标|计划|截止|完成/.test(value)) return "目标";
  if (/书|文章|阅读|链接/.test(value)) return "阅读";
  if (/他|她|朋友|同事/.test(value)) return "人物";
  return "日记";
}
