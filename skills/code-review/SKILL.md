---
name: code-review
description: Review working-tree changes, committed changes, or an explicit snapshot along independent Standards and Spec axes using parallel Pi subagents. Use for current-tree audits, WIP, branches, and PRs.
---

# Code Review

Review along two independent axes: **Standards** (documented conventions plus judgement-based smells) and **Spec** (faithfulness to intended behavior). Neither axis can mask the other. This is read-only work. Ordinary review needs no issue tracker or tracker setup.

Read [the Pi workflow contract](../setup-matt-pocock-skills/references/pi-workflow-contract.md) and [review modes](references/review-modes.md). Pin one mode and scope before dispatch; both reviewers must see the same material.

## 1. Pin the review inputs

- **Working-tree mode** for “review my current changes”, WIP, or `implement` before commit. Record `HEAD` or the implementation's starting baseline SHA; include tracked staged and unstaged changes against that baseline plus task-owned untracked files. Record pre-existing changes separately. A current configuration audit may cover named existing files even with no diff: use snapshot mode.
- **Committed mode** for an explicit committed range, branch, or PR. Resolve baseline and tip to SHAs. State whether the baseline is an exact starting commit or a merge-base; do not silently replace one with the other. Exclude dirty files and disclose that exclusion.
- **Snapshot mode** for a supplied before/after snapshot, an exact dirty-tree boundary, or a current-tree/configuration audit. Record immutable input paths and hashes, the comparison baseline if one exists, and the scope. With no before snapshot, review current contents as an audit and do not invent a diff or commit history.

Capture scope, file inventory, diff/content artifacts, commit list where relevant, and exclusions in a temporary review packet outside the repository. Do not mutate the user's index. Include untracked content explicitly; Git diff alone does not include it. Avoid secrets and generated artifacts; disclose any omission that limits coverage. If files change during capture, recapture before dispatch.

A bad ref, unreadable snapshot, or empty change review is an input error, not a passing review. For an intentional current-tree audit, a nonempty set of current files is sufficient. Ask with `question`/`questionnaire` only when the mode, scope, or baseline cannot be inferred from the request or session.

## 2. Find the spec and standards

Prefer the user's supplied spec or session acceptance criteria, then issue references in commits or branch context, then matching repository specs. Read `docs/agents/issue-tracker.md` only if a remote issue lookup needs it. A remote spec/ticket body is authoritative; an execution ledger is a pointer, not replacement acceptance criteria. Fetch the source with configured read-only tools, or report why it is unavailable. Do not require tracker setup to review ordinary code.

If no spec exists, report “Spec: skipped — no spec available”; continue Standards. If the user supplied a spec but it cannot be read, mark Spec blocked instead of passing it.

Find relevant `AGENTS.md`, `CONTRIBUTING.md`, standards, glossary, and ADRs. Always add [the smell baseline](references/smell-baseline.md) to the Standards packet. Repository standards override smells; smells are labelled heuristics, never hard violations. Skip findings already enforced by tooling.

## 3. Run independent reviewers

Use a single blocking `subagent` call with a `tasks` array containing two independent read-only review tasks, using the installed review-capable role discovered from the available agents. Do not use an implementation role to make changes during review. Supply each task's explicit repository `cwd`, immutable packet path, mode, baseline/tip, scope, and its sources. Pi returns after both tasks finish; it does not detach them.

- **Standards task:** Read the complete review packet, documented standards, and the full smell baseline. Report per file/hunk every documented-standard violation with the rule and source, plus possible baseline smells with quoted evidence. Distinguish hard violations from judgement calls; documented rules win. Skip tooling-enforced issues. Keep the report under 400 words when practical.
- **Spec task:** Read the same review packet and the complete spec/acceptance source. Report missing or partial requirements, scope creep, and behavior that appears implemented incorrectly. Quote the requirement for every finding and locate the relevant code. Keep the report under 400 words when practical.

Skip only the Spec task when no spec exists. If the subagent tool or an appropriate role is unavailable, perform the two passes separately in the parent and disclose that parallel independent agents were not available. Never claim a subagent review that did not run.

## 4. Aggregate

Report mode, exact inputs, and coverage first. Present **Standards** and **Spec** separately, verbatim or lightly cleaned. Do not merge or rerank across axes. Include findings counts and the worst issue within each axis, or “no findings” within the reviewed scope. Distinguish skipped, blocked, and completed axes. Review is evidence from inspection, not proof that runtime behavior or E2E tests passed.
