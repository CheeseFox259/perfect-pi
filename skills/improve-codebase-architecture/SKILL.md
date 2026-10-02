---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present a visual HTML report, then grill through whichever one you pick.
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This skill uses the project's domain model and the `codebase-design` vocabulary: **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, and **locality**. Read the advertised `codebase-design` skill path (e.g. `~/.pi/agent/skills/codebase-design/SKILL.md` or `/skill:codebase-design`) before making suggestions. Read `GLOSSARY.md` and relevant ADRs first.

## Process

### 1. Explore

Scope before scanning. If the user named a direction, take it. Otherwise inspect a useful stretch of `git log --oneline` and let recent hot spots guide the scan. Read the domain glossary and relevant ADRs before proposing changes.

Use one blocking `subagent` call with an architecture-scout or equivalent review-capable role when available. Batch independent exploration tasks in its `tasks` array and give each an explicit `cwd`. A blocking call returns only after its tasks finish; it is not background work. If no suitable role or subagent tool is available, explore in the parent and disclose that independent delegation did not run. The subagent must read `~/.pi/agent/skills/codebase-design/SKILL.md` rather than invoking a Skill tool.

Look for shallow modules, leaking seams, scattered understanding, pure functions extracted only for testability, and hard-to-test interfaces. Apply the deletion test: if deleting a module merely moves complexity to callers, it is not earning its keep.

### 2. Present candidates as an HTML report

Write a self-contained report to the OS temporary directory, never the repository. Resolve the directory from `$TMPDIR`, falling back to `/tmp` on Unix or `%TEMP%` on Windows. Use the scaffold in `HTML-REPORT.md` (or `~/.pi/agent/skills/improve-codebase-architecture/HTML-REPORT.md`) as the format reference.

The report may use Tailwind and Mermaid CDNs as the upstream method specifies, but it must otherwise be static. Open it with the host command (`open`, `xdg-open`, or `start`) or inspect using `agent_browser` when available, and report the absolute path. Do not use a server for this report.

Each candidate includes files, problem, solution, locality/leverage benefits, a before/after diagram, and recommendation strength. End with a top recommendation. Use the exact architecture vocabulary and the project's domain terms. Do not propose interfaces yet. Ask: "Which of these would you like to explore?"

### 3. Grilling loop

After the user chooses a candidate, read `~/.pi/agent/skills/grilling/SKILL.md` and follow it. In an interactive Pi session, present frontier decisions through the native `question` or `questionnaire` extension, including recommended options, `allowOther: true`, and the `e` amendment path. In headless mode, use the documented Markdown fallback and wait for answers. Do not invoke a nonexistent Skill tool.

Read `~/.pi/agent/skills/domain-modeling/SKILL.md` when domain terms or ADRs need updating. Keep those updates inline as decisions settle. For alternative interfaces, read `~/.pi/agent/skills/codebase-design/DESIGN-IT-TWICE.md` (or `~/.agents/skills/codebase-design/DESIGN-IT-TWICE.md`) and use one blocking `subagent` call with a `tasks` array of 3 or more radically different design prompts; compare results by depth, locality, and seam placement.
