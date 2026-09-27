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

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, code, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

### Session Completion

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Summarize the agreed design and settled decisions. Do not act on it until the user confirms you have reached a shared understanding.
