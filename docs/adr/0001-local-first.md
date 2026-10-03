# ADR 0001: Local-first architecture for v0.1

## Status

Accepted

## Context

Ledgerase handles sensitive personal financial records, bank statements, and receipts. The first goal is to build a useful mobile application for a real household and validate ingestion, merchant resolution, budgeting, and receipt parsing before adding infrastructure.

## Decision

Ledgerase v0.1 will be local-first:

- SQLite is the primary data store.
- No user account is required.
- No backend is required.
- Raw financial documents remain local by default.
- Domain and ingestion layers must not depend on a remote service.

## Consequences

Positive:

- lower privacy risk
- simpler architecture
- faster path to a usable app
- offline operation
- fewer external failure modes

Trade-offs:

- household synchronization is deferred
- backup/export must eventually be designed explicitly
- migration to sync requires stable identifiers and provenance from the beginning

The domain model should therefore use globally unique identifiers and household ownership even before synchronization exists.
