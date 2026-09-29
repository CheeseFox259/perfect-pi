---
name: wayfinder
description: Plan large ambiguous efforts as a tracker-backed map of decision tickets, resolving one decision at a time until implementation is ready to route.
disable-model-invocation: true
---

# Wayfinder

Wayfinder charts a route to a destination. It is planning, not implementation. Its tickets resolve decisions or unblock decisions; they are not implementation tickets and must never use `Triage`/`Execution` as their state machine.

Read `docs/agents/issue-tracker.md` before tracker work. If it is missing, stop and direct the user to `/skill:setup-matt-pocock-skills`. Use the tracker's Wayfinding operations section for map storage, child relationships, native blocking, frontier queries, claims, and resolution. If the repository has no configured tracker, stop rather than inventing commands.

## Decision-ticket model

A map has a destination, notes, decisions so far, not-yet-specified fog, and out-of-scope boundaries. Each child decision ticket has:

```text
Type: research|prototype|grilling|task
Status: claimed|resolved
Blocked by: none|01, 02
```

`Status` is only for decision tickets. Implementation tickets use the separate metadata contract from the execution ledger. A resolved decision does not unlock implementation by itself; it only makes the next planning decision or a later `to-spec`/`to-tickets` route possible.

Types are:

- `research` (AFK): independent facts from primary sources. Use the genuine `research` workflow, which writes a named Markdown result and cites sources. A blocking `subagent` is not background research.
- `prototype` (HITL): a throwaway artifact to make a logic or UI decision concrete. Read `~/.pi/agent/skills/prototype/SKILL.md`; preserve its throwaway status and link the artifact. Do not claim production behavior from a prototype.
- `grilling` (HITL): the default decision conversation. Read `~/.pi/agent/skills/grilling/SKILL.md` and `~/.pi/agent/skills/domain-modeling/SKILL.md`; use the native `question`/`questionnaire` interaction and never answer for the human.
- `task` (HITL or AFK): manual preparation needed before a decision can be made. Its result is a fact or artifact, not the destination implementation.

## Chart a map

1. Establish the destination with a frontier interview. Read context and ADRs first; use `grilling` plus `domain-modeling` instructions and record decisions as they settle.
2. Breadth-first identify only sharp questions that can be stated now. Put dependent, not-yet-sharp questions in the map's fog instead of pre-slicing them.
3. Create the map in the configured tracker with `wayfinder:map` where supported. Include destination, notes, empty decisions, fog, and out-of-scope boundaries.
4. Create currently specifiable child tickets, then wire their blocking relationships in a second pass. Prefer native tracker blocking; use the configured body convention only when native relationships are unavailable. Use names in human-facing narration and map summaries; retain IDs/URLs as links.
5. Start independent research tickets through the real research workflow. A research call may run in the background and must write a named result; read that result before resolving dependent decisions. Do not dispatch implementation or pretend a blocking subagent is detached.
6. Stop after charting. Do not resolve a ticket in the charting session.

If the frontier is empty because the destination is already clear and small enough for one session, do not create a map; route to `implement`, `to-spec`, or `to-tickets` as appropriate.

## Work through a map

1. Load the map at low resolution. Query child tickets and compute the frontier as open, unblocked, unclaimed decision tickets. Do not treat a ticket as available because an implementation state says so.
2. Select the named ticket or the first frontier ticket. Claim it before work by the tracker's configured claim operation. Never claim more than one non-research ticket per session; research tickets may run independently.
3. Read the ticket and only the related decisions needed. Execute one decision workflow: research, prototype, grilling, or task. For HITL work, wait for the human's answer. For prototype work, capture the verdict and pointer, not production code.
4. Record the answer in the ticket, set `Status: resolved`, and append a gist plus link to the map's Decisions so far. Then graduate newly sharp fog into new tickets through create-then-wire. If a ticket is out of scope, close it and record the boundary under Out of scope without treating it as a route decision.
5. Recompute the frontier after every resolution. Preserve concurrent sessions' tracker changes and stop on competing claims.

## Completion

The map is complete when no in-scope decisions remain and the destination can be expressed as an agreed spec or plan. Hand off to `/skill:to-spec` for deferred work or `/skill:to-tickets` for an approved multi-session spec. Do not claim implementation, end-to-end verification, runtime validated status, remote publication, or ticket completion beyond the evidence actually produced. Note that wayfinder is an upstream planning skill not yet adapted or end-to-end runtime validated for Pi; do not claim it has been runtime validated or is ready to run unattended. Report resolved decisions, remaining fog, frontier, artifacts, checks, and the next authorized route.
