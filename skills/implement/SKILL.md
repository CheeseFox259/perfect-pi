---
name: implement
description: Implement agreed work in the current session, verify it, and review the actual working changes before committing.
disable-model-invocation: true
---

# Implement

Implement the approved spec, tickets, or behavior from the conversation. An ordinary bounded implementation does not require a tracker or ticket graph. Preserve the repository's architecture, testing decisions, and explicit ticket-scoped exceptions.

Read [the Pi workflow contract](../setup-matt-pocock-skills/references/pi-workflow-contract.md). Read relevant project instructions, the agreed behavior, and the code before editing. Load dependent skills by reading their advertised `SKILL.md` paths; the interactive command spelling is `/skill:<name>`.

1. **Capture the starting baseline.** Record the starting commit (`git rev-parse HEAD`), branch, and `git status --short`. Inventory staged, unstaged, and untracked files before changing anything. Record which existing changes belong to the task. If there is pre-existing work, capture its diff and relevant file contents in a temporary baseline snapshot so the final review can distinguish this task's changes. Do not stage, discard, or commit unrelated work.
2. **Implement the behavior.** Use `tdd` at pre-agreed seams when applicable. Follow repository test decisions; do not invent implementation-mirroring tests for low-impact changes. Run focused tests and typechecking as useful feedback, then the relevant full suite once at the end when the repository requires it. Load architecture guidance for cross-module changes. Reuse existing session authorization: if the user already agreed to the direction or testing seam, continue without re-prompting.
3. **Verify the changed path.** Exercise the user-facing behavior when the environment supports it. Read `verify-product` for risk-appropriate checks. Report actual evidence, failures, and checks not run.
4. **Review before commit.** Read `code-review` and explicitly request **working-tree mode**, passing the starting baseline SHA, scope, spec or conversation acceptance, and pre-existing-change inventory. Include staged, unstaged, and task-owned untracked files. Use **snapshot mode** instead when the dirty starting tree needs an exact before/after boundary. Do not pass `HEAD` to a committed-only review and call an empty diff a pass. A snapshot audit may review an intentionally selected current tree without inventing history; report that it is an audit, not a diff.
5. **Commit within authorization.** When local commits are authorized and no instruction forbids them, stage only this task's changes, inspect the staged diff, and commit on the intended branch. Reuse session approvals: if the user already authorized implementation and commits for this session, proceed without asking again unless the commit would include unexpected or destructive changes. Otherwise leave the reviewed changes for the caller and report that no commit was made. If the caller explicitly requested a committed review, use **committed mode** with the captured baseline and final SHA after committing. Never push or create a PR without authorization.

Use the managed `implementer` role for delegated ticket implementation. Supply the spec, ticket, test decision, owned scope, explicit worktree `cwd`, and commit authorization. Create worktrees before a blocking `subagent` `tasks` call; do not substitute a research role or imply background coding. The parent owns merging, integration checks, and ledger updates.

Report behavior delivered, checks and review mode actually used, unresolved findings, and commit SHA (or that changes remain uncommitted). Do not claim integration on behalf of a parent workflow.
