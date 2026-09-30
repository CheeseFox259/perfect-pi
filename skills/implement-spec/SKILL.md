---
name: implement-spec
description: "Implement a specification in code: work a ticket graph to its frontier using Pi subagents and worktrees."
disable-model-invocation: true
---

<!--
Perfect Pi local override of mattpocock/skills `implement-spec`.
Upstream assumes Claude Code: background subagents, automatic per-agent
worktrees, and a GitHub PR as the integration point. Pi differs on all three.
Base ref: c55ee46073ed923f86ce59a5eb3b6d895095d1b7
-->

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

Read `docs/agents/issue-tracker.md` before proceeding. If it is missing, tell the user to run `/skill:setup-matt-pocock-skills` and stop; do not guess where tickets live.

The goal is an integrated branch implementing the spec. A draft PR is optional and requires explicit authorization.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

## Pi execution semantics

Read this before dispatching anything. Upstream's language ("run in the background", "its own worktree") does not mean what it means in Claude Code.

- **Concurrency**: the `subagent` tool is **blocking**. A `tasks: [...]` array runs those subagents concurrently, but the call does not return until every one finishes. There is no fire-and-forget. So "maximum concurrency" means *batch the whole frontier into a single `tasks` call*, not "dispatch and carry on".
- **Background work**: only the `research` tool is genuinely background (an in-process second session that writes findings to a file). Use it for exploration notes; never for implementation.
- **Worktrees**: Pi has no automatic per-subagent worktree. Create them yourself with `git worktree add` before dispatching, and pass each subagent its own `cwd`.
- **Skills**: there is no "Skill tool". A subagent is told its task in prose; when it needs a skill it reads `~/.pi/agent/skills/<name>/SKILL.md` itself. Use the managed `implementer` role for implementation (`~/.pi/agent/agents/implementer.md`); do not dispatch an unrelated reviewer/research role. This role does not pin a model, so it inherits the parent's provider/model and thinking level. For explicitly pinned experiments, pass the same `model` and `thinkingOverride` in the subagent call and verify the returned model/usage.
- **Model policy**: the managed `subagent-policy` extension blocks unapproved `input.model` overrides before execution. By default, children receive `cpa/gemini-3.8-flash-high` and `high` thinking. A user can explicitly authorize a different model for the current session with `/subagent-model allow provider/model`; the model itself cannot grant that authorization. Do not bypass this policy by spawning Pi through bash.
- **Parallel dispatch & observability modes**: You may execute frontier tickets using either:
  1. *In-process subagent*: Single blocking `subagent` call with `tasks: [...]` (fast, headless).
  2. *Tmux parallel sessions & dashboard*: Dispatch to isolated tmux windows via `tmux_tickets` tool or `node scripts/tmux-tickets.mjs dispatch --feature <feature> --wait`. This runs Window 0 as a live ANSI observability dashboard and separate windows per ticket running `cpa/gemini-3.8-flash-high:high`. The human can inspect live execution via `tmux attach -t pi-spec-<feature>` or run `/tmux-tickets status <feature>`.

## Steps

1. Read the spec, tickets and tracker contract. For local tickets or remote ledgers, require the plain `Triage`, `Execution`, `Claimed by`, `Branch`, `Blocked by`, `Verified commit` and `Last attempt` fields from `docs/agents/issue-tracker.md`. For a remote tracker, the remote ticket and spec bodies are authoritative for behavior and acceptance; the local durable ledger at `.scratch/<feature>/issues/<NN>-<slug>.md` provides the execution metadata bridged via `Remote: <ticket-URL>`, `Acceptance source: remote`, `Spec: <spec-URL-or-path>`, and local numbered issue IDs. Reject missing/cyclic blockers, unknown states, or a `complete` ticket without a verified integration commit. The **frontier** contains only `Execution: open` tickets whose blockers are all `complete`. A `claimed` ticket is not available; on resume, inspect its run, branch and worktree before deciding whether to finish the claim or release it.

2. (optional) Use an exploration subagent for required codebase or documentation research. Put shared markdown notes outside the repo and pass pointers to implementers, rather than repeating the findings in prompts.

3. For a local tracker, first ensure the configuration, spec and approved tickets are committed on the current branch; do not start from untracked `.scratch/` files, which a new worktree cannot see. For a remote tracker, ensure the spec pointer and local ledger files (`.scratch/<feature>/issues/<NN>-<slug>.md`) exist and are committed on the current branch before creating worktrees; if ledgers are missing for an approved remote graph, materialize them first with `Remote: <ticket-URL>`, `Acceptance source: remote`, `Spec: <spec-URL>`, and 1-to-1 numbered issue IDs. Stage only those artifacts, inspect for secrets and unrelated changes, and ask before committing if the user has not authorized local commits. Then create the integration branch from that commit and record its starting commit as the code-review fixed point. If `gh` is authenticated, ask for explicit authorization before creating a draft PR or changing its review state. Otherwise the branch is the integration point; record pointers in a handoff file. Never let an unapproved PR block local implementation.

4. At each frontier, check `Last attempt` for an existing branch/worktree and resume it when possible. Before dispatch, write `Execution: claimed`, `Claimed by: <run-id>` and `Branch: <ticket-branch>` for each ticket to the integration branch and commit that state. Create one worktree and branch per ticket from that claim commit:

   ```bash
   git worktree add ../<repo>-<NN>-<slug> -b <ticket-branch> <integration-branch>
   ```

   If worktree creation fails, release the claim with a diagnostic. Never dispatch two agents against the same ticket.

5. Dispatch implementers for the independent frontier tickets using either:
   - **In-process subagent**: a single blocking `subagent` call with `tasks: [...]` and each task's worktree as `cwd`. Pass pointers to the spec and ticket, the testing decision, and blockers' verified commits.
   - **Tmux parallel sessions**: use the `tmux_tickets` tool (`action: "dispatch", wait: true`) or execute `node scripts/tmux-tickets.mjs dispatch --feature <feature> --wait`. The tmux supervisor creates worktrees, launches Window 0 dashboard and individual ticket windows, tracks live status, and returns the verified commit SHAs upon completion.
   In either mode, instruct the agent to stay in its worktree, commit only its implementation, run relevant checks, and report its commit, acceptance results and blockers; it must not edit tracker state or other worktrees.

6. For each result, run relevant checks on the ticket branch, then merge into the integration branch and run the integration checks. Do not merge known-failing work or claim a ticket is complete because its agent returned. After a successful merge and verification, set `Execution: complete`, clear `Claimed by` and `Branch` to `none`, and record `Verified commit: <merged-code-sha>`; commit the tracker update. A blocker unlocks only at this point. If implementation or validation fails, retain the worktree and branch; set `Execution: open`, clear the current claim and branch, and record `Last attempt: <run-id>, <branch>, <worktree>, <reason>` on the integration branch. On the next run inspect that attempt before reassigning it. If a merge is in progress or has conflicts, resolve or abort it before recording failure; never leave an ambiguous integration state.

7. Recompute the frontier from the integration branch after every verified update. Repeat until all tickets are complete or a blocker cannot be resolved. Run independent tickets in parallel only when their worktrees and code changes can actually merge safely; parallelism is not a target in itself.

8. Review committed integration changes against the recorded starting commit and the spec. The bundled `/skill:code-review` expects a fixed point and a committed diff; supply those and identify the spec explicitly. Fix findings with a single implementer, re-run checks and update the affected ticket evidence when needed. Do not call an empty diff a pass.

9. If a draft PR exists and the user authorized the update, mark it ready; otherwise report the branch as ready for human review.

10. Remove only ticket worktrees whose changes have been merged and verified. Preserve failed worktrees and branches for recovery; never force-remove them.

## Report

End with: tickets completed / total, the frontier that remains (if any), the branch or PR, what was verified versus not run, and anything a human still has to do.
