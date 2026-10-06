# Perfect Pi

A versioned Pi environment for full-stack engineering with Matt Pocock Skills as the methodology layer. The reviewed runtime baseline is recorded in `manifest.json:piVersion`.

- [中文使用指南](docs/USAGE.zh-CN.md)

## Source of truth

`manifest.json` owns managed runtime settings, package versions, pinned MCP declarations, Skill source commits and Skill visibility policy. `global/` and `skills/` own local Pi resources. `setup.mjs` installs missing Skills from the pinned upstream commits in the manifest; existing Skills remain untouched when their source pin is unchanged. It preserves user-specific provider/model settings and unrelated packages. A small ownership registry in `~/.pi/agent/.perfect-pi-state.json` lets sync remove only files it previously installed. If a destination file was independently changed before ownership was recorded, setup refuses to overwrite it.

```bash
node setup.mjs --dry-run
node setup.mjs
node doctor.mjs
```

Package install can be skipped for isolated configuration tests with `--skip-package-install`; Skill install can be skipped with `--skip-skill-install`. Skipped installs retain the last known source ref. Doctor reports absent dependencies/Skills as `MISSING` and changed or unknown source pins as `DRIFTED`. `manifest.json` also pins the host runtime in `piVersion`; doctor compares it with the installed `@earendil-works/pi-coding-agent` and reports `pi runtime` as `SYNCED`, `DRIFTED`, or `MISSING`, so a Pi upgrade surfaces as a version-contract change instead of silent drift. `PI_GLOBAL_NODE_MODULES` adds explicit search roots when Pi lives outside the standard global `node_modules`.

For an intentional migration of existing physical upstream skill files, use `--adopt-overrides` (first with `--dry-run`). Only registered override files are eligible; their previous contents are backed up under `~/.pi/agent/.perfect-pi-backups/` before ownership is recorded. Unrelated resources and user-owned symlinks remain protected. Materializing an upstream symlink preserves its companion references without modifying the shared upstream directory.

## Entry points

- `/skill:route` recommends one next workflow and stops. It does not run the route.
- Pi-adapted workflows own grilling, implementation, tickets, code review, handoff, triage, and wayfinding. Interactive decisions use `question`/`questionnaire`; session answers and authorization carry forward.
- `/verify`, `/ui-check`, and `/release-check` are short repeatable evidence workflows.
- Use `/skill:code-review` for working-tree changes (including untracked files), committed diffs, or current-tree snapshot audits. Ordinary reviews need no tracker. `/skill:implement` uses working-tree review before committing. `/skill:handoff` records a continuation pointer.
- `/skill:maintain` audits runtime/package/skill/MCP updates, reconciles overrides and requires complete integration plus bounded evidence before reporting success.

## Managed MCPs

Codebase Memory adds structural code-graph discovery; Context Mode adds local document FTS5 retrieval. Setup synchronizes their pinned declarations and exact tool allowlists without replacing personal servers. Execution, deletion, auto-upgrade and native context-mode hooks are excluded from the default integration. Read [the MCP workflow and ownership guide](docs/managed-mcp.md) for authorized indexing, narrow legacy adoption, storage, recovery and smoke verification.

Doctor checks configuration/ownership, not MCP runtime health. `node scripts/check-managed-mcp.mjs --smoke` exercises native Pi transport and temporary-fixture functional workloads; it may download pinned dependencies. npx pins top-level package versions, not transitive dependencies through a repo lockfile. Reload resources after authorized sync; restart Pi when the host runtime changes.

## Implementation ladder

Implementation routing first asks whether agreed decisions need to outlive this session, then whether the work fits one session.

| Route | When | Produces |
|-------|------|----------|
| `/skill:implement` | Fits one session, direction already agreed | The change itself, via TDD at pre-agreed seams |
| `/skill:to-spec` | Agreed work deferred to another session or subagent | A concise spec of decisions, acceptance and testing in the tracker |
| `/skill:to-tickets` | More than a session of work, from an existing spec or plan | Vertical-slice tickets with blocking edges |
| `/skill:implement-spec` | An approved spec that already has a ticket graph | Verified integration branch; independent tickets may use parallel worktrees |

`/skill:route` recommends the next path without executing it. `to-spec`, `to-tickets`, and `implement-spec` require `docs/agents/issue-tracker.md`. The local implementation-ticket contract keeps triage eligibility separate from `open`, `claimed`, and verified `complete`; only integrated and verified tickets unblock dependencies.

### Per-repo tracker setup

`/skill:setup-matt-pocock-skills` writes configuration once per repo: `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`, and an `## Agent skills` block in `AGENTS.md` (pointing to existing guidance where appropriate). Local specs live in `.scratch/<feature>/spec.md` and tickets in `.scratch/<feature>/issues/`. Commit approved task artifacts before dispatching worktrees.

GitHub/GitLab ticket bodies remain authoritative for requirements. Remote graphs use a versioned local execution ledger with remote URLs and a one-to-one ticket mapping for claims, failed attempts and verified commits. Remote issue closure alone never unlocks a dependency. External publication and PR writes use existing explicit authorization; missing authorization leaves a concrete local draft. Triage and wayfinder have Pi-native workflows; live remote tracker behavior still needs validation in the target project.

## Maintenance & Upstream Lineage

`components.json` tracks upstream pin baselines, custom skills, and local overrides. `reconcile.mjs` audits upstream git references and ensures local enhancements (such as interactive TUI questionnaire dispatch in `grilling`) are preserved during upstream upgrades.

```bash
node reconcile.mjs status       # Check remote upstream updates and override health
node reconcile.mjs diff grilling # Inspect delta between upstream base and local enhancement
node reconcile.mjs 3way-test grilling --upstream-ref <commit> # Test the actual incoming version
node reconcile.mjs status --offline --json # Check registry pin alignment without network
```

## Runtime Updates

Pi updates are a continuing compatibility requirement. A daily, read-only CI canary tests the pinned runtime and npm's latest stable version with the same SoL-Pi pin. It never upgrades a user environment or advances pins automatically. See [runtime compatibility and upgrade policy](docs/pi-compatibility.md).

```bash
node scripts/check-pi-updates.mjs
node scripts/check-pi-compatibility.mjs
node scripts/check-sol-pi-contract.mjs --json
```

## Context and runtime measurements

```bash
node measure.mjs /path/to/project
node observe.mjs /path/to/pi-session.jsonl
node route-smoke.mjs /tmp/route-results.json
```

`measure.mjs` runs one tiny no-tool Pi request to collect assembled prompt sections, the actually active tool set, local schema estimates, and provider-reported first-request usage. Set `PI_EVAL_MODEL=provider/model` to pin measurement and route probes. Budget warnings default to 6,000 estimated tool-schema tokens and 8,000 initial input tokens, including cache; override with `PI_TOOL_SCHEMA_BUDGET` and `PI_INITIAL_INPUT_BUDGET`. `observe.mjs` reads existing JSONL events. These scripts do not rewrite accounting. Schema estimates are comparable locally; provider token counts and costs need the same model and cache conditions for fair comparison.

## Capabilities

- Pi-adapted Matt Skills provide the engineering workflow. The managed inventory is 42 upstream skills (32 local adaptations, 10 portable unchanged) plus 4 Pi-native skills. See [the compatibility inventory](docs/skill-audit-remaining.md); `node skill-audit.mjs` checks coverage, lineage, visibility and known incompatible invocation patterns.
- New sessions retain Pi/package active defaults, including ordinary `web`, `browser`, `lsp`, `process`, `research`, and MCP discovery/resource helpers; Perfect Pi no longer filters those groups out. `/tools` remains the manual selector; `/tools reset` restores runtime defaults plus registered direct capability groups. Session selections persist, explicit CLI allow/deny lists remain authoritative, and hidden/deferred server tools or advanced package loaders are not automatically promoted.
- Subagent model policy is enforced before tool execution. By default, `subagent` and `research` children use `cpa/gemini-3.8-flash-high` with thinking `high`; models outside the allowlist are blocked. A user can explicitly authorize one for the current session with `/subagent-model allow provider/model`, then revoke it with `/subagent-model revoke provider/model` or reset with `/subagent-model reset`. The model cannot authorize itself.
- Spec ticket parallel execution with tmux: `scripts/tmux-tickets.mjs` and the `tmux_tickets` tool provide parallel multi-session dispatch for ticket graphs. Independent frontier tickets run in separate tmux windows inside isolated git worktrees with a live ANSI observability dashboard in Window 0, real-time log streaming, and status tracking.
- `pi-matt-subagent` provides blocking parallel agents and background research; Perfect Pi adds a model-inheriting `implementer` role for ticket worktrees.
- `pi-web-access` provides web research and fetch; external-system access comes from the built-in `mcp` extension and the configured MCP servers, reached after the `mcp` capability group is enabled.
- `pi-agent-browser-native` exposes browser verification after enabling the `browser` capability, with additional advanced tools loaded through its native loader. Install upstream `agent-browser` separately and keep it on `PATH`.
- SoL-Pi is pinned as a Git package and loaded once through a Perfect Pi adapter: guarded edit/write validation, exact observation recall, and evidence-checked log reduction are enabled; native online compaction is project opt-in. Reducer calls use `cpa/gemini-3.8-flash-high`, with a 20-request session limit and tool-result usage accounting. See [SoL-Pi configuration, evidence policy, and rollback](docs/sol-pi.md).
- Native `codemode`/`tool_search` integrate batching and MCP discovery; global key entry uses a masked dialog, while trusted project MCP profiles contain no credentials. Prototype image generation waits for a user-returned clipboard/file image instead of requiring an image API. See [native workflow configuration and safety](docs/native-workflows.md).
- Compaction uses a separate global model, defaulting to `cpa/gemini-3.8-flash-high`. Set it through Palette -> Settings -> Compaction Model or `/compaction-model provider/modelId`; `/compaction-model status` shows the route. It applies to manual, automatic and OCC compaction without switching the conversation model. Setup preserves your selection. See [configuration and fallback behavior](docs/pi-compatibility.md#compaction-model).
- Model Habits: `global/extensions/model-habits.ts` dynamically loads concise model-specific quirk correction rules (`habits/<model>.md`) into `<rules>` during `before_agent_start`. The matching key is provider-agnostic, with a progressive fallback chain, ≤ 800-character budget, zero prompt overhead for models without habits, and `/habits` TUI inspection/editing commands. See [Model Habits documentation](docs/native-workflows.md#model-habits-per-model-habit-corrections).
- LSP, managed processes, deterministic guardrails, and `pi-cc-extensions` support verification and UX.

`observe.mjs` aggregates all native usage kinds without summing nested usage twice; `requests` remains assistant responses. `measure.mjs` estimates schemas from the actual CLI declarations rather than a different SDK loadout. Neither command proves new tools reduce cost without a comparable workload.

## Verification tiers

- Tier 0: direct query or bounded change, minimal tool use, cheap relevant verification.
- Tier 1: normal bug or feature, appropriate implementation/diagnosis workflow and code checks.
- Tier 2: user-facing or high-risk behavior, app runtime, browser critical path, and console/network evidence when available.

For product-level completion, use `verify-product`. Results must distinguish verified, not run, blocked, and not applicable.

User-specific credentials, sessions, models, and unrelated settings stay local. SoL-Pi is the explicitly managed efficiency integration; its working plan never replaces the ticket tracker. Do not install additional plan, todo, memory, context-pruning, or subagent systems.

## Checks

```bash
node --test *.test.mjs
node skill-audit.mjs
node doctor.mjs
PI_EVAL_MODEL=provider/model node route-smoke.mjs /tmp/route-results.json
```

Unit and integration tests exercise the actual Pi extension loader/TUI handlers, isolated installers, real Git merge fixtures, read-only Pi evaluation subprocesses, and capability loading. Route probes call the configured model. These checks do not certify arbitrary applications, live GitHub/GitLab mutations, production deployment, or every optional external runtime.
