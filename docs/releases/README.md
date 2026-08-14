# Release operations

The formal release workflow is `.github/workflows/release.yml`. It builds native Windows and macOS artifacts from an existing annotated version tag.

## Required repository secrets

The workflow cannot attempt a formal GitHub Release unless all seven secrets exist; presence alone is not proof, and native jobs must still emit positive signature/notarization verification outputs:

| Secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | Base64 data or secure URL for the Windows Authenticode PFX/P12 certificate |
| `WIN_CSC_KEY_PASSWORD` | Password for the Windows signing certificate |
| `MAC_CSC_LINK` | Base64 data or secure URL for the Apple Developer ID Application certificate |
| `MAC_CSC_KEY_PASSWORD` | Password for the macOS signing certificate |
| `APPLE_API_KEY_P8` | Contents of the App Store Connect API private key |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect API issuer UUID |

The App Store Connect key must have permission to submit notarization requests. Secrets are passed only to their native package jobs and are never uploaded as artifacts.

## Publication policy

1. Use an annotated tag matching every package version, for example `v0.1.0`.
2. The Windows job verifies the installer and exact installed application signature, performs a silent NSIS install, waits for the SQLite readiness marker, then uninstalls.
3. The macOS job verifies both x64 and arm64 unpacked apps, DMGs and ZIP contents; each DMG is notarized and stapled separately. The runner-native DMG is mounted, launched to SQLite readiness and removed.
4. If credentials are absent, unsigned candidates are retained only when packaging and candidate smoke/checksum validation complete; the workflow then fails at `publication-blocked`, and no GitHub Release is created. Credential presence never sets the native `verified` outputs.
5. Publication requires both native `verified=true` outputs. A draft is populated and exact asset names are checked before publication; an existing non-draft release is immutable.
6. The final checksum manifest and provenance attestation cover every attached asset, including signing/install evidence and platform manifests.

Unsigned or unnotarized artifacts are internal candidates. They must never be described as a formal release.
