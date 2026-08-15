# ADR 0006: Design binary assets tracked with Git LFS

- **Status:** Accepted and implemented
- **Date:** 2026-08-15
- **Owners:** Desktop production scenes, Release engineering, Docs/Design provenance
- **Relates to:** legacy removal manifest `docs/design/2026-08-15-legacy-library-removal-manifest.md`

## Context

`desktop-app/design/` is the non-destructive production workspace for the Living
Library master scene: source exports, masks, approved/working frames, reviews and
production manifests. At the v0.1.0 convergence it holds roughly 396 MiB of working
tree binaries (420 MiB at the earlier snapshot before the v4/v4.1 removal batch),
made up of 183 PNG/WebP files across `library-world-master-v1/` and scene
master files.

Two properties drive the storage decision:

1. **Provenance.** The master scene is the source of truth for what ships in the
   Renderer; every approved frame must be traceable to a code revision and
   covered by a production manifest with pinned hashes.
2. **Packaging independence.** The shipped application never contains these
   files. electron-builder `files` only includes `dist/**`,
   `dist-electron/**` and `package.json`; the runtime assets under
   `desktop-app/public/assets/` (13 master-v1 frames, icons, tray) are small,
   fully referenced by manifest and committed normally. CI checks out with
   `lfs: false` and does not need design binaries at all.

## Decision

Design binary media under `desktop-app/design/` is tracked with Git LFS.
`.gitattributes` pins the rule:

```gitattributes
desktop-app/design/**/*.png filter=lfs diff=lfs merge=lfs -text
desktop-app/design/**/*.webp filter=lfs diff=lfs merge=lfs -text
```

Working tree checkouts materialize the full 396 MiB scene; the Git history itself
stores only 1.92 MiB of pointers (pack `size-pack`). The local LFS object cache
is `.git/lfs` (~365 MiB) and is prunable after pushes.

### Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| External archive (object storage / separate release archive) | Splits binary provenance from Git history; restoring requires external credentials and destroys the link between a scene revision and the code that shipped it. |
| Commit binaries directly into Git | History would grow by ~400 MiB per scene generation; every clone/CI checkout pays the cost. |
| Exclude from the repository entirely | Loses rebuildability of production master scenes and review/audit evidence. |

## Consequences

- Contributors must install `git-lfs` and run `git lfs pull` (or clone with
  LFS) to materialize `desktop-app/design/`; the rest of the repo works without
  it.
- GitHub LFS quota for the account (1 GiB storage tier) currently holds ~365 MiB;
  v0.1.0 is comfortably within quota.
- New scene revisions add new LFS objects; `git lfs prune` trims the local
  cache after a push. Packaged artifacts never contain design binaries, so LFS
  does not affect installer size.
- Release verification: `git lfs fsck` must pass, and every tracked PNG/WebP
  under `desktop-app/design` must carry the `lfs` filter (checked by
  `git check-attr filter`); both are recorded in the release inventory.
