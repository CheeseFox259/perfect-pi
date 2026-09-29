# Pi skill compatibility inventory

Perfect Pi manages 46 distinct skills: 42 upstream skills and 4 native skills. Of the upstream skills, 31 have versioned local Pi adaptations and 11 retain portable upstream instructions. This inventory supersedes the initial partial audit; companion documents and executable helpers were included in the review.

Run `node skill-audit.mjs` to check that every managed skill is present, registered, visible, and free of known unsupported invocation patterns. This is a compatibility check, not proof that every workflow has completed against every external service. Pi's real resource loader was also checked: all 46 managed skills were discovered, with no name collisions (the process package supplies one additional skill).

## Adapted upstream skills

| Skill | Pi adaptation |
| --- | --- |
| ask-matt | `/skill:name` command spelling and Pi execution semantics |
| claude-handoff | Compatibility alias for Pi handoff and blocking continuation; no detached coding CLI |
| code-review | Working-tree, committed and snapshot modes; includes untracked files; ordinary review needs no tracker |
| codebase-design | Design alternatives use a blocking `subagent.tasks` batch and interactive decisions |
| git-guardrails-claude-code | Compatibility alias for native `@aliou/pi-guardrails`; schema-based policy, no legacy hooks |
| grill-me | Reads the Pi grilling skill |
| grill-with-docs | Reads grilling and domain-modeling; interactive questionnaire |
| grilling | TUI questions, amendment, cancellation semantics and blocking/background distinction |
| handoff | Pi continuation prompt, evidence and authorization pointers |
| implement | Captures starting state; reviews working-tree changes before committing |
| implement-spec | Explicit worktrees, blocking implementers, verified integration, local execution ledgers for all trackers |
| improve-codebase-architecture | Pi exploration role, questionnaire and report companions |
| loop-me | Pi grilling and questionnaire for workflow decisions |
| prototype | Process-managed preview servers and browser verification; logic/UI companions preserved |
| research | Native background research; `fetch_content`/browser sources and cited file results |
| retro | Pi skill loading, session resources and AGENTS.md guidance |
| setup-matt-pocock-skills | Bundled tracker/domain templates and common execution ledger |
| setup-ts-deep-modules | Pi skill loading and AGENTS.md pointers; dependency-cruiser template preserved |
| skill-creator | Pi CLI evaluation, read-only trigger probes, no-tool description improvement, error-aware results, explicit model propagation |
| tdd | Pi skill loading, interactive seam decisions and process-managed watchers |
| teach | Pi questions, browser previews and source gathering; teaching formats preserved |
| to-questionnaire | Pi clarification UI while retaining the shareable questionnaire artifact |
| to-spec | Concise durable spec, reused approvals, remote spec pointers |
| to-tickets | Vertical slices and graph validation; local/remote execution ledger bridge |
| triage | Pi tracker and interview workflow; readiness distinct from execution state |
| wayfinder | Durable decision map, real research dispatch and interactive frontier |
| web-design-guidelines | `fetch_content`, `agent_browser` and managed preview servers |
| writing-beats | Pi question UI and command references |
| writing-for-agents | Pi skill mechanics and AGENTS.md guidance |
| writing-fragments | Pi workflow references |
| writing-shape | Pi question UI |

Every adaptation is registered in `components.json` with its upstream `baseRef` and source path, and in the manifest's shadow policy. Existing legacy command names remain usable; they execute the Pi workflow described above. Local overrides include the required companion references and skill-creator's upstream license.

## Portable upstream skills

These 11 skills use repository conventions, language/framework guidance, ordinary commands, or artifact formats rather than another agent's APIs. They retain the pinned upstream files and companion resources:

- diagnosing-bugs
- domain-modeling
- frontend-design
- migrate-to-shoehorn
- pr
- resolving-merge-conflicts
- scaffold-exercises
- setup-pre-commit
- vercel-react-best-practices
- wait-what
- wizard

The shared Pi instructions govern interactive questions, optional tool activation, server lifecycle, authorization and skill loading. A portable skill still requires its target project's dependencies and appropriate verification; availability is not a claim that those dependencies are installed everywhere.

## Native skills

`route`, `project-architecture`, `verify-product`, and `maintain` are native Perfect Pi workflows. Route remains recommendation-only. Maintain uses manifest `skills[].ref`, component source `pinnedRef`, and per-override `baseRef`; its merge check compares actual Git versions.

## Verification boundaries

Executed during this change: isolated installer regression tests; actual Pi extension loading and TUI input-handler tests; offline Git merge fixtures; fake-CLI evaluation protocol tests; capability-loader tests; workflow contract checks; skill inventory checks; actual Pi discovery; Gemini 3.8 route probes; and context/schema measurements.

Live GitHub/GitLab publication, production deployment, all language-server installations, and end-to-end development of representative frontend/API/database applications were not exercised by this compatibility work. Triage and wayfinder have native Pi instructions; their external tracker integrations still need project-specific runtime evidence. Browser/OS commands and language-specific commands remain subject to local availability.
