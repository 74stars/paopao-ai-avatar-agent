# ADR 0002: Contract v1 and Legacy Field Mapping

Status: Accepted  
Date: 2026-08-05

## Decision

`@paopao/contracts` v1 is the only cross-module API. Every schema is strict and
unknown fields are rejected. The visual prototype and the legacy Feishu HTTP
bot are migration references only; their payloads are not compatibility APIs.

The single classification field is `classification.inputType` and uses the v1
`MemoryType` enum. Legacy labels map as follows:

| Legacy label | v1 value |
| --- | --- |
| desire, wish | `goal` |
| schedule, plan | `goal` |
| place, travel | `other` |
| person | `person` |
| book, reading | `reading` |
| thought, idea | `thought` |

Unmapped labels become `other`; no `facets`, growth axes, `shouldReply`,
`askInsight`, or Self Model fields are defined in v1. A user explicitly chooses
`CaptureMode` (`remember` or `think`) and the Feishu channel policy chooses its
reply behavior.

## Consequences

Consumers import schemas and inferred types from `@paopao/contracts` and domain
status transitions from `@paopao/domain`. A future incompatible change requires
a new schema version and a contract-change proposal; consumers must not add
temporary compatibility fields.
