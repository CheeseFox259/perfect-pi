# Managed Code and Document MCPs

Perfect Pi declares reviewed MCP packages and exact tool allowlists in `manifest.json:mcpServers`. `components.json:mcpServers` records their upstream sources and selected integration mode. Setup installs the managed launcher code and synchronizes only these server entries in `<agent-dir>/mcp.json`; personal servers, top-level settings and private credentials remain user-owned.

## Optional Server Defaults

`manifest.json:mcpDefaults` initializes `ask-user-questions` and `MiniMax` with `enabled: false` when they are already configured and have no explicit enabled preference. Setup does not install, claim ownership of, or delete these personal servers; existing commands, tool exposure, environment settings and private keys are preserved. Explicit later `enabled: true` or `false` choices survive setup. MiniMax onboarding also creates a disabled entry.

Native `question`/`questionnaire` remain the default interactive path; native web tools remain the default search path. The optional servers are retained for asynchronous questions or MiniMax search/image understanding when deliberately enabled. Codebase Memory and Context Mode remain unchanged.

Run `/reload` after syncing configuration so the current session applies the disabled state. Enable an optional server through `/mcp` when needed, or use `/mcp-project MiniMax on codemode` (similarly for `ask-user-questions`) for a trusted project's override. Doctor checks default initialization, not whether a user's explicit choice matches the default.

## Setup and Ownership

```bash
node setup.mjs --help
node setup.mjs --dry-run --skip-package-install --skip-skill-install
node setup.mjs --skip-package-install --skip-skill-install
node doctor.mjs
node scripts/check-managed-mcp.mjs
node scripts/check-managed-mcp.mjs --smoke
```

Setup does not start MCP servers. The pinned `npx` packages are installed on the first authorized runtime connection. This can download a native CBM executable or compile context-mode's SQLite dependency; a config-only `SYNCED` result does not prove those prerequisites succeeded. `--smoke` uses Pi's actual MCP connection/transport and a temporary repository, never personal servers or model requests. It verifies versions, required tools, allowlist policy, graph indexing/search/call tracing/coverage, document indexing/search and bounded connection cleanup. npm requires working package/release access; a failed native asset download is a blocker, not a green integration result.

For the two previously configured, unversioned `npx -y` entries, use the explicitly authorized migration:

```bash
node setup.mjs --dry-run --skip-package-install --skip-skill-install --adopt-mcp
node setup.mjs --skip-package-install --skip-skill-install --adopt-mcp
```

Adoption accepts only the reviewed simple legacy shape (same server/package, no custom env, URL, executable or tool policy). Other collisions and edited managed fields fail before setup writes resources. Ordinary sync is idempotent and compares entries with the last ownership snapshot under `.perfect-pi-state.json`. The server's enabled state/exposure remains a user preference; exact tool exposure is managed policy. New upstream tools default to hidden. For intentional tool-policy changes, update the manifest allowlist and verify it rather than editing the generated global entry.

Removing a declaration removes only a still-owned unchanged server entry. Edited entries cause refusal; data is retained. To roll back a version/policy, restore the previously reviewed manifest declaration and run setup; it compares against the current ownership snapshot. This does not reinstall the Pi runtime. npx pins the top-level package, not all transitive dependencies through a repository lockfile; treat dependency installation as a trusted local code execution, not supply-chain isolation.

## Codebase Memory

Use for cross-file structural discovery, architecture and call relationships. Native grep/read remain appropriate for exact source text, and the existing LSP remains responsible for diagnostics and source fixes.

1. Enable `mcp` with `capabilities` when inactive, then inspect `describeNamespace("mcp__codebase_memory")` or `searchTools()` for exact schemas.
2. Check `index_status`/`list_projects`; index only the authorized repository when needed. Obtain the returned project identity instead of guessing it. Cache storage is `<agent-dir>/mcp-data/codebase-memory`.
3. Use bounded `search_graph`, `trace_path`, `get_architecture` or `query_graph` calls. Resolve findings to current source with `get_code_snippet`/native `read` and targeted `check_index_coverage`. Graph absence alone cannot prove dead code, complete impact or exhaustive coverage; record generation/pagination/gaps.
4. Native `manage_adr`, `delete_project` and `ingest_traces` are hidden. Repository ADR changes still use the existing domain-modeling workflow and normal ownership rules.

No auto-install client augmentation, upstream agent/skill injection or native installer is invoked. CBM may manage its own indexing daemon and watchers; only processes belonging to the connection are shut down. Do not kill unrelated processes by name. Different active CBM builds/cache roots can conflict; inspect reported admission errors rather than resetting another session's cache.

## Context Mode

Use `ctx_index`/`ctx_search` for authorized local document or output collections and BM25 retrieval. Prefer bounded source labels and queries. Stored data is under `<agent-dir>/mcp-data/context-mode`; it is local plaintext and may contain supplied code/documents. Same-user processes can access it. Inspect only authorized paths and never index credential files. `ctx_index` can write its local database even though it does not perform arbitrary host execution.

`ctx_stats` measures calls/data handled by this server, not the whole Pi session and not independently benchmarked token savings. Native codemode, SoL-Pi observations/reducer, process management and compaction remain the primary execution/context lifecycle paths.

`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_fetch_and_index`, `ctx_upgrade`, `ctx_purge` and `ctx_insight` are hidden. These would add arbitrary subprocess execution, network egress, automatic maintenance, deletion or a hosted dashboard path outside the selected purpose. `codemode` exposure is not an OS sandbox and does not make arbitrary external code obey Pi guardrails.

The pinned context-mode package includes a native Pi extension and skills. Those are **not loaded** in this MCP-only integration. Consequently there is no automatic Pi event capture, session continuity, routing interception or compaction hook from context-mode. Adopting its adapter requires a separate lifecycle/conflict review with SoL-Pi; installing an MCP server does not enable those capabilities.

## Verification and Reload

After config/code synchronization, `/reload` loads MCP entries and managed skills; reconnect through `/mcp` when necessary. A changed host Pi runtime requires a process restart, not only reload.

`node doctor.mjs` and the default checker are configuration/ownership checks. `--smoke` is native transport plus functional fixture evidence, not a model-driven codemode run or production-repository audit. Actual provider/OAuth/network workflows are separate checks. Keep these levels separate in maintenance reports.

Official sources: [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), [context-mode](https://github.com/mksglu/context-mode), installed Pi `docs/mcp.md` and candidate-version package metadata/tool schemas. Read `skills/maintain/references/integration.md` before expanding this boundary.
