const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const preloadPath = join(__dirname, "..", "desktop-app", "dist-electron", "preload.cjs");
const timeout = setTimeout(() => {
  console.error("Sandbox preload smoke timed out");
  app.exit(1);
}, 20_000);

async function run() {
  assert.equal(existsSync(preloadPath), true, `Missing preload artifact: ${preloadPath}`);
  await app.whenReady();

  const { IPC_CHANNELS } = await import("../desktop-app/dist-electron/preload-shared/ipc-channels.js");
  let invocationCount = 0;
  ipcMain.handle(IPC_CHANNELS.settingsGetPublic, (_event, input) => {
    invocationCount += 1;
    assert.deepEqual(input, { version: 1 });
    return {
      ok: true,
      data: {
        ai: { configured: false, provider: null, model: null },
        feishu: {
          configured: false,
          appIdMasked: null,
          status: "not_configured",
          bound: false,
          replyMode: "ack_only",
          deliveryIssueCount: 0
        },
        data: { databasePath: "/synthetic/paopao.sqlite", lastBackupAt: null }
      }
    };
  });

  const preloadErrors = [];
  const browserWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true
    }
  });
  browserWindow.webContents.on("preload-error", (_event, failedPath, error) => {
    preloadErrors.push(`${failedPath}: ${error?.stack ?? error}`);
  });

  try {
    await browserWindow.loadURL("data:text/html;charset=utf-8,<title>Paopao preload smoke</title>");
    const rendererState = await browserWindow.webContents.executeJavaScript(`
      (async () => ({
        bridgeType: typeof window.paopao,
        requireType: typeof globalThis.require,
        processType: typeof globalThis.process,
        ipcRendererType: typeof globalThis.ipcRenderer,
        status: await window.paopao.settings.getPublic({ version: 1 }),
        invalidStatus: await window.paopao.settings.getPublic({ version: 2 })
      }))()
    `);
    const preferences = browserWindow.webContents.getLastWebPreferences();

    assert.deepEqual(preloadErrors, []);
    assert.equal(rendererState.bridgeType, "object");
    assert.equal(rendererState.requireType, "undefined");
    assert.equal(rendererState.processType, "undefined");
    assert.equal(rendererState.ipcRendererType, "undefined");
    assert.deepEqual(rendererState.status, {
      ok: true,
      data: {
        ai: { configured: false, provider: null, model: null },
        feishu: {
          configured: false,
          appIdMasked: null,
          status: "not_configured",
          bound: false,
          replyMode: "ack_only",
          deliveryIssueCount: 0
        },
        data: { databasePath: "/synthetic/paopao.sqlite", lastBackupAt: null }
      }
    });
    assert.equal(rendererState.invalidStatus.ok, false);
    assert.equal(rendererState.invalidStatus.error.code, "VALIDATION_FAILED");
    assert.match(rendererState.invalidStatus.error.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(invocationCount, 1);
    console.log(`Effective webPreferences: ${JSON.stringify(preferences)}`);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.webviewTag, false);
    assert.equal(preferences.webSecurity, true);
    console.log("Sandbox preload runtime smoke passed (bridge, typed IPC, isolation, preferences)");
  } finally {
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
    ipcMain.removeHandler(IPC_CHANNELS.settingsGetPublic);
  }
}

run().then(() => {
  clearTimeout(timeout);
  app.quit();
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});
