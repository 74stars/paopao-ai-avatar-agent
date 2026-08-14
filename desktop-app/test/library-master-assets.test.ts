import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ProductionPhase = {
  id: string;
  runtimeManifest?: string;
  runtimeAssetDirectory?: string;
  verification?: {
    runtimeManifestSha256?: string;
    runtimeFrameCount?: number;
  };
};

type RuntimeManifest = {
  canvas: { width: number; height: number };
  states: Record<string, {
    idle: string;
    letterbox: string;
    books: Record<string, string>;
  }>;
};

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function collectCandidateHashes(value: unknown, hashes = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return hashes;
  for (const [key, child] of Object.entries(value)) {
    if (key === "candidateSha256" && typeof child === "string") hashes.add(child);
    else collectCandidateHashes(child, hashes);
  }
  return hashes;
}

describe("Living Library P5 runtime assets", () => {
  it("resolves the production manifest to the real public package and approved frames", () => {
    const productionPath = resolve("design/assets/library-world-master-v1/manifest.production.json");
    const productionBuffer = readFileSync(productionPath);
    const production = JSON.parse(productionBuffer.toString("utf8")) as { phases: ProductionPhase[] };
    const p5 = production.phases.find((phase) => phase.id === "P5");
    expect(p5?.runtimeManifest).toBe("../../../public/assets/library-master-v1/manifest.json");
    expect(p5?.runtimeAssetDirectory).toBe("../../../public/assets/library-master-v1/");

    const runtimeManifestPath = resolve(dirname(productionPath), p5!.runtimeManifest!);
    const runtimeDirectory = resolve(dirname(productionPath), p5!.runtimeAssetDirectory!);
    expect(existsSync(runtimeManifestPath)).toBe(true);
    expect(dirname(runtimeManifestPath)).toBe(runtimeDirectory);

    const runtimeManifestBuffer = readFileSync(runtimeManifestPath);
    expect(sha256(runtimeManifestBuffer)).toBe(p5?.verification?.runtimeManifestSha256);
    const runtime = JSON.parse(runtimeManifestBuffer.toString("utf8")) as RuntimeManifest;
    const frames = new Set(Object.values(runtime.states).flatMap((state) => [state.idle, state.letterbox, ...Object.values(state.books)]));
    expect(frames.size).toBe(p5?.verification?.runtimeFrameCount);

    const approvedHashes = collectCandidateHashes(production);
    for (const frame of frames) {
      const file = readFileSync(resolve(runtimeDirectory, frame));
      expect(file.subarray(0, 8).toString("hex"), frame).toBe("89504e470d0a1a0a");
      expect(file.readUInt32BE(16), frame).toBe(runtime.canvas.width);
      expect(file.readUInt32BE(20), frame).toBe(runtime.canvas.height);
      expect(approvedHashes.has(sha256(file)), frame).toBe(true);
    }
  });
});
