import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(new URL("../dist-electron", import.meta.url));

rmSync(outputDirectory, { recursive: true, force: true });
