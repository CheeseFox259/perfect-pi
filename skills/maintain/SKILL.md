---
name: maintain
description: Inspect upstream skill and component updates, audit local overrides, perform 3-way diffs and guided merges while preserving local enhancements. Use when asked to 'check updates', 'update skills', 'maintain perfect-pi', or 'reconcile'.
---

# Perfect Pi Maintain & Upstream Reconciler

Maintain the integrity of the Perfect Pi engineering harness, its upstream skill sources, and its local overrides.

## Core Philosophy: 3-Way Lineage Tracking

Perfect Pi uses an explicit three-way lineage model for all components recorded in `components.json`:
- **Base**: The upstream commit recorded as each override's `baseRef`; the source-wide installed target is `upstreams[source].pinnedRef`.
- **Upstream**: The latest remote upstream commit from official repositories (e.g., `mattpocock/skills`).
- **Local**: Our enhanced version containing local capabilities (e.g., interactive TUI `questionnaire` dispatch, `e` key amendments).

When upstream updates occur, your goal is to incorporate upstream algorithmic/methodology improvements while **100% preserving local enhancements**.

---

## Workflow Steps

### Step 1: Inspect Status

Run the Pi update and compatibility checks as well as the Skill lineage check:

```bash
node scripts/check-pi-updates.mjs
node scripts/check-pi-compatibility.mjs
node scripts/check-sol-pi-contract.mjs --json
node reconcile.mjs status --json
```

For a Pi runtime update, read `docs/pi-compatibility.md` (or `<agent-dir>/docs/pi-compatibility.md` outside the repository) and follow its upgrade procedure. Report version drift separately from API compatibility. Do not advance `manifest.json:piVersion`, install a new live runtime, or sync managed resources without approval. Baseline/latest CI results are compatibility evidence, not automatic upgrade authorization.

Read the JSON output:
1. Check `upstreams`: Identify if any source has `status === "UPDATE_AVAILABLE"`.
2. Check `overrides`: See which locally modified skills are linked to that upstream and what their `preservedFeatures` are.
3. If `diff` or `3way-test` fails with `Path 'skills/<name>/SKILL.md' not found at ref`, the registry's `upstreamRelPath` is wrong, not the pin. Upstream nests every skill under a category directory (`skills/engineering/...`, `skills/productivity/...`, `skills/in-progress/...`, `skills/misc/...`); resolve the real path with `git ls-tree -r <ref> --name-only | grep '/<name>/SKILL.md'` and correct every override before trusting any merge result.

### Step 2: Report to the User

- If all Skill upstreams are **UP_TO_DATE** and there is no Pi update or compatibility failure:
  - Inform the user that all upstream skills and local overrides are fully aligned.
  - Summarize the active local overrides and custom skills, read from `components.json`: entries under `skills` with `type: "override"` are local overrides, `type: "custom"` are harness-only skills. Read the list from the registry rather than naming it, so the summary cannot drift as overrides are added.
  - Stop here unless the user requests a diff review.

- If Skill or Pi updates are available, or a compatibility check failed:
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
   - **Perform actual 3-way merge**: Retrieve the actual new upstream file at `remoteHead` (e.g., from upstream git cache or fetch). The three inputs to `git merge-file` must be the local enhanced file (`<localPath>`), the base upstream file at `baseRef` (`<basePath>`), and the target new upstream file (`<upstreamLatestPath>`):
     ```bash
     git merge-file -p -L local-enhancement -L upstream-base -L upstream-latest <localPath> <basePath> <upstreamLatestPath>
     ```
     Do NOT use a selfmerge (merging base against itself or local against itself) as upgrade verification; a selfmerge cannot test for real conflicts between new upstream changes and local enhancements.
   - Verify the merge exits with 0 conflicts and inspect the output to ensure local enhancements are fully preserved alongside upstream improvements.
   - Write the cleanly merged content to `<localPath>`.
   - **Maintain correct ref fields**: Update `manifest.json` at `skills[].ref` for the source and `components.json` at `upstreams[source].pinnedRef`. Advance a reconciled override's `baseRef` only after merging and verifying all its changed companion files as well as `SKILL.md`. If Option B was chosen, leave the override's `baseRef` unchanged. Never add a `pinnedRef` field to the manifest.
   - **Upstream deletes or moves a skill**: a moved skill keeps its content under a new path, so repoint `upstreamRelPath` at the head path before merging. A deleted skill leaves nothing to merge: either drop it from `manifest.json` `requiredSkills`, its cross-references and the inventory doc, or keep the capability by copying the last upstream file into `skills/<name>/SKILL.md` and registering it as an `override` whose `baseRef` stays at the last commit that carried the file, with a `description` saying upstream retired it. A merge that conflicts only on Pi command spelling or execution semantics is expected; resolve it toward the local adaptation and confirm every upstream change survives in adapted form.
   - Run `node setup.mjs --skip-package-install` to sync to `~/.pi/agent`.
   - Run `node doctor.mjs`, the repository tests, and the skill compatibility audit. Report the actual statuses; a clean merge alone does not validate runtime behavior.
2. Commit the reviewed files only when local commits are covered by the user's authorization; preserve unrelated edits. Use a descriptive message (e.g. `chore(upstream): reconcile skills preserving Pi adaptations`).
3. Report final confirmation and suggest `/reload`.
