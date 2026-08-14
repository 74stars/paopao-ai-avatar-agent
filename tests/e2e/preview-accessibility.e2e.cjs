"use strict";

const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const rootDirectory = path.resolve(__dirname, "../..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const resultDirectory = path.join(rootDirectory, "test-results", "preview-accessibility", runId);
const report = {
  schemaVersion: 1,
  scope: "preview-accessibility",
  runId,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  result: "RUNNING",
  cases: [],
  artifacts: []
};

mkdirSync(resultDirectory, { recursive: true });
let electronApplication;

async function check(name, run) {
  await run();
  report.cases.push({ name, result: "PASS" });
}

async function main() {
  const pageErrors = [];
  try {
    electronApplication = await electron.launch({
      args: [path.join(__dirname, "fixtures", "preview-host.cjs")],
      env: {
        ...process.env,
        PAOPAO_PREVIEW_FILE: path.join(rootDirectory, "preview", "index.html")
      }
    });
    const page = await electronApplication.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.waitForSelector("#library");

    await check("closed dialogs are inert and hidden from accessibility APIs", async () => {
      const state = await page.evaluate(() => ({
        captureRole: document.querySelector("#capturePanel").getAttribute("role"),
        captureHidden: document.querySelector("#capturePanel").getAttribute("aria-hidden"),
        captureInert: document.querySelector("#capturePanel").inert,
        readerRole: document.querySelector("#readerBackdrop .reader").getAttribute("role"),
        readerHidden: document.querySelector("#readerBackdrop").getAttribute("aria-hidden"),
        readerInert: document.querySelector("#readerBackdrop").inert
      }));
      assert.deepEqual(state, {
        captureRole: "dialog",
        captureHidden: "true",
        captureInert: true,
        readerRole: "dialog",
        readerHidden: "true",
        readerInert: true
      });
    });

    await check("capture dialog focuses input, traps Tab, closes with Escape, and restores focus", async () => {
      await page.focus("#bubbleButton");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "captureInput");
      assert.equal(await page.getAttribute("#capturePanel", "aria-hidden"), "false");
      assert.equal(await page.evaluate(() => document.querySelector("#capturePanel").inert), false);

      await page.focus("#saveMemory");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "closeCapture");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "saveMemory");

      await page.keyboard.press("Escape");
      assert.equal(await page.getAttribute("#capturePanel", "aria-hidden"), "true");
      assert.equal(await page.evaluate(() => document.querySelector("#capturePanel").inert), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "bubbleButton");
    });

    await check("reader dialog traps focus, closes with Escape, and restores focus", async () => {
      await page.click("#openToday");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "closeReader");
      assert.equal(await page.getAttribute("#readerBackdrop", "aria-hidden"), "false");

      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.closest("#readerIndex")?.id), "readerIndex");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "closeReader");

      await page.keyboard.press("Escape");
      assert.equal(await page.getAttribute("#readerBackdrop", "aria-hidden"), "true");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "openToday");
    });

    await check("reader backdrop closes the dialog and restores its opener", async () => {
      await page.click("#openReport");
      await page.dispatchEvent("#readerBackdrop", "mousedown");
      assert.equal(await page.getAttribute("#readerBackdrop", "aria-hidden"), "true");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "openReport");
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopScreenshot = path.join(resultDirectory, "preview-desktop.png");
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    report.artifacts.push(path.relative(rootDirectory, desktopScreenshot));

    await check("mobile fallback remains readable without horizontal overflow", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const metrics = await page.evaluate(() => ({
        visible: getComputedStyle(document.querySelector(".mobile-preview")).display !== "none",
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      assert.equal(metrics.visible, true);
      assert.ok(metrics.scrollWidth <= metrics.innerWidth, JSON.stringify(metrics));
    });
    const mobileScreenshot = path.join(resultDirectory, "preview-mobile.png");
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    report.artifacts.push(path.relative(rootDirectory, mobileScreenshot));

    assert.deepEqual(pageErrors, []);
    report.result = "PASS";
  } catch (error) {
    report.result = "FAIL";
    report.error = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    if (electronApplication) await electronApplication.close();
    report.pageErrors = pageErrors;
    report.finishedAt = new Date().toISOString();
    const reportPath = path.join(resultDirectory, "report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write("Preview accessibility E2E " + report.result + ": " + path.relative(rootDirectory, reportPath) + "\n");
  }
}

void main();
