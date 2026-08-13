import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const workspaceDirectory = fileURLToPath(new URL("..", import.meta.url));
const entryPoint = fileURLToPath(new URL("../electron/preload.ts", import.meta.url));
const outputPath = fileURLToPath(new URL("../dist-electron/preload.cjs", import.meta.url));
const forbiddenEsmOutput = fileURLToPath(new URL("../dist-electron/preload.js", import.meta.url));
const bareBuiltins = builtinModules.map((name) => name.replace(/^node:/, ""));
const forbiddenBuiltins = new Set([...bareBuiltins, ...bareBuiltins.map((name) => `node:${name}`)]);

const rejectNodeBuiltins = {
  name: "reject-node-builtins",
  setup(buildContext) {
    buildContext.onResolve({ filter: /.*/ }, (args) => {
      if (forbiddenBuiltins.has(args.path)) {
        return { errors: [{ text: `Sandboxed preload cannot import Node built-in '${args.path}'` }] };
      }
      return undefined;
    });
  }
};

const result = await build({
  absWorkingDir: workspaceDirectory,
  entryPoints: [entryPoint],
  outfile: outputPath,
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["electron"],
  metafile: true,
  write: false,
  plugins: [rejectNodeBuiltins]
});

const externalImports = [...new Set(
  Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((dependency) => dependency.external)
    .map((dependency) => dependency.path)
)].sort();

if (externalImports.length !== 1 || externalImports[0] !== "electron") {
  throw new Error(`Preload external imports must equal ['electron']; received ${JSON.stringify(externalImports)}`);
}
if (result.outputFiles.length !== 1) {
  throw new Error(`Preload build must produce exactly one file; received ${result.outputFiles.length}`);
}
if (existsSync(forbiddenEsmOutput)) {
  throw new Error(`Forbidden ESM preload artifact exists: ${forbiddenEsmOutput}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.outputFiles[0].contents);
console.log(`Verified sandbox preload: ${outputPath} (external imports: electron)`);
