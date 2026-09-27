# Perfect Pi

A versioned Pi environment for full-stack engineering with Matt Pocock Skills as the methodology layer.

## Source of truth

`manifest.json` owns managed runtime settings, package versions, Skill source commits and Skill visibility policy. `global/` and `skills/` own local Pi resources. `setup.mjs` installs missing Skills from the pinned upstream commits in the manifest; existing Skills remain untouched when their source pin is unchanged. It preserves user-specific provider/model settings and unrelated packages. A small ownership registry in `~/.pi/agent/.perfect-pi-state.json` lets sync remove only files it previously installed. If a destination file was independently changed before ownership was recorded, setup refuses to overwrite it.

```bash
node setup.mjs --dry-run
node setup.mjs
node doctor.mjs
```

Package install can be skipped for isolated configuration tests with `--skip-package-install`; Skill install can be skipped with `--skip-skill-install`. Doctor then reports absent dependencies/Skills as `MISSING` and changed source pins as `DRIFTED`.

## Entry points

- `/skill:route` recommends one next workflow and stops. It does not run the route.
- Matt's explicit workflow skills own grilling, implementation, tickets, wayfinding, code review, and handoff.
- `/verify`, `/ui-check`, and `/release-check` are short repeatable evidence workflows.
- Use `/skill:code-review` and `/skill:handoff` as the canonical review and handoff entries.

## Context and runtime measurements

```bash
node measure.mjs /path/to/project
node observe.mjs /path/to/pi-session.jsonl
node route-smoke.mjs /tmp/route-results.json
```

`measure.mjs` runs one tiny no-tool Pi request to collect assembled prompt sections, the actually active tool set, local schema estimates, and provider-reported first-request usage. `observe.mjs` reads existing Pi JSONL events for usage/cache, compaction, skill loads, and tool categories. Neither installs a context manager or rewrites token accounting.

## Capabilities

- Matt Skills provide the engineering workflow.
- `pi-matt-subagent` provides blocking parallel agents and background research.
- `pi-web-access` and `pi-mcp-adapter` provide web and external-system access.
- `pi-agent-browser-native` exposes a compact always-on browser surface and lazily activated advanced tools. Install upstream `agent-browser` separately and keep it on `PATH`.
- LSP, managed processes, deterministic guardrails, and `pi-cc-extensions` support verification and UX.

## Verification tiers

- Tier 0: direct query or bounded change, minimal tool use, cheap relevant verification.
- Tier 1: normal bug or feature, appropriate implementation/diagnosis workflow and code checks.
- Tier 2: user-facing or high-risk behavior, app runtime, browser critical path, and console/network evidence when available.

For product-level completion, use `verify-product`. Results must distinguish verified, not run, blocked, and not applicable.

## Roadmap & Backlog

- **Upstream Component Version Migration**: Build an automated helper workflow/script to audit upstream Matt Pocock skill diffs against local overrides (such as `skills/grilling`) and streamline semver/ref upgrades without regressing local TUI enhancements.

User-specific credentials, sessions, models, and unrelated settings stay local. Do not install duplicate plan, todo, memory, context-pruning, or subagent systems.
