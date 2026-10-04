# Pi 1.0.2 Update and SoL-Pi Integration Assessment

Status: assessment followed by initial implementation. The upstream Pi runtime remains unmodified at 1.0.2; the pinned SoL-Pi package is now installed through a Perfect Pi adapter. No live remote model call was made during verification.

## Inspected Versions

- Active CLI: Pi 1.0.2, verified with `pi --version`.
- Perfect Pi manifest: Pi 1.0.2, eight configured packages (seven npm packages plus the pinned SoL-Pi Git package).
- SoL-Pi: package version 0.1.0, inspected Git commit `e1a586af0ad8956f42ae5b26bba20e48fbf30e00`.
- Source: https://github.com/NVlabs/SoL-Pi/tree/e1a586af0ad8956f42ae5b26bba20e48fbf30e00
- Pi release source: installed `CHANGELOG.md`, sections 1.0.1 and 1.0.2; https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md

## Pi Update Summary

Pi 1.0.1 adds project overrides for global MCP servers (`enabled`, `exposure`, `toolExposure`), OAuth Client ID Metadata Documents, `registerToolRenderer()`, Cloudflare Clef classifiers, Nix installation, and a copy key for OAuth URLs. Anthropic tools added or redefined during a conversation are now represented inline to preserve the cached prompt prefix.

Relevant fixes include a vulnerable brace-expansion dependency, bounded codemode output (16 Mi characters or 100000 items), image rendering, MCP rendering on resumed sessions, model-at-capacity retries, and provider-specific authentication, IDs, and pricing fixes.

The published npm package no longer contains npm-shrinkwrap.json. npm installations do not pin transitive dependencies; the managed pi.dev installation is recommended for pinned dependencies. Migration is optional and needs separate compatibility checks because Perfect Pi currently finds its host through global node_modules roots.

Pi 1.0.2 adds `samplingParamsByThinkingLevel` to models.json for OpenAI-compatible APIs. Model defaults, effective thinking-level overrides, and request-level overrides merge in that order. It does not require changing existing model configuration.

Recommendation: align manifest.piVersion and current-version documentation to 1.0.2 after verification. Keep existing theme, compaction, model selection, and skill pins. Do not modify credentials or personal models.json just to adopt an optional sampling feature.

References:

- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md

## SoL-Pi Capabilities

1. Action Fusion replaces edit/write with compatible tool definitions that accept optional then_run. A successful file mutation can be followed by a validation command before returning, avoiding a separate model turn. Failed commands leave the mutation in place.
2. ObservationPack archives eligible successful, pure-text tool results larger than 10 KiB. Full results participate in two provider requests, then later context projections use stable handles and excerpts. obs_recall retrieves exact UTF-8 pages. Stored Pi session history is not rewritten.
3. Evidence-Preserving Reducer sends eligible long diagnostic logs to a configured reducer model. It checks archived-source hashes and exact quotations before accepting a smaller receipt. Failed checks or unavailable models leave the original result unchanged. Exact quotation checks do not prove that a summary includes every relevant error.
4. Online Context Compact registers update_plan and uses completed registered steps as candidate native-compaction boundaries. Window pressure and cache economics gate compaction; successful compaction schedules task continuation. It adds no second ticket tracker but does add model-authored working-plan state.

Source references:

- https://github.com/NVlabs/SoL-Pi/blob/e1a586af0ad8956f42ae5b26bba20e48fbf30e00/README.md
- https://github.com/NVlabs/SoL-Pi/blob/e1a586af0ad8956f42ae5b26bba20e48fbf30e00/docs/compatibility.md
- https://github.com/NVlabs/SoL-Pi/blob/e1a586af0ad8956f42ae5b26bba20e48fbf30e00/docs/configuration.md
- https://github.com/NVlabs/SoL-Pi/blob/e1a586af0ad8956f42ae5b26bba20e48fbf30e00/SECURITY.md

## Integration Findings

### Compatibility Is Not Yet Certified

SoL-Pi's official full-suite compatibility claims cover Pi 0.85.1 and 0.84.2, not 1.0.2. Peer dependencies use `*`, which is not a tested-version guarantee. The upstream agent installation guide asks for all four mechanisms enabled and Pi 0.85.1; this proposal deliberately uses a staged profile on 1.0.2 instead.

The actual Pi 1.0.2 extension loader loaded the unmodified SoL-Pi entrypoint without errors. An isolated AgentSession with a deterministic faux provider registered edit/write, obs_recall, and update_plan, and completed one fused write/command. This is a startup and basic-execution smoke test, not a full compatibility or savings benchmark.

### Action Fusion Bypasses Bash Tool Hooks

`src/sol-pi/extensions/action-fusion/then-run.ts:113` calls the bash definition's execute method directly. Perfect Pi's guardrails inspect top-level tool_call events and dispatch by tool name. The outer write/edit remains visible, but the nested shell command does not pass through the normal bash event pipeline.

Verified with a harmless fixture: a tool_call handler rejected every bash call, while a fused write with `then_run: { command: "printf fused-check" }` still returned `[then_run:succeeded]`. The handler saw zero bash events. No dangerous command was executed.

Enable Action Fusion only after adapting execution to `ctx.executeTool("bash", args, { signal })`, or an equivalent tested native-pipeline integration. Preserve CLI tool restrictions, command/path guards, cancellation, errors, nesting records, and accounting. If the nested bash tool is unavailable, fail closed for then_run instead of falling back to direct execution. Check downstream reducers so nested bash output is not reduced twice. An approval rejection after a mutation is not a rollback; report both outcomes explicitly.

### Reducer Calls Bypass Current Child-Model Policy

Perfect Pi's subagent-policy.ts only handles tools named subagent and research. SoL-Pi's reducer calls modelRegistry.complete() inside a tool_result handler, so the existing model approval flow does not cover it.

Configure an explicit approved reducer route rather than retaining the upstream default `openai-codex/gpt-5.6-luna`. A candidate is Perfect Pi's existing cheap-child route `cpa/gemini-3.8-flash-high`, subject to provider availability and budget validation. This is a proposed route, not a tested call. Require a dedicated reducer permission/budget decision before activation; models must not change their own route. Sensitive logs must not be sent remotely. The likely-secret detector is only a precaution.

Upstream journals provider usage but the returned replacement result does not include that usage. Verify and integrate reducer cost accounting, including failed/fallback attempts, before reporting net savings. Do not assume journal entries appear in Pi's normal cost totals.

### Native Compaction Needs End-to-End Tests

SoL-Pi's OCC code performs compaction and continuation from agent_settled. Pi 1.0.2 documentation describes agent_before_settle as actionable and agent_settled as final notification, although the runtime still defers actions requested during settlement. Test actual continuation and termination, not only imports or handler registration; prefer the current actionable-boundary contract if adaptation is necessary.

Perfect Pi's keepRecentTokens is 20000, matching SoL-Pi's standalone estimate. Keep native window-pressure protection enabled. Do not assume cacheWriteReadRatio 12.5 describes the user's proxy, subscription, or current provider pricing. Select it from the real billing policy before enabling economic compaction, and account for changing models.

Keep update_plan as transient execution progress, not triage/claim/verified-ticket authority. Avoid economic phase-boundary compaction during unresolved grilling/spec/ticket authoring. Validate preservation of authorization, acceptance, and worktree pointers.

### Managed Installation Requires Git Support

Perfect Pi setup.mjs currently parses npm: sources only in packageSpec/packageDirectory/installedPackageMatches. A git: entry can be installed through Pi but never passes the current installed-package check, causing repeated installation and a persistent doctor failure.

Add Git-source detection using Pi's own package resolution or authoritative package metadata; compare configured identity, resolved checkout, and actual HEAD with the pinned commit. Do not invent another clone cache or assume arbitrary checkout paths. Add tests for missing checkout, mismatched HEAD, idempotent sync, skip-install, and unrelated user packages.

### Config and Tool Ownership

Manage one user-level sol-pi.json with installer ownership protection. A trusted project .pi/sol-pi.json replaces, rather than merges, that file. Doctor/status should show the effective config path and four actual flags, including project override and disabled mechanisms.

Register SoL-Pi tools before the capability loader restores an active tool selection. Verify obs_recall remains reachable while archived placeholders are used, but never bypass explicit CLI restrictions. If recall is explicitly unavailable, disable packing rather than leave unreachable evidence. Test resume, tree navigation, reload, and child-session inheritance.

Action Fusion and pi-cc-extensions may both affect tool rendering. Define the composed renderer behavior and verify it in the actual TUI; do not replace a tool definition solely to change its renderer when registerToolRenderer is sufficient.

Archives remain local under the session-derived sol-pi directory. Even --no-session creates retained temporary archive files. Do not claim this mode leaves no files. Make retention visible; never silently delete active evidence or existing user archives.

## Proposed Rollout

### Phase 1: Host Alignment and ObservationPack

- Align manifest.piVersion/documentation to 1.0.2; keep existing unrelated package and skill pins.
- Pin SoL-Pi's Git source to `e1a586af0ad8956f42ae5b26bba20e48fbf30e00`, not a floating branch. Record source/ref in managed component metadata without requiring skill-directory conventions for this plugin repository.
- Extend setup/doctor with Git-source checks and ownership-aware sol-pi.json sync.
- Enable only observationPack. Keep actionFusion, evidencePreservingReducer, and onlineContextCompact false.
- Preserve module loading order and ensure exact recall remains available under normal and restored tool selections.
- Validate Pi 1.0.2 compatibility in an isolated checkout, then test the complete Perfect Pi extension set.

Proposed initial effective config:

```json
{
  "version": 1,
  "actionFusion": false,
  "observationPack": true,
  "evidencePreservingReducer": false,
  "onlineContextCompact": false,
  "cacheWriteReadRatio": 12.5
}
```

The ratio is inactive while OCC is disabled; it is not a claim about billing. Do not use the upstream preflight's --require-all-enabled flag for this intentionally partial profile.

### Phase 2: Safe Action Fusion

Use a minimal, versioned compatibility patch or adapter that routes then_run through Pi's tool pipeline. Prefer upstream acceptance; if an adapter cannot override the execution path through a public hook, use an explicitly tracked patched SoL-Pi package rather than pretending a wrapper makes the direct executor safe. Never load the original and patched Action Fusion simultaneously, and do not modify Pi core or unrelated installed package files.

Require guardrail, CLI-restriction, timeout/cancellation, mutation-failure, nonzero-command, and nested-result tests before enabling. Keep long-running dev servers owned by the existing process capability.

### Phase 3: Opt-In Reducer

Select and authorize the reducer provider/model, decide which logs may leave the machine, add budget/accounting and fail-open validation, then run controlled log-reduction trials. Exact quotation validity is necessary but not sufficient; compare diagnostic completeness against full logs.

### Phase 4: Opt-In Online Compaction

Integrate update_plan as execution-only progress, calibrate the economic ratio, and validate native compact-and-continue behavior under TUI, print, JSON, RPC, resume, cancellation, and parallel worker sessions. Keep the native compactor; do not add another memory or ticket system.

## Acceptance and Rollback

- Existing 77 Perfect Pi tests, doctor, and skill audit pass.
- SoL-Pi full source checks run on an isolated Pi 1.0.2 dependency set, including real-session integration and repeated compaction/continuation. Do not globally downgrade Pi or present its 0.85.1 tests as proof for 1.0.2.
- Large successful text results are packed after two full sends; every recalled byte/page matches the archive, including Unicode, resume, fork, and compact paths. Errors and images remain intact.
- Fused shell calls cannot escape the guards or explicit CLI restrictions; the relevant tool_call/tool_result events fire.
- Reducer route, remote-data permission, and cost accounting are explicit and tested, with fallback preserving evidence.
- A/B trials use the same model/task/cache conditions and compare quality, verification results, provider requests, total tokens, latency, and actual billed cost, including reducer and compaction overhead. No percentage-savings promise before measurement.
- Rollback disables the four flags and reloads, or removes only the managed plugin registration. Retain archives and session logs so existing evidence remains recoverable.

## Checks Actually Run During Assessment

- `pi --version`: 1.0.2.
- `node doctor.mjs`: DRIFTED only for pi runtime (manifest 1.0.0 versus installed 1.0.2); the remaining reported items are SYNCED.
- `node --test '*.test.mjs'`: 77 passed, 0 failed.
- `node skill-audit.mjs`: ok; 32 adapted, 10 portable, 4 native; no errors.
- `node reconcile.mjs status --json`: all three skill upstreams UP_TO_DATE, source pins aligned.
- Real Pi extension loader: SoL-Pi entrypoint loaded, zero loader errors.
- Isolated faux-provider AgentSession: all four mechanisms registered; one fused write/printf executed; zero extension errors; two fake provider requests; zero bash tool_call events despite a bash-rejecting interceptor.
- SoL-Pi source package installed at its pinned commit; managed adapter and `sol-pi.json` are now installed.

## Initial Implementation Verification

The user approved proceeding, enabled default remote reduction through `cpa/gemini-3.8-flash-high`, and chose online compaction as project opt-in.

- Current profile: actionFusion=true, observationPack=true, evidencePreservingReducer=true, onlineContextCompact=false.
- `node --test *.test.mjs`: 91 passed, zero failures. Thirteen SoL-Pi tests include guarded nested execution, timeout and error outcomes, CLI restrictions, exact archives, repeated session-start configuration changes, reducer fallback usage, verified quotations, and a 20-request session budget. Installer tests also cover Git HEAD drift, filtering, and idempotence.
- Adapter strict TypeScript check against the isolated Pi 1.0.2 dependency set: passed.
- Upstream original Pi 0.85.1 source checks: typecheck, all 195 tests, and package inspection passed. Its locked development dependencies reported two high vulnerabilities; they were not installed into the user's runtime.
- Upstream unmodified source against isolated Pi 1.0.2: typecheck failed; 193/195 runtime tests passed. One functional failure incorrectly labeled a nonzero fused command as successful; the adapter replaces that executor. One installation-guide assertion still expects the original target dependency version. No tests were weakened to claim full compatibility.
- Selected upstream Pi 1.0.2 compaction/recovery/package tests: 15 passed, including repeated native compact-and-continue behavior.
- Complete current Perfect Pi extension set: offline AgentSession loaded and bound with zero errors, exactly one SoL-Pi adapter, and active obs_recall.
- Not run: live reducer/provider authentication, terminal rendering coexistence, remote cost measurements, or controlled task-quality A/B benchmarks.

See ../sol-pi.md for the current supported profile and rollback instructions.
