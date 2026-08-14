# Living Library Master V1

This directory is the non-destructive production workspace for the original-art-driven Living Library rebuild.

Authoritative workflow: `docs/design/living-library-master-production.md`.

## Directory contract

- `source/`: immutable copies of the confirmed edit targets.
- `masks/`: deterministic edit masks in master coordinates.
- `prompts/`: exact prompts used for each image edit.
- `working/`: versioned image edits and masks. Never overwrite a prior candidate.
- `objects/`: selected object layers after reversible-composite review.
- `reviews/`: unannotated comparison renders and written art direction.
- `manifest.production.json`: production state and source hashes. It is not a runtime manifest.

Files in this directory are not loaded by the application until the art baseline is reviewed and the runtime replacement phase begins.
