---
name: handoff
description: Save a compact Pi handoff document so a fresh agent or user session can continue the work.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a concise handoff in a uniquely named file in the operating system's temporary directory, outside the repository. Use the focus supplied by the user; otherwise preserve the active objective and next useful step. Report the absolute path and warn that temporary storage is not a durable repository artifact.

Include:

- Objective, agreed decisions, scope, and outstanding questions.
- Repository/worktree absolute path, branch, starting baseline, current commit, and staged/unstaged/untracked changes relevant to the task.
- Pointers to specs, tickets, local execution ledger, research notes, commits, review packets, and evidence. Reference existing artifacts rather than duplicating their contents.
- Exact authorization already granted, restrictions still in force, and any approval still needed. A fresh session must not repeat already settled approval requests or expand their scope.
- Current claims, failed attempts, running research identifiers/output paths, and recovery instructions where applicable. Do not imply implementation is running in the background.
- Checks actually run and results; distinguish not run and blocked checks.
- A **Suggested skills** section naming `/skill:<name>` entry points and the advertised `SKILL.md` paths the next agent should read.
- A precise continuation instruction, including which worktree to use and who owns integration/state updates.

Redact credentials, secrets, and unnecessary personal information. Do not embed sensitive contents merely because the document is temporary. If artifacts are local-only, say so; a separate machine will need access to them.

This skill writes the handoff; it does not launch another session. Give the user a prompt such as `Read <absolute-handoff-path> and continue the authorized task in <worktree>.` Use `/skill:claude-handoff` only when the user wants the compatibility workflow that also delegates continuation.
