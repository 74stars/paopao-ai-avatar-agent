# Architecture Decision Records

This index is maintained by A0. Each ADR records a decision that affects more than one workspace; implementation agents must link contract or migration changes back here.

## Current Decisions

- [0002 Contract v1 legacy-field mapping](./0002-contract-v1-legacy-field-mapping.md)
- [0003 Preload capability boundary and verifiable sandbox bundle](./0003-preload-sandbox-bundle.md)
- [0004 Defer Feishu connector beyond MVP](./0004-defer-feishu-post-mvp.md)
- [0005 Named AI Provider Profiles and Codex channel reuse](./0005-ai-provider-profiles-v2.md)
- [0006 Design binary assets tracked with Git LFS](./0006-design-assets-git-lfs.md)

## Superseded In Part

- [Provider OpenAI structured output v1](./provider-openai-structured-output-v1.md): historical G0 baseline, superseded in part by ADR 0005.

ADR 0005 supersedes the original Provider ADR's single-provider settings and
allowlist decision. The frozen `AiProviderV1`, output validation, audit fields,
retry ownership, and no-paid-network CI rules remain in force.

ADR 0003 is accepted and implemented. Its build-time dependency proof and
runtime Electron smoke are release-gate checks for the Renderer/Main boundary.

ADR 0004 supersedes earlier scope statements that made G3 and real-tenant
Feishu acceptance prerequisites for the macOS/Windows MVP release.
