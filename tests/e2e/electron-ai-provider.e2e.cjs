"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
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
const resultDirectory = path.join(rootDirectory, "test-results", "e2e-ai-provider", runId);
const userDataDirectory = mkdtempSync(path.join(os.tmpdir(), "paopao-ai-provider-e2e-"));
const logs = [];
const report = { schemaVersion: 1, runId, startedAt: new Date().toISOString(), result: "RUNNING", checks: {}, artifacts: [] };
let electronApplication;
let viteProcess;
let electronAbiPrepared = false;

mkdirSync(resultDirectory, { recursive: true });

async function main() {
  let activeError;
  try {
    await runCommand(npmCommand, ["run", "build"]);
    await runCommand(npmCommand, ["run", "rebuild:native"]);
    electronAbiPrepared = true;
    await runProviderE2E();
    report.result = "PASS";
  } catch (error) {
    activeError = error;
    report.result = "FAIL";
    report.error = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    await closeElectron();
    await stopProcess(viteProcess);
    rmSync(userDataDirectory, { recursive: true, force: true });
    if (electronAbiPrepared) {
      try {
        await runCommand(npmCommand, ["run", "rebuild:native:node"]);
        report.nodeAbiRestored = true;
      } catch (error) {
        report.result = "FAIL";
        report.nodeAbiRestored = false;
        activeError ??= error;
        process.exitCode = 1;
      }
    }
    report.finishedAt = new Date().toISOString();
    writeFileSync(path.join(resultDirectory, "electron.log"), logs.join(""));
    const reportPath = path.join(resultDirectory, "report.json");
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`AI Provider E2E ${report.result}: ${path.relative(rootDirectory, reportPath)}\n`);
  }
  if (activeError) throw activeError;
}

async function runProviderE2E() {
  const port = await getAvailablePort();
  const viteUrl = `http://127.0.0.1:${port}`;
  viteProcess = startVite(port);
  await waitForHttp(viteUrl, 20_000);

  electronApplication = await electron.launch({
    executablePath: require("electron"),
    args: [desktopDirectory, `--user-data-dir=${userDataDirectory}`],
    cwd: rootDirectory,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true", PAOPAO_DEV_SERVER_URL: viteUrl },
    timeout: 30_000,
  });
  captureOutput(electronApplication.process());
  const library = await waitForLibraryPage();
  library.on("console", (message) => logs.push(`[renderer:${message.type()}] ${message.text()}\n`));
  library.on("pageerror", (error) => logs.push(`[renderer:error] ${error.stack || error.message}\n`));

  await electronApplication.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("surface=library"));
    if (!win) throw new Error("Library window not found");
    win.setContentSize(1180, 720);
    win.show();
  });
  await library.locator("[data-testid='library-window']").waitFor({ state: "visible" });
  await library.waitForTimeout(500);

  await library.locator("[data-testid='library-master-image']").evaluate((image) => image.decode());
  const scenePath = await screenshot(library, "library-scene.png");
  const scenePixels = analyzeCanvas(readFileSync(scenePath));
  assert.ok(scenePixels.nonTransparentPixels > 10_000, "Library scene is blank");
  assert.ok(scenePixels.luminanceRange > 20, "Library scene is blank or nearly uniform");
  report.checks.scene = scenePixels;

  await library.locator("[data-testid='scene-settings']").evaluate((button) => button.click());
  const panel = library.locator("[data-testid='settings-panel']");
  await panel.waitFor({ state: "visible" });
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, left: rect.left, right: rect.right, viewportWidth: innerWidth };
  });
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `Settings panel overflows horizontally: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewportWidth + 1, `Settings panel is outside the viewport: ${JSON.stringify(geometry)}`);

  const preset = library.locator("[data-testid='ai-provider-preset']");
  assert.equal(await preset.inputValue(), "openai", "OpenAI should be the default provider preset");
  assert.equal(await library.locator("[data-testid='ai-provider-advanced']").getAttribute("open"), null, "Known-provider technical fields should be collapsed");
  await preset.selectOption("local");
  assert.equal(await library.locator("[data-testid='ai-provider-api-key']").count(), 0, "Local preset should not request an API key");
  await preset.selectOption("custom");
  await library.locator("[data-testid='ai-provider-custom-fields']").waitFor({ state: "visible" });
  await preset.selectOption("openai");
  await library.locator("[data-testid='ai-provider-api-key']").waitFor({ state: "visible" });

  await library.locator("[data-testid='ai-provider-name']").fill("E2E Provider");
  await library.locator("[data-testid='ai-provider-model']").fill("e2e-model");
  await library.locator("[data-testid='ai-provider-api-key']").fill("e2e-provider-write-only-secret");
  await library.locator("[data-testid='ai-provider-save']").click();
  const row = library.locator(".ai-provider-row", { hasText: "E2E Provider" });
  await row.waitFor({ state: "visible" });
  assert.equal(await library.locator("[data-testid='ai-provider-api-key']").inputValue(), "", "Credential remained in the Renderer input");
  assert.equal(await row.locator(".ai-provider-badge").textContent(), "当前使用 · 可用");

  const profilePath = path.join(userDataDirectory, "secrets", "ai-providers.v2.json");
  assert.equal(existsSync(profilePath), true, "Encrypted Provider profile store was not created");
  assert.equal(readFileSync(profilePath, "utf8").includes("e2e-provider-write-only-secret"), false, "Provider credential was stored in plaintext");
  await panel.evaluate((element) => { element.scrollTop = 0; });
  await screenshot(library, "settings-provider-direct.png");

  const advanced = library.locator("[data-testid='ai-provider-advanced']");
  await advanced.locator("summary").click();
  await library.locator("[data-testid='ai-provider-timeout']").fill("90000");
  await library.locator("[data-testid='ai-provider-save']").click();
  assert.equal(await row.locator(".ai-provider-badge").textContent(), "当前使用 · 可用");

  const editor = library.locator("[data-testid='ai-provider-editor']");
  await editor.getByRole("button", { name: "取消编辑", exact: true }).click();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  assert.equal(await preset.inputValue(), "custom", "Modified preset should reopen as Custom");
  await library.locator("[data-testid='ai-provider-custom-fields']").waitFor({ state: "visible" });
  assert.equal(await library.locator("[data-testid='ai-provider-provider-id']").inputValue(), "openai");
  assert.equal(await library.locator("[data-testid='ai-provider-protocol']").inputValue(), "openai_responses");
  assert.equal(await library.locator("[data-testid='ai-provider-base-url']").inputValue(), "https://api.openai.com/v1");
  assert.equal(await library.locator("[data-testid='ai-provider-auth-mode']").inputValue(), "bearer");
  assert.equal(await library.locator("[data-testid='ai-provider-structured-output']").inputValue(), "json_schema");
  assert.equal(await library.locator("[data-testid='ai-provider-timeout']").inputValue(), "90000");
  assert.equal(await library.locator("[data-testid='ai-provider-model']").inputValue(), "e2e-model");
  await library.locator("[data-testid='ai-provider-save']").click();
  assert.equal(await row.locator(".ai-provider-badge").textContent(), "当前使用 · 可用");
  const storedOpenAi = JSON.parse(readFileSync(profilePath, "utf8")).profiles.find((profile) => profile.name === "E2E Provider");
  assert.equal(storedOpenAi.timeoutMs, 90_000, "Advanced timeout did not round-trip");
  await screenshot(library, "settings-provider-custom-reopen.png");

  await row.getByRole("button", { name: "删除", exact: true }).click();
  await row.getByRole("button", { name: "确认删除", exact: true }).click();
  await row.waitFor({ state: "detached" });

  await preset.selectOption("local");
  await library.locator("[data-testid='ai-provider-name']").fill("E2E Local");
  await library.locator("[data-testid='ai-provider-model']").fill("local-model");
  assert.equal(await library.locator("[data-testid='ai-provider-api-key']").count(), 0, "Local preset should stay keyless when saved");
  await library.locator("[data-testid='ai-provider-save']").click();
  const localRow = library.locator(".ai-provider-row", { hasText: "E2E Local" });
  await localRow.waitFor({ state: "visible" });
  assert.equal(await localRow.locator(".ai-provider-badge").textContent(), "当前使用 · 可用");
  const storedLocal = JSON.parse(readFileSync(profilePath, "utf8")).profiles.find((profile) => profile.name === "E2E Local");
  assert.equal(storedLocal.authMode, "none");
  assert.equal(storedLocal.baseUrl, "http://127.0.0.1:11434/v1");
  await localRow.getByRole("button", { name: "删除", exact: true }).click();
  await localRow.getByRole("button", { name: "确认删除", exact: true }).click();
  await localRow.waitFor({ state: "detached" });

  await library.locator("[data-testid='ai-provider-tab-codex']").click();
  await library.locator("[data-testid='ai-provider-codex-home']").fill("~/.codex");
  await library.locator("[data-testid='ai-provider-codex-profile']").fill("work-profile");
  await library.locator("[data-testid='ai-provider-codex-home']").scrollIntoViewIfNeeded();
  await screenshot(library, "settings-provider-codex.png");

  report.checks.settings = { ...geometry, knownCompactSaved: true, advancedRoundTrip: true, modifiedProfileReopenedAsCustom: true, localSavedWithoutKey: true, credentialInputCleared: true, encryptedAtRest: true, deletedActiveProfile: true, codexEditorVisible: true };
  const rendererErrors = logs.filter((line) => line.includes("[renderer:error]"));
  assert.deepEqual(rendererErrors, [], `Renderer errors occurred: ${rendererErrors.join("\n")}`);
}

async function waitForLibraryPage() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const page = electronApplication.windows().find((candidate) => candidate.url().includes("surface=library"));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the Library page");
}

async function screenshot(target, filename) {
  const destination = path.join(resultDirectory, filename);
  await target.screenshot({ path: destination, animations: "disabled" });
  report.artifacts.push(filename);
  return destination;
}

function analyzeCanvas(buffer) {
  const png = PNG.sync.read(buffer);
  let nonTransparentPixels = 0;
  let minLuminance = 255;
  let maxLuminance = 0;
  for (let offset = 0; offset < png.data.length; offset += 4) {
    if (png.data[offset + 3] < 16) continue;
    nonTransparentPixels += 1;
    const luminance = png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
    minLuminance = Math.min(minLuminance, luminance);
    maxLuminance = Math.max(maxLuminance, luminance);
  }
  return { width: png.width, height: png.height, nonTransparentPixels, luminanceRange: Number((maxLuminance - minLuminance).toFixed(2)) };
}

function startVite(port) {
  const packagePath = require.resolve("vite/package.json", { paths: [desktopDirectory] });
  const cliPath = path.join(path.dirname(packagePath), "bin", "vite.js");
  const child = spawn(process.execPath, [cliPath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: desktopDirectory,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  captureOutput(child);
  return child;
}

function captureOutput(child) {
  child?.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
  child?.stderr?.on("data", (chunk) => logs.push(chunk.toString()));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return server.close(() => reject(new Error("Unable to reserve a Vite port")));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (Date.now() >= deadline) return reject(new Error(`Timed out waiting for ${url}`));
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else setTimeout(probe, 100);
      });
      request.on("error", () => setTimeout(probe, 100));
      request.setTimeout(1_000, () => request.destroy());
    };
    probe();
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDirectory, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed (${signal || code})`)));
  });
}

async function closeElectron() {
  if (!electronApplication) return;
  try { await electronApplication.close(); } catch (error) { logs.push(`[close:error] ${error.stack || error.message}\n`); }
  electronApplication = undefined;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)).then(() => child.kill("SIGKILL")),
  ]);
}

void main();
