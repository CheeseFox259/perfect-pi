# Pi adaptation verification — 2026-09-29

Scope: the current Perfect Pi working tree, including pre-existing uncommitted implementation-ladder work. The work was applied to the managed local Pi installation. No repository commits, pushes, remote issues, or production changes were made. After the user's model selection, implementation/review subagents and final live probes used `cpa/gemini-3.8-flash-high`.

## Verified

- `node --test *.test.mjs`: **67 passed, 0 failed**. Covers actual Pi extension loading/TUI callbacks, isolated installation and adoption backups, real Git merge fixtures, skill evaluation subprocess protocols, tool capability activation and workflow contracts.
- `node skill-audit.mjs`: **46 distinct managed skills**, comprising **31 local upstream adaptations, 11 portable upstream skills, 4 native skills**; no inventory or invocation-policy errors.
- Pi `DefaultResourceLoader`: all 46 managed skills discovered; 47 skills total including the process package's skill; **0 collisions**.
- `node doctor.mjs`: all statuses **SYNCED**. The legacy required-entry counter displays 47/47 because grilling appears as both an upstream requirement and a local entry; the distinct inventory is 46.
- `PI_EVAL_MODEL=cpa/gemini-3.8-flash-high node route-smoke.mjs /tmp/perfect-pi-route-results.json`: **13/13 passed**, zero tool calls. Includes working-tree/snapshot review and immediate implementation cases.
- Live Gemini capability probe: called `capabilities` with `enable: ["process"]`, then `process` with `action: "list"`; zero tool errors. It started/stopped no processes.
- `node --check` for setup, reconcile, route-smoke and measure; `git diff --check`: passed.
- Managed installation: updated with `node setup.mjs --skip-package-install --skip-skill-install --adopt-overrides`. Existing physical skill-creator files were backed up under `~/.pi/agent/.perfect-pi-backups/1790702019193-3362/`. Shared upstream skill contents were not modified.

## Context measurements

| Measurement | Before | After |
| --- | ---: | ---: |
| Initially active tools | 21 | 9 |
| Tool definition characters | 45,056 | 10,604 |
| Pi character-based schema token estimate | 11,264 | 2,651 |
| Skill metadata entries | 17 | 24 |
| Provider-reported initial input | 13,638 | 5,725 |

The local schema estimate fell by approximately 76%. More skills are available while fewer optional tool schemas are loaded initially. The before/after provider input figures used different selected models/cache conditions; they are observations, not a controlled cost or speed comparison. The post-change probe used Gemini 3.8 and had no budget warnings at the default 6,000 schema / 8,000 input thresholds.

`pi-web-access@0.31.0` still emits its upstream dynamic-activation compatibility warning on Pi 0.87.1. Perfect Pi's capability loader uses the current `setActiveTools` API and the observed initial tool set excludes web tools, so the warning's claim of eager availability does not describe the final assembled prompt. No installed third-party package code was patched to hide the message.

## Not run

- Live GitHub/GitLab issue publication, claim mirroring, PR creation, deployment, or production migrations.
- Full end-to-end development benchmarks across frontend, API and database sample applications.
- Every skill's complete product workflow; compatibility, discovery and targeted behavior were verified, not universal success against arbitrary repositories.
- Physical terminal screenshots; the UI regression suite loads real Pi/TUI modules and exercises their actual handlers with a test UI context.

## Blocked

The LSP diagnostics invocation reported unavailable default language servers and provided no TypeScript diagnostic report. No LSP pass is claimed. Configure the intended server in `pi-lsp.json` and install its command to obtain that additional check; the actual Pi runtime did load the changed extensions successfully.

## Not applicable

Production rollback and external write verification: this change performed no production or hosted-system writes. Existing user credentials, provider/model settings, sessions and unrelated packages were retained.
