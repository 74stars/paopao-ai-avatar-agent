# ADR 0003: Preload Capability Boundary and Verifiable Sandbox Bundle

- **Status:** Accepted (implemented and locally verified 2026-08-08)
- **Date:** 2026-08-08
- **Scope:** `desktop-app/` preload, Electron window security, build chain, CI
- **Owners:** A0 (dependency/build/CI and acceptance), A3 (Electron source/runtime smoke)

## Context

During diagnosis, the desktop renderer rendered successfully but `window.paopao`
was not installed. Electron reported that `dist-electron/preload.js` could not
be loaded by
`executeSandboxedPreloadScripts` because the file is ESM while the sandboxed
preload loader expects CommonJS.

This is not only a module-format mismatch. The preload is the only intended
capability boundary between untrusted renderer content and privileged main
process behavior. A fix is complete only when all of these properties hold:

1. every production window is sandboxed and isolated;
2. the renderer receives only the named `window.paopao` methods;
3. the preload artifact has no Node or main-process dependency;
4. build verification rejects a future dependency-graph regression;
5. a real Electron process proves that the bridge loads and IPC works.

The diagnosed source graph violated property 3: `preload.ts` imported `ipc.ts`
and `credential-store.ts`, both of which imported Node built-ins. CI only built
files, so it did not prove properties 1, 2, or 5.

## First-Principles Model

There are three trust zones:

| Zone | Allowed capabilities | Forbidden dependencies |
| --- | --- | --- |
| Renderer | DOM and the frozen `window.paopao` API | Node globals, `ipcRenderer`, filesystem, credentials |
| Preload membrane | Zod validation, fixed IPC channel names, `contextBridge` | generic invoke, main modules, Node built-ins, arbitrary packages at runtime |
| Main | Electron/Node, database, filesystem, encrypted credential store | exposing raw privileged objects to Renderer |

The resulting invariant is:

```text
Renderer -> window.paopao -> preload validation -> fixed IPC channel -> Main
```

No other Renderer-to-Main path is part of the MVP contract.

## Decision

### 1. Freeze the window security policy

Every Paopao `BrowserWindow` uses the same explicit preferences:

```ts
{
  preload: ".../preload.cjs",
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  webSecurity: true
}
```

Security does not rely on Electron defaults because defaults can change and
are difficult to review across multiple window constructors.

### 2. Split source by capability, not by file format

```text
desktop-app/electron/
  main.ts
  ipc.ts
  credential-store.ts
  preload.ts
  preload-shared/
    ipc-channels.ts
    ai-config-contracts.ts
    maintenance-contracts.ts
    window-contracts.ts
```

`preload.ts` may import `electron`, `@paopao/contracts`, `zod`, and modules in
`preload-shared/`. It must not import `ipc.ts`, `credential-store.ts`, or any
Node built-in.

Only Renderer-safe AI request/status schemas move to
`ai-config-contracts.ts`. The private `storedCredentialSchema`, Zod import,
provider/model constants, filesystem behavior, and encryption behavior remain
in `credential-store.ts`. Existing imports from `credential-store.ts` remain
compatible through explicit re-exports.

Electron 39's sandbox preload exposes Web Crypto random bytes but not
`crypto.randomUUID()`. The preload therefore formats an RFC 4122 v4 correlation
ID from `globalThis.crypto.getRandomValues()`. It does not carry a Node `crypto`
import, and the runtime smoke executes this path to prevent assumptions about
the sandbox's reduced global API.

### 3. Emit Main and preload through separate pipelines

`npm run build:electron` performs this ordered pipeline:

```text
clean dist-electron
  -> typecheck all electron TypeScript
  -> tsc emit main-process roots (preload.ts excluded)
  -> esbuild and verify preload
  -> write dist-electron/preload.cjs
```

There is no intermediate `preload.js`, and the build fails if such a file is
present. `esbuild@0.25.12` is a direct, exact dev dependency instead of relying
on Vite's transitive dependency.

The preload build uses the JavaScript API with:

```js
{
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["electron"],
  metafile: true,
  write: false
}
```

`platform: "node"` and `external: ["node:*"]` are forbidden. Externalizing a
Node built-in would preserve a runtime `require()` and therefore conceal the
violation instead of failing the build.

Before writing the output, the build script:

1. rejects all bare and `node:` built-ins using `node:module.builtinModules`;
2. checks the esbuild metafile and requires the external-import set to equal
   exactly `electron`;
3. checks that there is exactly one JavaScript output;
4. checks that `dist-electron/preload.js` does not exist;
5. writes `preload.cjs` only after all checks pass.

### 4. Prove the boundary in a real runtime

`scripts/smoke-preload.cjs` launches a hidden `BrowserWindow` with the exact
production preferences and the production `preload.cjs`. It fails when:

- Electron emits `preload-error`;
- `window.paopao` is absent;
- a typed `aiConfig.status` call cannot cross IPC and return a validated result;
- Renderer main world can access `require`, `process`, or raw `ipcRenderer`;
- `getLastWebPreferences()` does not report the frozen security policy.

CI runs this smoke under Xvfb on Linux and directly on Windows. Artifact text
inspection remains useful diagnostics, but it is not acceptance evidence by
itself.

## Interface Alignment

| Producer | Interface | Consumer | Rule |
| --- | --- | --- | --- |
| A0 | exact `esbuild` dependency and build scripts | A3 | no transitive tool dependency |
| A3 | `preload-shared/ipc-channels.ts` and window contracts | Main + preload | fixed names and bounded window movement only; no generic channel argument from Renderer |
| A3 | Renderer-safe Zod contracts | Main + preload | schemas only; no storage/service imports |
| A3 | `dist-electron/preload.cjs` | all BrowserWindows | single self-contained CJS file; only `electron` external |
| A3/A6 | runtime smoke evidence | A0 Gate | bridge, IPC, isolation, and effective preferences all asserted |

## Multi-Agent Work Orders

### A0 prompt

```text
Implement ADR 0003 build ownership only. Read the ADR and inspect git status.
Own desktop-app/package.json, root package.json, package-lock.json, build helper
scripts, and CI. Pin esbuild to the exact ADR version. Make the preload build
write:false, reject Node built-ins, verify the metafile external set is exactly
electron, and write only after verification. Do not change Renderer APIs or
credential behavior. Handoff exact commands and artifact evidence to A3/A6.
```

### A3 prompt

```text
Implement ADR 0003 Electron ownership only. Read the ADR and inspect git status.
Extract IPC names and Renderer-safe schemas into electron/preload-shared. Keep
storedCredentialSchema and all storage/crypto/filesystem behavior main-only.
Make preload import only electron, contracts, zod, and preload-shared modules;
use Web Crypto getRandomValues for local UUID v4 correlation IDs. Point every
window at preload.cjs and apply the explicit shared security preferences. Add a
hidden BrowserWindow smoke that
asserts preload-error absence, window.paopao, one typed IPC round trip, missing
Renderer Node globals, and effective preferences. Preserve existing API types.
```

### A6 verification prompt

```text
Verify ADR 0003 without weakening assertions. From a clean install, run desktop
typecheck, Electron build, unit tests, and the preload runtime smoke on Linux
and Windows. Confirm preload.cjs exists, preload.js does not, and report the
effective webPreferences plus IPC result. Treat build-only success as
insufficient. Return a PASS/FAIL table with command output and environment.
```

## Alternatives Rejected

| Alternative | Reason |
| --- | --- |
| Disable `sandbox` | Restores unnecessary Renderer privileges and removes the intended security boundary |
| Compile preload with Main through `tsc` | Recreates ESM output under the current package/module settings |
| Use `--external:node:*` | Preserves forbidden runtime requires instead of detecting them |
| Bundle directly from current imports | Pulls filesystem/credential/main behavior toward the preload graph |
| Inline duplicate schemas/channels | Creates contract drift between Main and preload |
| Adopt electron-vite now | Broad toolchain migration is not required to enforce this invariant |

## Consequences

- Zod and Paopao contract code increase preload bundle size, but add no runtime
  package dependency and preserve validation on both sides of IPC.
- New preload-shared modules must remain browser-safe. The build rejects Node
  regressions before producing an artifact.
- CI becomes an executable security check, not only a compiler check.
- Adding a BrowserWindow now requires reusing the frozen preference factory and
  extending smoke coverage when its privilege model differs.

## Acceptance Evidence

- [x] `npm run check --workspace=paopao-desktop`
- [x] `npm run typecheck`
- [x] `npm run build:electron`
- [x] `npm run build`
- [x] `dist-electron/preload.cjs` exists and `dist-electron/preload.js` does not
- [x] build metafile verification reports only `electron` external
- [x] `npm run test --workspace=paopao-desktop` (49 tests)
- [x] `npm test` (contracts, unit, integration, and offline evals)
- [x] `npm run smoke:preload:runtime` passes in a real Electron 39 process
- [x] Linux CI smoke is configured through Xvfb
- [x] Windows CI smoke is configured

Local runtime evidence reported `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webviewTag: false`, and `webSecurity: true`. The
smoke also proved one valid typed IPC round trip and one preload-rejected invalid
request while Renderer `require`, `process`, and raw `ipcRenderer` remained
undefined. Remote Linux/Windows job results remain release-gate evidence rather
than a prerequisite for accepting the implemented architecture.
