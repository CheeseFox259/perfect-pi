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
3. Adapt every affected consumer and add regressions; search CLI tool filters, extension activation, settings locks, compaction and shutdown paths explicitly. Preserve local consent, budget, phase-boundary, guardrail and resource-ownership policies. Use `skills/maintain/references/integration.md` for new capabilities; connected servers and unchanged API exports alone are insufficient.
4. Run the regression suite, both contract checkers and skill audit. For terminal UI changes, exercise the actual selector/rendering paths, including cancellation and concurrent tools.
5. Advance `manifest.json:piVersion` only after review and evidence. Updating the live runtime or syncing managed resources requires separate approval. After installing a new Pi runtime, quit and restart the Pi process, then run doctor; `/reload` does not replace the running host runtime. After syncing only managed resources, use `/reload` and run doctor.

## Pi 1.0.4 Review

The reviewed baseline is Pi 1.0.4. Required API contracts, managed extension loading, the pinned SoL-Pi contract and repository regressions passed cleanly on the installed runtime. Evidence is recorded in `docs/experiments/pi-1.0.4-assessment.md`.

- `--tools` and `--exclude-tools` now support `*` patterns (e.g. `'mcp__*'`, `'mcp__radius__*'`), and `--no-mcp` disables MCP for one run. `--tools` preserves MCP tools unless explicitly filtered with `mcp__`. The skill trigger and description-improvement subprocesses now explicitly disable MCP, user extensions and ambient project instructions; tool selection alone is not an isolation boundary.
- `tools.read()` on image files now provides an image block for `image()`, enhancing codemode visual workflows.
- QuickJS built-in prototypes are frozen before codemode execution, preventing prototype tampering (`Array.prototype.toJSON = ...`).
- MCP OAuth sign-in properly registers native OpenID Connect clients, fixing `invalid_redirect_uri` on compliant endpoints. MCP session shutdowns safely await server connections.
- Prompt rules cleanly omit tools hidden by `prepareLoadout`, avoiding phantom tool confusion.

## Pi 1.0.3 Review

The reviewed baseline is Pi 1.0.3. Required API contracts, managed extension loading, the pinned SoL-Pi contract and repository regressions passed on the installed runtime. These checks do not prove every upstream provider or terminal fix end to end. Evidence and untested paths are recorded in the repository-only `docs/experiments/pi-1.0.3-assessment.md`; setup does not copy that assessment to the agent directory.

- Azure users must migrate `azure-openai-responses` to `azure` in their provider configuration, including authentication, model definitions, `defaultProvider`, `enabledModels` and `modelThinkingLevels`. `AZURE_OPENAI_*` environment variables are unchanged. Resumed sessions using the old provider may fall back and lose prompt-cache reuse. No repository-owned Azure configuration needs migration; maintenance does not inspect or rewrite private credentials.
- Codemode `image()` now adds a temporary file path alongside the visual attachment. Use the reported path, not a guessed filename or extension. Saving can fail while the attachment remains available; confirm that a path was returned before copying. A temporary path is not a durable project asset. This capability does not authorize an image API request or change prototype's web image handoff policy.
- Pi-created output files use user-only permissions (0600 on POSIX) and exclusive creation. Do not relax permissions or disclose files to another user or service without authorization. SoL-Pi's `obs_recall` uses its own observation archive; it is not a native Pi output-file reader.
- `Home`/`End` move the editor cursor to the line boundaries. `Ctrl+Home`/`Ctrl+End` navigate the fullscreen transcript. No managed extension explicitly binds those keys; actual terminal behavior remains an upstream runtime concern.
- Pi adds recovery handling for cancelled OAuth refresh, a removed running installation and a disappearing terminal. If an on-disk runtime update causes codemode errors, restart Pi rather than relying on `/reload`.

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
