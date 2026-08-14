# Changelog

All notable user-facing changes are recorded here.

## [0.1.0] - 2026-08-15

### Added

- Local-first text capture with durable SQLite storage and persistent background jobs.
- Living Library browsing, search, source traceability, revision history, classification and summary governance.
- Data export, independent safety snapshots, backup restore, deletion lifecycle and diagnostic export.
- Named AI Provider profiles with write-only credentials protected through Electron safeStorage.
- macOS and Windows desktop surfaces, tray integration, global capture shortcut and draggable desktop bubble.
- Post-MVP Feishu adapter baseline with redacted errors and durable outbound delivery controls.

### Changed

- Replaced the legacy v4/v4.1 Living Library implementation with the approved 12-frame master scene.
- Clarified the online Preview as an isolated simulated-data concept and closed its dialog keyboard-accessibility gaps.
- Converged runtime resources, release evidence and design provenance; design binary media now uses Git LFS.

### Security

- Kept renderer processes sandboxed behind typed preload APIs.
- Prevented plaintext provider and Feishu credentials from being returned to the Renderer or logs.
- Added fenced job commits, deletion-state checks and redacted public failure mapping.
