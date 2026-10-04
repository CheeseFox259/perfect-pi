# Pi Runtime Compatibility

Perfect Pi treats Pi updates as a continuing compatibility requirement, not an automatic environment upgrade.

## Version Policy

- `manifest.json:piVersion` is the reviewed baseline. Doctor continues to report a different installed version as `DRIFTED`.
- `node scripts/check-pi-updates.mjs` queries the official npm package's stable release and reports patch/minor/major updates. It changes no pins or resources.
- `node scripts/check-pi-compatibility.mjs` checks required Pi exports, settings APIs, the settings-storage bridge, and actual loading of every managed TypeScript extension. Version drift is reported separately from API compatibility.
- `node scripts/check-sol-pi-contract.mjs --json` verifies the pinned SoL-Pi checkout and its imported module contracts.

## Continuous Verification

`.github/workflows/pi-compatibility.yml` runs on pull requests, main/master pushes, a daily schedule, and manual dispatch. It installs Pi only in an isolated GitHub runner. Two jobs test the manifest baseline and npm's latest stable release against the same pinned SoL-Pi revision. Each runs the compatibility checks, regression suite and skill audit without provider credentials or remote model requests.

The workflow has read-only repository permissions. It does not create pull requests, move pins, publish packages, change local environments, or automatically accept a new major version. A failed latest-version job is a canary requiring investigation, not permission to suppress a failing test.

## Upgrade Procedure

1. Run the update check and read the candidate's official changelog, configuration, compaction and extension documentation.
2. Verify API contracts and lifecycle behavior against the candidate in an isolated runtime. Pay particular attention to session replacement, cancellation, trust, provider authentication, settings persistence and usage accounting.
3. Adapt affected modules and add regressions. Preserve local consent, budget, phase-boundary, guardrail and resource-ownership policies.
4. Run the regression suite, both contract checkers and skill audit. For terminal UI changes, exercise the actual selector/rendering paths, including cancellation and concurrent tools.
5. Advance `manifest.json:piVersion` only after review and evidence. Updating the live runtime or syncing managed resources requires separate approval; restart/reload and run doctor afterward.

## Compaction Model

The global user preference lives in `<agent-dir>/settings.json`:

```json
{
  "perfectPiCompaction": {
    "provider": "cpa",
    "model": "gemini-3.8-flash-high"
  }
}
```

`manifest.json:defaultSettings` initializes this preference only when absent. Setup preserves later user choices. Project settings do not override this route. The reducer model and its session consent/request budget remain independent.

Use Palette -> Settings -> Compaction Model or `/compaction-model` to select an authenticated model. `/compaction-model provider/modelId` sets an exact registered route; `/compaction-model status` shows the current route. Changes apply to the next compaction, not one already running. The selected provider receives the conversation being summarized, so choose a provider you trust.

The extension uses Pi's native `compact()` through `session_before_compact` for manual, capacity/overflow and OCC compaction. It retains the native summary format, split-turn behavior, previous summary, kept-entry boundary, tracked file lists and usage. It does not switch the conversation model or change when compaction triggers. A missing model, authentication failure or failed summary warns and falls back to the current conversation model. User cancellation never starts a fallback request.

Pi 1.0.2 has no public setter for extension-owned global preferences. The extension isolates its internal `FileSettingsStorage.withLock` dependency so writes use the same file lock and preserve unrelated settings. The compatibility canary explicitly tests this bridge. Prefer a native public settings/model-selection API if Pi adds one; do not silently bypass file locking when the bridge changes.
