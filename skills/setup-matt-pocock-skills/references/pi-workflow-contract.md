# Pi workflow contract

These skills run in Pi. Use the native `question` extension for one decision and `questionnaire` for a frontier of decisions when the session is interactive; use numbered Markdown only when the TUI is unavailable. Once the user has authorized the workflow for this session, do not ask for the same approval again. Continue to ask necessary product or design questions.

The `subagent` tool blocks until its `tasks` array finishes. Batch independent tasks in one call. Only the `research` workflow is genuinely background. Implementation, review, and other coding tasks are blocking work. Pi does not create worktrees automatically: create and name a Git worktree explicitly, pass its `cwd`, and keep each task in its own worktree.

A skill dependency is loaded by reading its `SKILL.md` from the managed Pi skill directory (normally `~/.pi/agent/skills/<name>/SKILL.md`). Do not describe an unavailable skill-dispatch API or Claude commands. A subagent receives its role and pointers in prose and reads any dependency it needs.

Local writes are ordinary repository work. Remote tracker mutations, PR creation, comments, labels, assignment, and closing require explicit authorization for that class of external operation. One authorization covers the authorized operation for the session; do not re-prompt for every item. Read-only remote inspection does not require a write authorization.

For a remote tracker, the remote spec or ticket body is authoritative for acceptance. Keep a versioned local execution ledger at `.scratch/<feature>/issues/` containing pointers and execution metadata. Claims and completion evidence are local Git state first; mirror assignees, comments, labels, or closure remotely only when authorized. Local and remote ticket producers must use the same execution metadata:

```text
Triage: ready-for-agent
Execution: open|claimed|complete
Claimed by: none|<run-id>
Branch: none|<branch>
Blocked by: none|01, 02
Verified commit: none|<sha>
Last attempt: none|<run-id>, <branch>, <worktree>, <reason>
```

A remote ledger may add `Remote: <URL>` and `Acceptance source: remote`. Do not duplicate acceptance criteria into it as an authority. `complete` requires an integrated commit and checks recorded locally. A claim is written and committed before dispatch; failed work retains its branch and worktree for inspection while the ledger returns to `Execution: open`.

Review claims must distinguish evidence actually exercised from assumptions. “End-to-end verified” is reserved for a real full-path run; repository inspection, unit tests, or a partial reproduction must be named precisely.
