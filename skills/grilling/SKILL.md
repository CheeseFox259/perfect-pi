---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer.

### Interactive Round Execution in Pi

In an interactive Pi session, present the frontier questions through the interactive TUI rather than raw static markdown, allowing the user to quickly navigate, amend, or customize decisions:

1. **Round Briefing**:
   Briefly state the frontier context and the key architectural trade-offs or seam boundaries being evaluated in this round in 1-2 sentences.

2. **Invoke `questionnaire` (or `question` if exactly 1 question)**:
   - Include all settled-prerequisite frontier decisions as questions in the `questionnaire` tool call.
   - For each question:
     - `id`: Unique identifier (e.g., `q1_storage`, `q2_consistency`).
     - `label`: Concise tab label (e.g., `Q1: 存储选型`, `Q2: 缓存一致性`).
     - `prompt`: The full context and question text.
     - `options`: 2 to 4 concrete, actionable choices with informative descriptions.
     - Highlight the recommended option clearly in the label or description (e.g., `(推荐)` or `(Recommended)`).
     - Keep `allowOther: true` (default) so the user can:
       - Press `Enter` to select an option directly;
       - Press **`e`** on any option to amend/supplement it with custom constraints;
       - Select `Type something.` to provide an entirely custom answer.

3. **Fallback for Non-Interactive Environments**:
   If the session is running in non-interactive/headless mode (TUI not available), format the round as markdown questions with `❓ **Q1** - ...` and `➡️ <recommended answer>` and wait for input.

4. **Iterate the Tree**:
   Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and repeat with the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

### Fact-Finding vs Decisions

Finding _facts_ is your job, never the user's. Read the filesystem, code, tools, or documentation yourself when practical. Delegate independent fact-finding only when useful: Pi's `subagent` call is blocking, with concurrent work batched in a `tasks` array and an explicit `cwd` per task. Only the `research` tool runs genuinely in the background and writes findings to a named Markdown file. Read that file before treating a prerequisite as settled; do not claim background coding or exploration through a blocking subagent.

When background research is pending, its dependent questions wait; ask the independent frontier now. The _decisions_ are the user's: put them to the human with `question`/`questionnaire` and wait. A cancelled or unanswered tool call is not an answer.

### Session Completion

The session is done when the frontier is empty: every relevant branch is settled, with unresolved constraints stated explicitly. Summarize the agreed design. Existing session authorization carries forward: if the user already agreed to implementation or local documentation after settling these decisions, continue within that scope without another approval round. Otherwise ask only for the missing decision or authorization. Never let a preset option, elapsed time, or headless execution stand in for the human's answer.
