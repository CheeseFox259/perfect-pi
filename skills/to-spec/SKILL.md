---
name: to-spec
description: "Capture agreed work for a later session or subagent in a concise, testable spec in the configured tracker."
disable-model-invocation: true
---

<!-- Perfect Pi override of mattpocock/skills to-spec at c55ee46073ed923f86ce59a5eb3b6d895095d1b7. -->

# To Spec

Turn settled decisions from this conversation into a durable spec. Do not reopen agreed product decisions or invent missing ones. Read `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`; if either is missing, stop and direct the user to `/skill:setup-matt-pocock-skills`.

1. Read the relevant code, glossary and ADRs if not already known. Work from the conversation and any supplied reference. Identify unknowns that block a testable spec; ask only about those, not decisions already made.
2. Choose the highest existing test seam that proves user-visible behavior. State the proposed test seam to the user and check that it matches their expectations before publishing. If it was already approved in this conversation, do not ask again. In headless mode, stop with the proposed seam if approval is still required; do not treat an unanswered question as consent.
3. Publish a concise spec to the configured tracker. For local Markdown, use `.scratch/<feature-slug>/spec.md` and keep it in Git so fresh sessions and worktrees can read it. For a remote tracker, publish the spec remotely, and create a durable local spec ledger at `.scratch/<feature-slug>/spec.md` with `Remote: <spec-URL>` and `Acceptance source: remote` so local worktrees and tickets retain a persistent anchor. Do not stage or commit unrelated changes; get confirmation before committing task artifacts if the user has not already authorized it.

Use the following sections. Include user stories only when they convey a distinct behavior; do not pad the document to a fixed length. Express behavior and constraints, not a stale file-by-file implementation plan.

```markdown
# <Feature>

Status: ready-for-agent

## Problem and goal

<what the user needs and what changes>

## Agreed decisions

<behavior, interfaces, architectural constraints, and decisions already made>

## Acceptance criteria

- [ ] <observable outcome>

## Testing decision

<highest practical test seam and prior art, with the user's confirmation>

## Out of scope

<explicit boundaries>

## Open questions

<none, or questions that must be settled before implementation>
```

A spec with unresolved implementation-blocking questions is not `ready-for-agent`; keep its status as `needs-info` until the user settles them. For a larger effort, expand only the sections whose decisions need more detail; `to-tickets` will slice it later. Report the published pointer and what, if anything, remains open.
