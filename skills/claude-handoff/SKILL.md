---
name: claude-handoff
description: Compatibility command for a Pi handoff followed by blocking subagent continuation or a separate user-started Pi session.
disable-model-invocation: true
---

Retain `/skill:claude-handoff` as a compatibility command. Read and follow the advertised `handoff/SKILL.md` to create a Pi handoff file, then read [the Pi workflow contract](../setup-matt-pocock-skills/references/pi-workflow-contract.md).

If the user requested immediate delegated continuation, use an appropriate installed role in a blocking `subagent` call with `tasks: [{ agent: <role>, task: <handoff pointer and scope>, cwd: <explicit worktree> }]`. For approved implementation, use the managed `implementer` role. Create an isolated worktree before delegation when edits could overlap the parent. Uncommitted files do not automatically appear in a new worktree: commit authorized task artifacts or provide an explicit safe snapshot and instructions first. Pass the existing authorization and constraints without widening them. Report the result after the call returns.

If a separate interactive exchange is needed, or `subagent` is unavailable, give the user the handoff path and a continuation prompt for a separate Pi session in the named worktree. Say that the user must start that session; do not claim it has started. HITL questions remain with the human.

There is no detached coding job in this workflow. Only the `research` tool supports genuine background research; never use it to disguise implementation as research. Do not launch a Claude process or invent a background flag for Pi.
