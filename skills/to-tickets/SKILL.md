---
name: to-tickets
description: "Break an approved spec or plan into verifiable vertical-slice tickets with blocking edges in the configured tracker."
disable-model-invocation: true
---

<!-- Perfect Pi override of mattpocock/skills to-tickets at c55ee46073ed923f86ce59a5eb3b6d895095d1b7. -->

# To Tickets

Break an agreed spec or plan into a ticket graph. Read `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`; if either is missing, stop and direct the user to `/skill:setup-matt-pocock-skills`. Read a supplied spec path or issue in full, including comments, and use the project's glossary and ADRs.

1. Draft verifiable vertical slices, each small enough for one fresh context window. Each ticket delivers a complete, observable behavior through the relevant layers; do not split by technical layer. Put preparatory refactoring first when necessary. For a mechanical wide refactor that cannot remain green as vertical slices, use expand, migrate in green batches, then contract.
2. Give each ticket only its true blocking predecessors. A ticket with no blockers is on the initial frontier. Number local tickets in dependency order from `01`; use numbers in edges, not ambiguous titles alone. Check the graph for missing references and cycles.
3. Present the numbered proposal with title, blockers and behavior. Ask whether the granularity and edges are right; revise until the user approves. Do not silently treat a draft as approved.
4. Publish approved tickets using the tracker contract. For a real tracker, publish tickets in dependency order with native blocking relationships where supported and the configured triage label. Do not close or modify the parent spec/issue.

For a remote tracker, after publishing remote tickets, create local durable ledger files under `.scratch/<feature-slug>/issues/<NN>-<slug>.md` numbered `01` upwards mapping 1-to-1 to remote issue IDs, with `Remote: <ticket-URL>`, `Acceptance source: remote`, `Spec: <spec-URL-or-path>`, and the shared execution metadata below. The remote issue body remains authoritative for acceptance.

For local Markdown, create one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md` using this exact metadata shape. Use plain `Key: value` lines, not bold keys or YAML frontmatter. The execution state is independent of triage; `complete` is reserved for an integrated and verified result, never the initial ticket.

```markdown
# <NN>: <Title>

Triage: ready-for-agent
Execution: open
Claimed by: none
Branch: none
Blocked by: none
Verified commit: none
Last attempt: none

## What to build

<end-to-end behavior from the user's perspective>

## Acceptance criteria

- [ ] <observable outcome>
```

Use `Blocked by: 01, 02` for prerequisites. Keep acceptance criteria testable, and include the spec pointer in the body so a fresh session can locate it. Do not add code snippets or implementation paths unless a prototype captured a decision more precisely than prose. For local tracking, commit the approved spec, tracker configuration and tickets on the current branch before handoff; `implement-spec` will create its integration branch from a commit containing these artifacts before it creates ticket worktrees. Never stage unrelated files or include secrets. If the user has not authorized local commits, ask before doing so.

Report the ticket paths, graph frontier and any blocker. A ticket is not complete merely because it was published as `ready-for-agent`.
