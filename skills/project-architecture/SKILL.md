---
name: project-architecture
description: Load and apply a project's architecture, domain, ADR, schema, and API-contract rules. Use before cross-module changes or when architecture decisions affect implementation.
---

# Project Architecture

First locate the project's architecture sources. Common locations are:

- `CONTEXT.md`
- `docs/architecture/`
- `docs/adr/`
- `docs/agents/`
- database schema and migration directories
- API contracts and generated client definitions

Read only the documents relevant to the requested change. Treat those documents as the source of truth for terminology, boundaries, ownership, persistence, and public contracts.

Before editing, summarize the constraints that affect the change. If the sources conflict or the requested change would invalidate an existing decision, stop and ask for a decision or use the appropriate Matt grilling/spec workflow.

Do not create a new abstraction when an existing project boundary already owns the behavior. When a public contract or architecture decision changes, update its durable documentation and tests.
