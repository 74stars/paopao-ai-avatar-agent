"use strict";

const { app, BrowserWindow, Menu } = require("electron");

const previewFile = process.env.PAOPAO_PREVIEW_FILE;
if (!previewFile) throw new Error("PAOPAO_PREVIEW_FILE is required");

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadFile(previewFile);
  window.focus();
});

app.on("window-all-closed", () => app.quit());
