---
name: maintain
description: Inspect upstream skill and component updates, audit local overrides, perform 3-way diffs and guided merges while preserving local enhancements. Use when asked to 'check updates', 'update skills', 'maintain perfect-pi', or 'reconcile'.
---

# Perfect Pi Maintain & Upstream Reconciler

Maintain the integrity of the Perfect Pi engineering harness, its upstream skill sources, and its local overrides.

## Core Philosophy: 3-Way Lineage Tracking

Perfect Pi uses an explicit three-way lineage model for all components recorded in `components.json`:
- **Base**: The exact upstream commit (`pinnedRef`) when the component was introduced or overridden.
- **Upstream**: The latest remote upstream commit from official repositories (e.g., `mattpocock/skills`).
- **Local**: Our enhanced version containing local capabilities (e.g., interactive TUI `questionnaire` dispatch, `e` key amendments).

When upstream updates occur, your goal is to incorporate upstream algorithmic/methodology improvements while **100% preserving local enhancements**.

---

## Workflow Steps

### Step 1: Inspect Status

Run the status check to discover remote updates and local override health:

```bash
node reconcile.mjs status --json
```

Read the JSON output:
1. Check `upstreams`: Identify if any source has `status === "UPDATE_AVAILABLE"`.
2. Check `overrides`: See which locally modified skills are linked to that upstream and what their `preservedFeatures` are.

### Step 2: Report to the User

- If all upstreams are **UP_TO_DATE**:
  - Inform the user that all upstream skills and local overrides are fully aligned.
  - Summarize the active local overrides (`grilling`) and custom skills (`route`, `verify-product`, `project-architecture`).
  - Stop here unless the user requests a diff review.

- If updates are available:
  - Present a concise, structured briefing:
    - Which upstream has new commits (`pinnedRef` -> `remoteHead`).
    - Which local overrides are affected.
    - Summary of local features that must be safeguarded.

### Step 3: Diff Analysis & Guided Decision

When an override is affected or when the user requests inspection:
1. Run `node reconcile.mjs diff <skill>` to examine the local enhancement delta against the base.
2. Formulate the upgrade strategy and present it using the `questionnaire` tool:
   - **Option A (Recommended)**: 3-Way intelligent merge — Incorporate upstream improvements and automatically retain all local enhancements (`questionnaire` dispatch, `e` key amend).
   - **Option B**: Upstream-only upgrade — Upgrade all non-overridden skills to the new commit, but keep local overrides pinned at the current base ref.
   - **Option C**: Review granular diff before deciding.

### Step 4: Execution & Verification

1. When an upgrade is approved:
   - Update `pinnedRef` in `manifest.json` and `components.json`.
   - For overrides, execute `git merge-file` (or `node reconcile.mjs 3way-test <skill>`) to verify clean merge without syntax corruption.
   - Run `node setup.mjs --skip-package-install` to sync to `~/.pi/agent`.
   - Run `node doctor.mjs` to ensure all 12 diagnostic checks are `SYNCED`.
2. Commit changes with a descriptive message (e.g. `chore(upstream): reconcile mattpocock/skills to <ref> preserving TUI enhancements`).
3. Report final confirmation and suggest `/reload`.
