---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance in Pi. Use when users want to create a skill from scratch, edit or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.
---

# Skill Creator

A skill for creating new skills and iteratively improving them in Pi.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill (SKILL.md, scripts, references, assets)
- Create a few test prompts and run the agent with access to the skill on them
- Help the user evaluate the results both qualitatively and quantitatively:
  - Run evaluations in Pi-native blocking batches (both with-skill and baseline)
  - Draft quantitative assertions and evaluate them against outputs
  - Use `eval-viewer/generate_review.py` to view results and benchmark metrics
  - Review outputs and benchmark results using `agent_browser` or browser
- Rewrite the skill based on feedback from the user's evaluation and quantitative benchmarks
- Repeat until satisfied
- Optimize the skill description for accurate triggering in Pi

Your job when using this skill is to figure out where the user is in this process and help them progress through these stages.

---

## Communicating with the user

Pay attention to context cues to understand how to phrase your communication:
- "evaluation" and "benchmark" are borderline, but OK.
- For "JSON" and "assertion", clarify briefly unless the user indicates familiarity.
- Proactively explain the purpose of quantitative checks and qualitative reviews.

---

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., "turn this into a skill"). If so, extract answers from conversation history first — tools used, sequence of steps, corrections made, input/output formats.

1. What should this skill enable the agent to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What is the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them.

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Iron these out before writing test prompts.

Check available tools — if useful for research (searching docs, inspecting similar skills, looking up best practices), research inline before drafting.

### Write the SKILL.md

Fill in these components:
- **name**: Skill identifier (kebab-case, lowercase letters, digits, and hyphens only, max 64 chars).
- **description**: When to trigger and what it does. This is the primary triggering mechanism in Pi. Include both what the skill does AND specific user contexts/phrases for when to use it.
- **compatibility**: Required tools, dependencies (optional, rarely needed).
- **body**: Markdown instructions structured with progressive disclosure.

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) - Injected into Pi's system prompt `<available_skills>` list.
2. **SKILL.md body** - Loaded by Pi when the model invokes `read` on `SKILL.md`. Keep under 500 lines.
3. **Bundled resources** - Loaded on demand when referenced from instructions.

#### Principle of Lack of Surprise

Skills must not contain malware, exploit code, or any content that compromises system security. A skill's contents should not surprise the user in their intent.

#### Writing Patterns

- Prefer imperative instructions.
- Define explicit output formats with templates where relevant.
- Provide concrete input/output examples.
- Explain the **why** behind constraints rather than relying solely on uppercase MUST/NEVER directives.

### Test Cases

After writing the skill draft, come up with 2-3 realistic test prompts — what a real user would actually say. Share them with the user for review.

Save test cases to `evals/evals.json`:

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

See `references/schemas.md` for the full schema.

---

## Running and evaluating test cases

Organize results in `<skill-name>-workspace/iteration-1/eval-0/`, etc.

### Step 1: Run blocking batches (with-skill AND baseline)

In Pi, execute evaluations in **blocking batches** directly via Pi CLI or subprocess tasks:

**With-skill run:**
```bash
pi -p --no-session --skill <path-to-skill> "<eval prompt>"
```
Save outputs to `<workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/`.

**Baseline run:**
- **New skill**: Run with no skill:
  ```bash
  pi -p --no-session "<eval prompt>"
  ```
  Save to `<workspace>/iteration-<N>/eval-<ID>/without_skill/outputs/`.
- **Improving existing skill**: Snapshot the original skill first (`cp -r <skill-path> <workspace>/skill-snapshot/`), then run:
  ```bash
  pi -p --no-session --skill <workspace>/skill-snapshot "<eval prompt>"
  ```
  Save to `<workspace>/iteration-<N>/eval-<ID>/old_skill/outputs/`.

Write `eval_metadata.json` for each test case:
```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

Record duration and timing in `timing.json` in each run directory:
```json
{
  "duration_seconds": 23.3
}
```

### Step 2: Draft assertions

Draft quantitative assertions for each test case:
- Objectively verifiable checks (files exist, schema valid, specific content present).
- Descriptive assertion names that read clearly in the benchmark viewer.
- Programmatic checks where feasible.

Update `eval_metadata.json` and `evals/evals.json` with assertions.

### Step 3: Grade, aggregate, and launch viewer

1. **Grade each run**:
   Evaluate assertions against outputs using `agents/grader.md` guidelines or programmatic scripts. Save to `grading.json` in each run directory:
   ```json
   {
     "expectations": [
       {"text": "The CSV contains header row", "passed": true, "evidence": "Found header row 'date,revenue,cost'"}
     ]
   }
   ```
   The `expectations` array must use the fields `text`, `passed`, and `evidence`.

2. **Aggregate into benchmark**:
   Run the aggregation script:
   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```
   This generates `benchmark.json` and `benchmark.md` with pass rates and deltas.

3. **Launch the viewer**:
   ```bash
   python <skill-creator-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "<name>" \
     --benchmark <workspace>/iteration-N/benchmark.json
   ```
   For iteration 2+, pass `--previous-workspace <workspace>/iteration-<N-1>`.
   To write standalone HTML without starting a server, use `--static <output_path>`.

4. **Review results**:
   Use `agent_browser` to navigate to `http://localhost:<port>`, inspect the outputs and benchmark tabs, or have the user review in their browser.
   When reviews are submitted, feedback is saved to `<workspace>/iteration-N/feedback.json`.

5. **Read feedback**:
   Examine `feedback.json` to guide the next iteration.

---

## Improving the skill

1. **Generalize from feedback**: Do not overfit to specific test inputs; adjust principles and instructions.
2. **Keep the prompt lean**: Remove unhelpful sections and simplify over-complicated rules.
3. **Bundle repeated work**: If test runs repeatedly write similar helper scripts, package those scripts into `scripts/` within the skill.
4. **Iterate**: Snapshot revisions, rerun evaluations into `iteration-<N+1>/`, re-aggregate benchmarks, and confirm improvements.

---

## Description Optimization

The description in `SKILL.md` frontmatter determines whether Pi triggers the skill. After the skill workflow is finalized, optimize the description for triggering accuracy.

### How skill triggering works in Pi

- Pi registers skills in the system prompt `<available_skills>` block with their `name`, `description`, and `location` (path to `SKILL.md`).
- When a user query matches a skill's intent, the agent invokes the `read` tool on the skill's `SKILL.md` path.
- Evaluation runs:
  ```bash
  pi --mode json -p --no-session --tools read --no-skills --skill <temp-candidate-dir> -- "<query>"
  ```
  - `--tools read`: Restricts tool access to `read` only (no mutating tools like `bash`, `edit`, `write`).
  - `--no-skills`: Isolates the candidate skill, disabling discovery of other competing installed skills.
  - `--`: Argument separator ensuring queries starting with `-` are treated safely as positional arguments.
  - The evaluation harness parses the JSON event stream (`tool_execution_start`, `toolcall_end`, `message_end`) to verify exact read calls to the candidate `SKILL.md`.
  - API errors, process crashes, and timeouts are distinguished from negative triggers and fail the evaluation (errors are never rewarded as negative passes).

### Step 1: Generate trigger eval queries

Create 20 eval queries — 8-10 should-trigger and 8-10 should-not-trigger (near-misses). Save as JSON:
```json
[
  {"query": "concrete user prompt with context", "should_trigger": true},
  {"query": "adjacent prompt that should use standard tools", "should_trigger": false}
]
```

### Step 2: Review eval queries

Review queries with the user or render `assets/eval_review.html` for interactive verification.

### Step 3: Run the optimization loop

For long Python runs, use Pi's `process` tool (from the `pi-processes` skill) to launch and monitor in the background:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-eval-set.json> \
  --skill-path <path-to-skill> \
  --model <model-id> \
  --max-iterations 5 \
  --verbose
```

The loop:
- Evaluates candidate descriptions using isolated Pi JSON invocations.
- Proposes improved descriptions using `pi -p --no-session --no-tools --no-skills --no-context-files` with prompt over stdin, ensuring embedded prompts cannot execute commands or read project context.
- Propagates `--model` consistently to match the active session model.
- Evaluates train/test holdouts to prevent overfitting and produces an HTML summary report.

### Step 4: Apply the result

Take `best_description` from the optimization output and update the skill's `SKILL.md` frontmatter.

---

## Packaging

Package the completed skill into a distributable `.skill` file:
```bash
python -m scripts.package_skill <path/to/skill-folder>
```

---

## Dependencies

- All core scripts (`scripts.run_eval`, `scripts.improve_description`, `scripts.run_loop`, `scripts.aggregate_benchmark`, `scripts.generate_report`, `eval-viewer/generate_review.py`) use only the **Python standard library**.
- `scripts.quick_validate` and `scripts.package_skill` optionally require **PyYAML** (`pip install pyyaml`) for YAML frontmatter validation.
