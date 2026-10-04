# SoL-Pi in Perfect Pi

Perfect Pi runs on Pi 1.0.2. It installs NVlabs/SoL-Pi at commit `e1a586af0ad8956f42ae5b26bba20e48fbf30e00` and loads it through `global/extensions/sol-pi.ts`. The original package entrypoint is filtered out with `extensions: []`; Pi core and the upstream SoL-Pi checkout are not patched.

## Current Profile

The managed source is `global/sol-pi.json`, synchronized to `~/.pi/agent/sol-pi.json`.

| Feature | Default | Integration |
| --- | --- | --- |
| Action Fusion | Enabled | edit/write accept optional `then_run`; commands execute through Pi's guarded nested bash pipeline |
| ObservationPack | Enabled | Large successful text results become handles after two full sends; `obs_recall` returns exact pages |
| Evidence-Preserving Reducer | Enabled with user authorization | Eligible diagnostic logs may be sent to `cpa/gemini-3.8-flash-high`; exact evidence is checked and usage is included in tool results |
| Online Context Compact | Disabled | Available through trusted project configuration; preserves Pi's native compaction implementation |

Run `/sol-pi` to see the effective configuration path, feature flags, pinned source, and approved reducer route. Run `node doctor.mjs` to verify the managed package HEAD, resource filter, configuration and runtime version.

## Guarded Fusion

Use `then_run` only for bounded validation commands. Dev servers and watchers remain owned by the `process` capability.

The nested bash command passes through `tool_call`, argument validation, CLI restrictions, and guardrails. A blocked or nonzero command is reported as `[then_run:failed]` with an error tool result. The mutation is retained, not rolled back. Mutation failure prevents command execution.

This adapter fixes two incompatibilities in the original SoL-Pi implementation on Pi 1.0.2: direct invocation of the bash definition bypasses guardrail hooks, and returned `isError` results were incorrectly labeled successful.

## Evidence and Reducer Policy

The user authorized default remote reduction of eligible diagnostic logs. This is not permission to send credentials, secrets, or arbitrary files. SoL-Pi's likely-secret detector is a precaution, not a complete data-loss prevention system. Disable reduction for sensitive repositories.

The reducer route is fixed to `cpa/gemini-3.8-flash-high`. A project file cannot silently change it to an expensive or unapproved provider. Provider URLs and credentials stay in Pi's private configuration. If the route is unavailable, reduction fails, a receipt is invalid, or the request budget is exhausted, the original log is retained.

The adapter permits at most 20 reducer requests per session, persisted across resume and reload. The source length, output token cap, and timeout are inherited from the pinned upstream implementation. Reducer usage is included even when a response is rejected and the log falls back. Nested fused validation is reduced once, not again at its parent edit/write result.

Receipts verify quotations against archived content. They do not prove diagnostic completeness; diagnosis and final pass/fail decisions still belong to the primary agent.

Observation archives are kept under the session's `sol-pi/<session-id>/` directory. Even `--no-session` can create retained temporary archives. No automatic cleanup is introduced.

## Project Configuration

A trusted project's `.pi/sol-pi.json` replaces the global file; values are not merged. Include every feature you want to retain. For a sensitive project:

```json
{
  "version": 1,
  "actionFusion": true,
  "observationPack": true,
  "evidencePreservingReducer": false,
  "onlineContextCompact": false,
  "cacheWriteReadRatio": 12.5
}
```

To try online compaction in a trusted project, set `onlineContextCompact` to true. The ratio is a fixed economic-policy input, not a price guarantee. Keep it aligned with the provider's billing conditions before interpreting savings. Perfect Pi's `keepRecentTokens: 20000` matches the upstream standalone estimate.

`update_plan` is session-local execution progress; it is not the issue tracker and does not change triage roles, claims, or verified ticket completion. Keep step IDs stable and register unfinished steps before completing them. Use it during execution, not to force compaction during unresolved grilling or spec/ticket authoring.

## Verification

The upstream full suite passes on its original Pi 0.85.1 target (195 tests). Running that unmodified source against 1.0.2 exposed type errors and the failed-command classification bug; this integration therefore does not claim blanket upstream compatibility.

Perfect Pi adds real AgentSession adapter tests for guarded fusion, nested execution evidence, nonzero exit, mutation failure, CLI restrictions, exact archive recall, reducer fallback/accounting, verified receipts, and the 20-request budget. Upstream's selected 15 compaction/recovery/package integration tests also passed against an isolated Pi 1.0.2 dependency set. Live provider authentication, end-to-end terminal rendering and savings benchmarks remain separate checks.

Run:

```bash
node setup.mjs --skip-package-install
node doctor.mjs
node --test *.test.mjs
node skill-audit.mjs
```

SoL-Pi adapter tests require its pinned package installed through setup. They use deterministic faux responses, not remote providers.

## Rollback

Set all four feature flags to false in the effective config, then `/reload` or restart Pi. Global changes must also update `global/sol-pi.json` in the repository or the next setup will restore the managed profile. Preserve archives and session logs so old evidence remains available. Removing the adapter without disabling its managed registration is temporary: setup restores owned resources.

## Sources

- https://github.com/NVlabs/SoL-Pi/tree/e1a586af0ad8956f42ae5b26bba20e48fbf30e00
- https://github.com/NVlabs/SoL-Pi/blob/e1a586af0ad8956f42ae5b26bba20e48fbf30e00/docs/compatibility.md
- https://github.com/NVlabs/SoL-Pi/blob/e1a586af0ad8956f42ae5b26bba20e48fbf30e00/SECURITY.md
