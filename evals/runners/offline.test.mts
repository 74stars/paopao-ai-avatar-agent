import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const tsxCli = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const runner = fileURLToPath(new URL("./offline.mts", import.meta.url));

test("offline eval runner emits passing, sanitized quality metrics", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "paopao-evals-"));
  const reportPath = join(outputDirectory, "report.json");
  const result = spawnSync(process.execPath, [tsxCli, runner, "--report", reportPath], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(reportPath, "utf8").trim(), result.stdout.trim());
    const report = JSON.parse(result.stdout) as {
      passed: boolean;
      counts: { fixtures: number; extractionFixtures: number; insightFixtures: number };
      metrics: Record<string, number>;
      gates: Array<{ metric: string; passed: boolean }>;
    };

    assert.equal(report.passed, true);
    assert.ok(report.counts.fixtures >= 30);
    assert.equal(report.counts.fixtures, report.counts.extractionFixtures + report.counts.insightFixtures);
    assert.equal(report.metrics.schemaPassRate, 1);
    assert.ok(report.metrics.primaryClassificationMacroF1 >= 0 && report.metrics.primaryClassificationMacroF1 <= 1);
    assert.equal(report.metrics.evidenceLocatabilityRate, 1);
    assert.ok(report.metrics.recallAt8 >= 0.8);
    assert.ok(report.metrics.noRelatedQueryFalsePositiveRate <= 0.05);
    assert.equal(report.metrics.insightCitationLegalityRate, 1);
    assert.equal(report.metrics.illegalCitationCount, 0);
    assert.ok(report.gates.every((gate) => gate.passed));

    for (const forbidden of ["---BEGIN_UNTRUSTED_USER_DATA---", "Bearer "]) {
      assert.equal(result.stdout.includes(forbidden), false);
    }
    assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(result.stdout), false);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});
