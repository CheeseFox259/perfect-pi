# SoL-Pi in Perfect Pi

Perfect Pi runs on Pi 1.0.2. It installs the patched SoL-Pi fork from `CheeseFox259/SoL-Pi` at commit `93fd67a833da1b6236cf2582f02f7a6454d6d941` (derived from upstream `NVlabs/SoL-Pi@e1a586af0ad8956f42ae5b26bba20e48fbf30e00`) and loads it through `global/extensions/sol-pi.ts`. The original package entrypoint is filtered out with `extensions: []`; Pi core is not patched.

### Upstream Fixes in the Patched Fork

The upstream `NVlabs/SoL-Pi` OCC implementation suffered from three known failure modes that are resolved in this fork:

1. **Stale Request Horizon (Over-Compaction Loop):** `state.completedBoundaryRequestCounts` accumulated intervals across compactions, inflating future request predictions in late phases and causing repeated back-to-back compactions on already-small contexts. Fixed: `recordCompaction` now resets the request count interval history.
2. **`pendingProgress` Loss in Summaries:** While `update_plan` collected detailed progress summaries (files changed, decisions, verifications), the compaction runner ignored them and sent a generic static string. Fixed: `buildCompactionInstructions` now formats the collected step progress and embeds it directly into the summarizer prompt.
3. **Removable Prefix Overestimation:** `estimateNativeCompactionTokens` computed cut points without bounding them against actual provider-visible projected tokens, causing false economic compaction triggers on tiny sessions. Fixed: the removable prefix estimate is strictly bounded by visible projected tokens minus `keepRecentTokens`, and a minimum 1,000-token net savings threshold is enforced.

## Current Profile

The managed source is `global/sol-pi.json`, synchronized to `~/.pi/agent/sol-pi.json`. System runtime policy is owned by `manifest.json:solPi` (single source of truth), ensuring that `sol-pi.json` cannot select an unauthorized or unbudgeted route.

| Feature | Default | Integration |
| --- | --- | --- |
| Action Fusion | Enabled | edit/write accept optional `then_run`; commands execute through Pi's guarded nested bash pipeline |
| ObservationPack | Enabled | Large successful text results become handles after two full sends; `obs_recall` returns exact pages |
| Evidence-Preserving Reducer | Enabled with **session consent** | Authorized route locked to `manifest.json:solPi.reducerPolicy`; first use prompts the user via TUI confirm (or pre-authorize from Ctrl+Shift+P → SoL-Pi → Authorize reducer); consent does NOT inherit to subagents or new sessions; capped at 20 reqs/session |
| Online Context Compact | Disabled | Project opt-in via `sol-pi.json`; when enabled, uses upstream SoL-Pi's economic model with `update_plan` step boundaries. Workflow-Aware Compaction (below) describes the preferred architecture for phase-boundary triggers when Matt Pocock skills are active |

Run `/sol-pi` to see the effective configuration path, feature flags, pinned source, and approved reducer route.
Run `node doctor.mjs` to verify the managed package HEAD, contract compatibility, reducer model availability, and runtime versions.
Run `node scripts/check-sol-pi-contract.mjs` to audit the 7 required modules and 11 exported function signatures against upstream.
Run `node observe.mjs <session.jsonl> --summary` to generate the SoL efficiency and token avoidance report.

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

## Workflow-Aware Compaction (Runtime-Enforced Contract)

The table and gates below are actively enforced by `global/extensions/sol-pi.ts` consuming the machine-readable contract [`skills/ask-matt/phase-contract.json`](../skills/ask-matt/phase-contract.json).

- **Proactive / Economic Compaction (OCC)**: Governed at turn boundaries. When reasoning skills (`grilling`, `tdd`, `diagnosing-bugs`) are active or durability deliverables are not yet on disk, OCC evaluation is suppressed, preventing premature turn abortion and context loss.
- **Context Capacity Compactions (`threshold` and `overflow`)**: Normal, necessary compactions triggered when context limits are reached. They execute directly and silently without veto, warning, or user interruption.
- **Manual `/compact`**: Commands from the user or the Ctrl+Shift+P palette execute immediately under user authority.

Perfect Pi adopts a **Workflow-Aware Compaction** model that unites Matt Pocock's phase structure with SoL-Pi's economic cost model:

$$\text{Compaction} = \text{SafePhaseBoundary (Matt Skill)} \land \text{EconomicBenefit (SoL Cost Model)}$$

$$\text{Ticket Execution} = \text{Fresh Context (Ticket + Spec + Repo Rehydration)}$$

### Phase Boundary Policy Matrix

| Workflow / Skill | Mid-Workflow Compaction | Completion Boundary | Runtime Behavior |
|---|---|---|---|
| `grill-me` / `grill-with-docs` | **Forbidden** | Optional | Preserve continuous reasoning across exploring and stress-testing |
| `to-spec` | **Forbidden** | Eligible | Conversation rationale compiled into persistent `SPEC.md` anchor (`CHECKPOINT_COMPACT`) |
| `to-tickets` | **Forbidden** | **Strong Boundary** | Spec decomposed into vertical slices; context disposable (`RESET_ELIGIBLE`) |
| `implement` | Inside ticket: cautious | **Hard Boundary** | Fresh context per ticket (`FRESH_CONTEXT`); rehydrate from ticket + spec + git commit |
| `tdd` | Red-Green: **Forbidden** | Post-refactor | Keep failing test assumptions, hypotheses, and diagnostic traces intact |
| `diagnosing-bugs` | Cautious | Checkpoint | Forbid until reproduction is verified; checkpoint once root-cause is isolated |
| `code-review` | Within pass: **Forbidden** | Complete | Review pass stays intact; markdown report persists as durable artifact |

### Three Context Operations

1. **`SOFT_COMPACT`**: Retain the current session and compact conversational history. Appropriate during long exploratory grilling or debugging sessions when context exceeds token thresholds.
2. **`CHECKPOINT_COMPACT`**: The phase produced a durable artifact (`SPEC.md`, `tickets.md`, `research.md`). The artifact replaces loose chat rationale as the new context anchor.
3. **`FRESH_CONTEXT`**: Recommended for `/implement`. Do not compact or summarize past implementation chat. Start a fresh context with the ticket, spec reference, blocking tickets, and latest git commits.

### Three Compaction Gates

Before triggering any compaction, three gates must be satisfied:

- **Gate A (Durability Gate)**: Have the phase's deliverables been written to disk and verified? (Spec written, tickets recorded, commit created). If not, **fail-closed** (keep context).
- **Gate B (Semantic Dependency Gate)**: Does the next step require raw conversational history, or can it operate strictly from the durable artifact? If raw history is required, compaction is withheld.
- **Gate C (Economic Gate)**: Does SoL-Pi's cost model indicate that $\text{ExpectedTokensSaved} > \text{CacheRewriteCost}$? If rewriting cache is uneconomic, keep context intact.

### Externalize First, Summarize Second

Context is the active working set; it is not long-term memory. Summaries generated by LLMs are lossy and must never become the primary source of truth. The source of truth is always externalized:
- Logs $\to$ `ObservationPack` (`obs://...`)
- Design $\to$ `SPEC.md`
- Tasks $\to$ Ticket graph
- Code changes $\to$ Git commits and test suites

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
