# Pi 1.0.4 Maintenance Assessment

## Scope and Decision

Review Pi 1.0.4 (released 2026-10-05) against Perfect Pi's previous 1.0.3 baseline. The runtime was already installed at 1.0.4 before the initial maintenance; that turn did not install Pi. API/export and extension-loading checks passed, and `manifest.json:piVersion` advanced to 1.0.4. These checks were not a complete changed-behavior review.

The initial turn left provider credentials and existing dependency pins unchanged. Later review found that skill-creator's `--tools read` assumption was broken by 1.0.4's MCP-preserving default; the follow-up repair explicitly disables MCP, user extensions and ambient project instructions for evaluation/improvement subprocesses. See `docs/experiments/managed-mcp-maintenance-assessment.md` for the corrective integration and evidence.

## Release Impact

| Change | Decision |
| --- | --- |
| Tool patterns (`*`) and `--no-mcp` | `--tools` and `--exclude-tools` accept wildcard patterns; native tool selection preserves MCP by default. The original evaluation isolation assumption required a fix, now covered by CLI argument regressions; do not infer read-only isolation from `--tools read`. |
| Codemode persists images from `tools.read()` | `tools.read()` on image files now resolves to an image block that `image()` can display. Preserves Perfect Pi's existing visual inspection workflows while enhancing codemode capability. |
| MCP OAuth OpenID Connect client registration | Fixes `invalid_redirect_uri` on servers using standard OIDC client registration (e.g. `mcp.modem.dev`). Managed `mcp-settings` extension remains unchanged. |
| MCP session shutdown safety | Fixes premature shutdown while servers are still establishing connection. Improves stdio and remote MCP transport lifecycle stability. |
| System prompt rules & skills hint refinement | Tools hidden by `prepareLoadout` are omitted from prompt rules; codemode declarations show tool guidelines (`ToolLoadout.getPromptGuidelines()`). Eliminates phantom tool confusion. |
| Bedrock HTTP/2 stalled stream retry | Automatic retry on cancelled streams; improves provider resilience. |
| Codemode prototype freeze | QuickJS built-in prototypes are frozen before user script execution, preventing accidental or malicious prototype poisoning (e.g. `Array.prototype.toJSON`). Protects harness integrity. |
| Fenced code block syntax highlighting | Fixes multiline string and comment color loss in interactive TUI transcript. |

## Sources

- Official installed Pi 1.0.4 `CHANGELOG.md`, release section `[1.0.4]`.
- Installed package: `@earendil-works/pi-coding-agent@1.0.4`.
- Repository contracts: `scripts/check-pi-compatibility.mjs`, `scripts/check-sol-pi-contract.mjs`, `global/extensions/sol-pi.ts`.

## Evidence

**Verified (initial turn)**: On installed Pi 1.0.4, `node scripts/check-pi-compatibility.mjs` passed with 0 errors and baseline matching 1.0.4; `node scripts/check-sol-pi-contract.mjs --json` passed all pinned SoL-Pi contracts and exports. The test suite `node --test *.test.mjs` passed 207/207 tests. `node skill-audit.mjs` passed with 32 adapted, 10 portable and 4 native skills. `node doctor.mjs` reported all components SYNCED.

**Not run**: Live Bedrock stalled stream recovery, external OIDC OAuth flows, or cross-platform Windows/Linux terminal emulation.

**Blocked**: None.

**Not applicable**: Reinstalling host Node runtime or modifying user private credentials.
