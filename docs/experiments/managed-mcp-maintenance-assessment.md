# Managed MCP and Maintenance Repair Assessment

## Scope

The user authorized completing the two MCP integrations, repairing the review findings and improving maintenance standards. Pre-existing Pi 1.0.3/skill reconciliation edits were preserved. No commit, push, provider request or private credential migration was performed. Pi remains at its already-installed 1.0.4 baseline.

## Decisions and Implementation

- `manifest.json:mcpServers` owns exact top-level package versions and tool allowlists; the component registry records official sources and MCP-only adaptations. Codebase Memory is `0.11.0`; Context Mode is `1.0.169`.
- Setup plans before writing, rechecks under the config lock, updates only declared/previously owned servers, records ownership and supports narrow explicit legacy adoption. Unknown flags and `--help` are side-effect free. Personal entries and enabled/server-exposure preferences are preserved; edited managed policies cause refusal. Untouched removed entries can be removed without deleting data.
- The public launcher filters ambient environment keys and preserves OS/configured nonsecret values resolved by native Pi before spawn. Public/private stdio is relayed with bounded output and EOF/SIGTERM/SIGINT shutdown; private-key servers additionally redact their selected key. Direct-execution detection compares real paths, covering macOS `/var` aliases and symlinked script directories. Tests cover an EOF-ignoring subprocess, process-group escalation, filtered environment and private-key behavior.
- Codebase Memory exposes 14 reviewed tools and hides ADR mutation, project deletion and trace ingestion. Graph/source/coverage guidance is supplied. Context Mode exposes only `ctx_index`, `ctx_search`, `ctx_stats`; arbitrary subprocess execution, network fetch, upgrade/purge/insight and the native Pi adapter are excluded. Unreviewed new tools are hidden.
- MCP data directories are created with POSIX 0700; setup tightens group/world permission drift on managed data directories. Configuration writes use 0600. Symlinked config/storage paths are rejected. This is same-user local storage, not encryption or an OS sandbox.
- Skill trigger and improvement subprocesses explicitly use `--no-mcp --no-extensions --no-context-files` alongside their native-tool restrictions. The fake-CLI regressions verify the actual argument lists; these are not paid/model-driven trigger experiments or a filesystem sandbox.
- `maintain` now inventories runtime/packages/skills/MCPs, reviews changed consumers, checks authorization and integration completeness, requires functional/failure/ownership evidence and verifies after synchronization. Its six ordered stages have explicit completion criteria. Lineage and integration reference documents preserve the actual three-way reconciliation requirements.
- Stale upgrade shortcuts and overclaims in prior documentation were corrected. A connection does not certify integration, server-specific stats are not global Pi savings and available upstream native adapters are not automatically enabled features.

## Runtime Investigation

Pinned CBM installation initially failed while its Node installer fetched a GitHub release asset. The same official `v0.11.0` macOS ARM64 tarball was downloaded with curl and its SHA-256 compared to the official release `checksums.txt`:

```text
4dee7f38b63740e6751d7a7ed7eb10291c1f2a3ea2415f599dc68370ca0a2d18
```

The exact npm package was installed into the newly created npx cache with `--offline --ignore-scripts`; the official package's archive-validation/extraction helper then installed only the verified native executable. Its reported version was 0.11.0. No cross-client `install`, auto-update, hook injection or upstream configuration writer was run. This was an environment-specific recovery, not evidence that future clean network downloads always succeed. npx uses `--prefer-offline` and an exact package version; transitive dependency versions are not frozen by a repository lockfile.

A second runtime failure was traced to the launcher's textual direct-execution path comparison on macOS aliases. After realpath detection was fixed, the full generated-config/launcher/native-Pi-transport path passed. An intermediate direct-npx smoke isolated package behavior, but the final smoke uses the generated launcher without bypassing it.

## Evidence

**Verified:** `node --test *.test.mjs` passed 219/219 (10 suites) after the repairs, including MCP ownership/adoption/removal/version drift/default-deny policies, private environment handling, symlinked launch/storage/config, side-effect-free help/unknown flags, dry-run privacy and evaluation CLI isolation. Pi API/extension compatibility and pinned SoL-Pi contracts passed. Skill audit passed (32 adapted, 10 portable, 4 native). `node scripts/check-managed-mcp.mjs --smoke` passed using native Pi connections and the generated launcher: CBM returned version 0.11.0 and 17 tools, indexed a temporary Python fixture, searched `audit_entry`, traced it to `audit_helper` and checked file coverage; Context Mode returned version 1.0.169 and 11 tools, indexed/retrieved the exact fixture fact. Allowlist/default-hidden decisions were checked using Pi's native exposure resolver. Connections were closed in `finally`; no personal MCP servers or model endpoints were contacted by the smoke.

**Not run:** A model-driven codemode E2E session, production-size repository quality/performance benchmarks, external OAuth/provider recovery, Windows/Linux native runtime execution, upstream adapter lifecycle tests, and CI execution for this change. These are not certified by the local unit/fixture checks. Automatic session memory and context-mode hooks were intentionally not enabled.

**Blocked:** No remaining local functional-smoke blocker. Fresh downloads require accessible npm/GitHub release endpoints and a compatible SQLite/native runtime. Installation failures must remain visible and cannot be converted into `SYNCED` runtime claims.

**Not applicable:** Production deployment, remote tracker mutations, publishing, new provider credentials, image-generation APIs and native host-runtime reinstall.

## Synchronization and Recovery

The authorized legacy adoption used setup's `--adopt-mcp` path; later syncs use the ownership snapshot without that flag. Post-sync doctor and the configuration checker reported SYNCED; native `pi mcp list` reported both pinned servers connected with excluded tools hidden. Read `docs/managed-mcp.md` for runtime checks, version/policy rollback and deliberate server removal. Reload managed resources/MCP configuration after sync. Restart the Pi process only when its host runtime has changed; this repair did not reinstall the host.

## Sources

- Official [Codebase Memory repository](https://github.com/DeusData/codebase-memory-mcp), `v0.11.0` npm package metadata, installer/extraction helper and tool schemas; [release checksums](https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.11.0/checksums.txt).
- Official [Context Mode repository](https://github.com/mksglu/context-mode), installed `1.0.169` package metadata, server/executor and native Pi adapter. Package metadata explicitly declares a Pi extension, contrary to the initial maintenance summary.
- Installed Pi `1.0.4` `docs/mcp.md`, CLI defaults, native MCP config/exposure/transport and connection implementation.
- Repository `scripts/managed-mcp.mjs`, `scripts/check-managed-mcp.mjs`, `scripts/mcp-launch.mjs`, `setup.mjs`, manifest and regression tests. Actual tool lists contain no separately named `impact_analysis`; no 12,000-15,000-token savings claim was measured.
