# Pi 1.0.3 Maintenance Assessment

## Scope and Decision

Review Pi 1.0.3 (released 2026-10-05) against Perfect Pi's previous 1.0.2 baseline. The installed runtime was already 1.0.3 before this maintenance. The initial Pi batch advanced only `manifest.json:piVersion` and documented the release implications. It did not reinstall Pi, change provider credentials or dependency pins, invoke image-generation APIs, or alter prototype's web image handoff policy.

A subsequent grilling round separately authorized skill-source reconciliation and live synchronization of both batches. Matt advances to `4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d` and Anthropic to `683bc88e56f3e09ba94f7055977f3d3aa499f202`. Ask-matt adopts the post-fix retro route; chief-of-staff may be downloaded but is excluded from Pi loading. See `docs/skill-audit-remaining.md` for lineage details.

`node setup.mjs --skip-package-install` synchronized managed resources after that authorization. No git commit was authorized or created. Restart Pi after a runtime installation change; use `/reload` after resource-only changes. This maintenance did not restart or reload the user's running session.

## Release Impact

| Change | Decision |
| --- | --- |
| Azure provider renamed to `azure`; Foundry Chat Completions added | No repository-owned provider configuration needs migration. Users with old provider keys must migrate their private configuration or authenticate again. Private credentials were not audited. Environment variable names remain unchanged. |
| Codemode `image()` saves images and reports temporary paths | Record capability, not automatic adoption. The path appears in result text alongside the attachment, not as a new `ImagesResult.output` path field. Image type determines the extension; failed saving can leave the image available without a path. Copy to a durable project asset only when the workflow calls for it. |
| Output files restricted to the user | Pi uses POSIX mode 0600 and exclusive creation. No conflicting harness reader was identified. This is not an end-to-end cross-user test or permission to disclose an output file. SoL-Pi archives observations independently and registers `obs_recall`. |
| Home/End editor behavior; Ctrl+Home/Ctrl+End transcript navigation | No explicit managed-extension binding needs adaptation. Actual terminal key behavior was not exercised in this change. |
| OAuth refresh cancellation, removed installation and terminal EIO fixes | Upstream reliability changes, not new harness integrations. Restart the process after an on-disk runtime upgrade; `/reload` only reloads resources. |

The earlier N04 image-adoption assessment is historical. The lack of automatic file saving is no longer a limitation in 1.0.3, but the current no-image-API prototype policy remains deliberate.

## Sources

- Official installed Pi 1.0.3 `CHANGELOG.md`, release section `[1.0.3]`.
- Official installed `docs/codemode.md`, Generate images; `docs/slash-commands.md`, `/reload`.
- Installed implementation: `dist/extensions/codemode/execute.js` (`saveImages`) and `dist/utils/output-files.js` (mode 0600, exclusive creation).
- Repository contracts: `scripts/check-pi-compatibility.mjs`, `scripts/check-sol-pi-contract.mjs`, `global/extensions/sol-pi.ts` and `skills/prototype/SKILL.md`.

## Evidence

**Verified**: On the installed Pi 1.0.3, `node scripts/check-pi-compatibility.mjs` passed required APIs, settings storage and managed extension loading with the baseline matching 1.0.3; `node scripts/check-sol-pi-contract.mjs --json` passed the pinned SoL-Pi modules and exports. The Pi-only batch passed 206/206 tests. After the separately approved skill update, `node --test *.test.mjs` passed 207/207 tests, including the new route/exclusion regression; `node skill-audit.mjs` passed with 32 adapted, 10 portable and 4 native skills. Live synchronization succeeded and `node doctor.mjs` reported SYNCED. Pi's actual resource loader discovered 47 skills without diagnostics, loaded the managed ask-matt, and did not expose chief-of-staff despite its presence on disk. The source-status check reported all four upstreams UP_TO_DATE and all pins aligned. These are local contract and regression results, not a claim that all upstream fixes were tested end to end.

**Not run**: Live Azure/Foundry requests, OAuth refresh cancellation, terminal disappearance and key-navigation checks, image-generation API requests, cross-user file access, isolated reinstall of Pi, user-session reload, or CI execution for this change.

**Blocked**: None.

**Not applicable**: Browser/UI verification of a changed application, production deployment and private-credential migration; none of those are part of this maintenance.
