---
name: maintain
description: Maintain Perfect Pi runtime, packages, skills and MCP integrations. Use for updates, maintenance, reconciliation or adding a harness capability; audit lineage, permissions and complete integration with reproducible verification.
---

# Perfect Pi Maintenance

Maintenance ends with reproducible behavior and bounded evidence, not a changed pin or a connected server. Keep the repository as the source of truth and preserve local adaptations, consent, guardrails and personal configuration.

## 1. Establish Scope

Record `git status --short`, HEAD, task-owned files and pre-existing changes before editing. Read the repository manifest, component registry, installer and relevant tests; discover verification commands from the repo instead of assuming npm scripts. Resolve `<agent-dir>` from `PI_CODING_AGENT_DIR` or `~/.pi/agent`.

Record authorization separately for repository edits, runtime/dependency installation, live synchronization, external data requests and commits. Reuse authorization already granted; ask only for missing approval or unresolved choices. Inspection and `--help` must be side-effect free. Installation flags that skip work are not proof that dependencies were installed.

**Done:** scope, starting state, ownership and permitted side effects are explicit. Private credentials and unrelated edits are excluded.

## 2. Inventory All Managed Layers

Run from the repository:

```bash
node scripts/check-pi-updates.mjs
node scripts/check-pi-compatibility.mjs
node scripts/check-sol-pi-contract.mjs --json
node reconcile.mjs status --json
node doctor.mjs
```

Inspect `manifest.json` for all package and MCP pins as well as runtime and skills. Check official package/release metadata for each in-scope component; `reconcile` tracks registered Git sources, not every npm package. Distinguish version drift, API compatibility, config ownership and runtime health. Doctor's managed MCP result is configuration-only and does not start servers.

Read active overrides/custom skills from `components.json`. An old override `baseRef` may be intentional; source-wide alignment does not prove every override has incorporated head. For affected skills, read [lineage reconciliation](references/lineage.md).

**Done:** every in-scope layer has installed/pinned/candidate state or an explicit blocked/not-run reason. Stop for an audit-only request only when no drift, failures or requested integrations remain.

## 3. Review Sources and Impact

Use candidate-version official changelogs, documentation, package metadata and actual implementation/tool schemas. README feature claims alone are not verification. Inspect native Pi adapters even when choosing MCP-only integration; distinguish available upstream features from features actually enabled.

For Pi updates read `docs/pi-compatibility.md` and follow its procedure. Search all call sites affected by changed defaults, CLI flags and lifecycle APIs. In particular, audit `--tools`, `--no-tools`, MCP activation, user extension hooks, cancellation, shutdown, settings locks, compaction and accounting. Verify isolation with runtime evidence, not only export existence.

For new or changed capabilities read [integration acceptance](references/integration.md). Evaluate overlap, authority, storage, network egress, license and executable permissions. `codemode` controls exposure, not OS sandboxing or guardrails for an external process.

**Done:** a concise impact table names each change, affected consumer, adoption/defer decision, required adaptation and test. Features without a verified need remain explicitly deferred; tool names and performance numbers come from evidence.

## 4. Decide and Integrate

Present material tradeoffs through `questionnaire` when unsettled. For affected skill sources offer actual three-way reconciliation, non-overridden-only update with unchanged override bases, or granular review. Approved implementation proceeds without reopening decisions.

Implement repository declarations, ownership/sync, policy, workflow guidance, tests, diagnostics and removal/recovery together. Fixed package versions and complete Git refs are required. A live-only config edit is an experiment, not a completed harness integration. Preserve unmanaged server entries and secrets; claim legacy entries only through the explicit reviewed adoption path.

Advance a reviewed Pi baseline only after candidate evidence, and skill bases only after actual reconciliation of all affected companions. Keep approved-but-unverified targets visibly incomplete. Prepare the concrete diff before requesting any missing installation/sync approval.

**Done:** clean-environment setup can reproduce the intended configuration; personal edits are protected; security and lifecycle boundaries have executable regressions.

## 5. Verify Before and After Sync

Run focused regressions first, then the repo suite, API/SoL contracts and skill audit. Exercise real user paths in isolated fixtures: capability discovery, useful output, hidden tools, errors and bounded shutdown. The managed MCP workload probe is `node scripts/check-managed-mcp.mjs --smoke`; it may install the pinned packages and must be covered by installation authorization. Use the native runtime for integration evidence, not just raw protocol handshake.

Check `node setup.mjs --help`; preview the authorized migration with `--dry-run`. Only after review and appropriate permission, sync managed resources. Run doctor and runtime probes again after sync. Reload resources for a resource-only change; quit/restart for a changed host runtime. `/reload` cannot replace the running host runtime. Verify idempotence and private-config preservation without printing secrets.

**Done:** actual command exits and path results are recorded. Failed checks are fixed or leave the maintenance explicitly incomplete; old passing tests do not certify a new integration.

## 6. Deliver Evidence

Create/update a repository assessment with versions, source links, adoption decisions, task-owned changes, verification commands/results, limitations and restart instructions. Report **Verified**, **Not run**, **Blocked**, **Not applicable**. Separate connection, discovery, functional smoke, native integration and end-to-end evidence. Token savings, coverage and security claims require a defined measured scope.

Finish with the remaining risks and concrete recovery path. Commit only with commit authorization and only reviewed task-owned files. Preserve pre-existing work.

**Done:** another maintainer can reproduce the result and tell what was actually tested. Any unmet integration acceptance condition is labelled partial/blocked, never fully integrated.
