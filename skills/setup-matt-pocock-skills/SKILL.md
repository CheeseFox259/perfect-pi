---
name: setup-matt-pocock-skills
description: Configure this repo's issue tracker, triage labels, domain documentation, and Pi execution ledger for the engineering workflow skills.
disable-model-invocation: true
---

# Setup Matt Pocock's Skills

Configure the repository contracts consumed by `to-spec`, `to-tickets`, `implement-spec`, `triage`, and `wayfinder`. This is a prompt-driven workflow: inspect first, present findings, collect the choices that are still open, show the draft, then write it.

Read [references/pi-workflow-contract.md](references/pi-workflow-contract.md) before writing. It defines Pi's question tools, blocking subagents, worktrees, authorization boundary, and the shared ticket metadata.

## 1. Explore

Inspect, without editing:

- `git remote -v` and `.git/config`.
- Root `AGENTS.md` and `CLAUDE.md`, including any existing `## Agent skills` block.
- `GLOSSARY.md`, `GLOSSARY-MAP.md`, `docs/adr/`, and `docs/agents/`.
- `.scratch/`, monorepo markers, and the installed `triage` skill.

Treat an existing tracker configuration, populated `.scratch/`, or domain layout as settled. Do not reopen it.

## 2. Present only unsettled choices

Use `question` for one section and `questionnaire` for multiple independent sections in interactive Pi. Keep `allowOther: true`, identify the recommended option, and allow amendments. In a headless session, use numbered Markdown questions and wait for the answer. The user may authorize the setup once; do not repeat the same approval while writing the agreed files.

### Issue tracker

Recommend local Markdown under `.scratch/` when no settled tracker exists: it requires no network or credentials and travels through Git. Offer GitHub, GitLab, or a documented other tracker when the repository already uses one or the user chooses it.

### Triage labels

If `triage` is available, ask once whether to keep the canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. Record any mapping the user supplies.

### Domain docs

Use a single root `GLOSSARY.md` and `docs/adr/` unless monorepo evidence calls for `GLOSSARY-MAP.md` and context-specific documents.

## 3. Show the draft

Show the selected `## Agent skills` block and the complete contents of `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and, when triage is installed, `docs/agents/triage-labels.md`. Let the user amend the draft before writing; the session authorization applies to the agreed draft.

## 4. Write

Edit `CLAUDE.md` if it exists, otherwise `AGENTS.md` if it exists. If neither exists, ask which one to create. Update an existing `## Agent skills` block in place and preserve surrounding text. Never create the other file merely because it is convenient.

Write the selected tracker contract, domain contract, and triage mapping. Start from the bundled references for GitHub, GitLab, local Markdown, domain docs, and labels. For a remote tracker, include this local ledger rule:

- Remote issue/spec bodies and their acceptance criteria are authoritative.
- After remote tickets are published, create `.scratch/<feature>/issues/<NN>-<slug>.md` ledger files with `Remote: <ticket-URL>`, `Acceptance source: remote`, `Spec: <spec-URL-or-path>`, local issue numbers mapped 1-to-1 to remote issue IDs, and the shared execution fields from [references/pi-workflow-contract.md](references/pi-workflow-contract.md).
- `to-tickets` creates these ledgers; `implement-spec` reads and commits claim, failure, and verified-commit state locally. Remote assignment, comments, labels, and closure are optional mirrors and require authorized external writes.

For local Markdown, use one spec at `.scratch/<feature>/spec.md` and one implementation ticket per `.scratch/<feature>/issues/<NN>-<slug>.md`. The exact implementation metadata is:

```text
Triage: ready-for-agent
Execution: open
Claimed by: none
Branch: none
Blocked by: none
Verified commit: none
Last attempt: none
```

`Triage` describes readiness; `Execution` describes implementation progress. wayfinder decision tickets instead use `Type: research|prototype|grilling|task` and `Status: claimed|resolved`; do not merge those state machines.

## 5. Done

Report the files written and state that the Pi-adapted implementation ladder and tracker consumers can now read them. Mention that the configuration files may be edited directly later.
