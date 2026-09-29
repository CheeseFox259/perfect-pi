---
name: research
description: Investigate a question against high-trust primary sources and capture cited findings as a Markdown file in the repository. Use when the user wants research, documentation facts, or API evidence.
---

Spin up Pi's genuine background `research` tool for the reading legwork so the main session can continue. This is the only background dispatch in this skill family. Do not describe blocking implementation or exploration as background work.

The researcher must:

1. Investigate primary sources: official documentation, source code, specifications, and first-party APIs. Follow claims to the source that owns them.
2. Write all findings to one Markdown file, citing every material claim.
3. Match the repository's existing notes convention; if none exists, choose a sensible path and state it.
4. Stop when the question is answered. A bounded, sufficient result is better than an unrelated deep dive.

In Pi, pass the question, destination path, and `cwd` through the native `research` tool. If that tool is unavailable, do the research in the parent or use a blocking fact-finder subagent and say that genuine background research was unavailable. For web fetching, use `fetch_content` or `agent_browser`. Do not call a nonexistent Skill tool. Read any returned findings file before treating research as settled.

Do not perform live external writes. Fetching public sources is evidence gathering; changing third-party systems, publishing issues, or sending messages requires separate explicit authorization.
