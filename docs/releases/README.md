# Release operations

The formal release workflow is `.github/workflows/release.yml`. It builds native Windows and macOS artifacts from an existing annotated version tag and publishes them as a GitHub Release.

## Distribution policy

- **Channel**: GitHub Releases. Every attached asset is verified against a deterministic SHA-256 manifest and covered by a GitHub build-provenance attestation.
- **Signing**: the project intentionally does not use developer signing (Apple Developer ID / notarization, Windows Authenticode). The workflow therefore has no signing-secret requirements. `SIGNING-VERIFICATION-win.txt` / `SIGNING-VERIFICATION-mac.txt` record the actual (unsigned) signature status as evidence.
- **Verification before publication**: the release must pass the full verify gate, both native package jobs (build + Wave 4 E2E + container/installer checks), and the clean-runner install/uninstall (Windows) and mount/launch/removal (macOS) smokes.

## Publication policy

1. Use an annotated tag matching every package version, for example `v0.1.0`.
2. `policy` verifies the tag is annotated, matches the checked-out HEAD, and matches every package version (`scripts/verify-release.mjs`).
3. `verify` runs the full Linux check suite and confirms archived v4/v4.1 resources are absent from the build.
4. `windows-package` builds the NSIS installer, runs the Wave 4 E2E, records the (unsigned) Authenticode status, and runs a silent install -> SQLite readiness -> launch -> uninstall smoke on a clean runner.
5. `macos-package` builds x64 and arm64 DMG/ZIP, verifies both containers' structure and architectures, and runs a clean-runner mount -> launch -> SQLite readiness -> removal smoke.
6. `publish` downloads both platform artifacts, verifies the platform checksums, generates the aggregate `SHA256SUMS.txt`, attaches build provenance, and creates/updates an immutable GitHub Release only after the native `verified` outputs are true.
7. Unsigned artifacts are expected by policy; they are still integrity-verified via checksums and attestation.

## Tag re-runs

- Re-pushing the same annotated tag re-triggers the workflow. If the tag points at a new commit (force-push), the new run uses the workflow file at that commit.
- A GitHub Release is immutable once published; re-runs only replace assets while the release is still a draft.