# ADR 0004: Defer Feishu Connector Beyond MVP

- **Status:** Accepted
- **Date:** 2026-08-08
- **Scope:** MVP product scope, release gates, Feishu Adapter and tenant acceptance
- **Owner:** Product / A0

## Context

Paopao is positioned as a highly personalized local-first desktop application.
The current Feishu connector requires each independent tenant to create and
publish an enterprise self-built application and configure App ID/App Secret.
That onboarding cost is disproportionate to the MVP's primary hypotheses:
whether a quiet desktop capture surface and a governable local memory library
create durable personal value.

Wave 3 already produced a substantial implementation and automated evidence,
but real-tenant acceptance has not been executed. Requiring that external setup
would delay Windows MVP validation without improving the desktop hypothesis.

## Decision

1. Feishu is no longer an MVP deliverable or a prerequisite for the MVP release gate.
2. The MVP gate path is G0 -> G1 -> G2 -> G4. Historical G3 evidence is retained as
   the optional Feishu increment gate, not as a blocking MVP gate.
3. Existing Adapter, Binding/Delivery services, schema 3 migrations, typed IPC,
   settings UI and automated tests remain in the repository. Migrations are not
   rolled back and frozen contracts are not deleted.
4. M3-04 real-tenant acceptance, public distribution, OAuth, tenant onboarding
   and long-term connector support move to the post-MVP backlog.
5. Feishu tests remain regression coverage while the code is present, but missing
   tenant credentials or FT-01 through FT-20 evidence cannot block MVP release.
6. Before a public MVP package is signed off, the Feishu surface must be described
   as an unsupported experimental increment or be disabled from the default product
   surface. It must not be marketed as an MVP capability.

## Consequences

- G4 focuses on desktop Capture, local durability, AI governance, search,
  correction, delete/export/restore, Renderer isolation and Windows packaging.
- The official SDK dependency may remain locked so the completed increment stays
  buildable and testable; removing it is a separate dependency decision.
- A future Feishu release needs a fresh product decision between self-built-app
  onboarding and a public-app/OAuth model, followed by the real-tenant runbook.
- No cloud database or second memory path is introduced by this decision.
