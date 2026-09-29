# Implementation ladder experiment: 2026-09-29

## Scope

The public repository `CheeseFox259/test` was empty. A local-only seed commit `8cf5514` added a README defining a dependency-free Node file-backed todo CLI and two black-box tests. Two independent local clones started from that exact commit: one for direct implementation and one for setup, spec, tickets and ticket-graph implementation. The CLI test seam was a subprocess with a temporary JSON file. No push, remote branch, PR or remote issue was created.

The comparison was explicitly pinned to `minimax-cn/MiniMax-M3.1-Flash-Preview` with `--thinking high`, regardless of the interactive conversation model. Fixed setup cost and per-path incremental cost were to be reported separately. Each path had a ten-minute cap; the setup stage received one retry within that cap. Headless prompts carried the user's explicit approvals for local Markdown, default triage labels, single-context layout, `AGENTS.md`, the setup draft and local fixture commits. Later spec/test-seam and ticket-granularity approvals would still have required real user confirmation if the run had reached those stages.

## Diagnosis and rerun

The initial timeouts were caused by the experiment runner, not established as a MiniMax `high` failure. Its Node `spawn()` call left the child stdin pipe open; Pi's `--print` mode reads piped stdin to EOF before emitting JSON events. A 45-second short-prompt probe with open stdin reproduced zero events both with full resources and with extensions/skills/context disabled. Changing only child `stdio` to `["ignore", "pipe", "pipe"]` made the same model and thinking level respond in 2.0 seconds (minimal resources; first event at 168 ms, 15 events) and 2.2 seconds (full resources; first event at 582 ms, 15 events). The original ten-minute measurements below are therefore **invalid as model or workflow performance samples**. The runner has been corrected for a fresh comparison from the same seed commit.

## Corrected comparison (same seed commit, same model and thinking level)

Both paths ran in isolated local clones of seed `8cf5514`, pinned to `minimax-cn/MiniMax-M3.1-Flash-Preview` with `--thinking high`, with `stdio` fixed so Pi's print mode reached EOF. Direct path: one request sequence implementing the CLI from `README.md`. Ladder path: per-repo setup, concise spec, two-ticket draft approved by the human, ticket publication, then a ticket-graph implementation run with per-ticket worktrees and an `implementer` subagent per ticket plus a two-axis review pass.

| Stage | Wall time | Parent input | Parent cache read | Parent output |
| --- | ---: | ---: | ---: | ---: |
| Direct implementation | 55.0 s | 2,723 | 198,720 | 6,370 |
| Ladder: tracker setup (fixed per repo) | 24.2 s | 14,422 | 100,536 | 3,172 |
| Ladder: spec | 26.0 s | 17,134 | 87,419 | 3,046 |
| Ladder: ticket draft (paused for approval) | 39.5 s | 4,484 | 83,844 | 4,673 |
| Ladder: ticket publication | 22.0 s | 3,300 | 105,196 | 2,876 |
| Ladder: ticket-graph implementation (integration + 5 subagents) | 350.9 s | 44,403 | 1,253,231 | 18,072 |

The implementation stage dispatched five `implementer` subagents (tickets 01 and 02, then two review axes and one fix), all reporting `minimax-cn/MiniMax-M3.1-Flash-Preview` with zero exit code. Subagent usage alone: 68,516 input, 644,854 cache read, 30,863 output. Ladder totals including setup: about 150,037 input, 2,188,449 cache read, 65,043 output — roughly 4.3x the direct path's reported tokens and 6.4x its wall time, plus one human approval round and one human correction (see below).

Behavioural result: the ladder path merged both tickets, left the seed `README.md`, `test/todo.test.mjs` and `spec.md` byte-identical (`git diff` empty), and passed the full `node --test` 2/2 on the integration branch. Tickets ended `Execution: complete` with verified integration commits (`3313e66`, `d86c17c`). A two-axis review of `0df79de..HEAD` found one real defect (unknown command reported as a missing `--file`), fixed as `beea5a2`. The direct path produced equivalent behaviour in one pass and I re-ran its black-box suite: 2/2.

Human review cost observed: the generated spec told implementers to "extend the existing test file" while the same spec forbade modifying it, so a human corrected that sentence in its own commit before ticketing; the `to-tickets` run also paused correctly for approval rather than publishing on its own.

## Initial invalid runs (superseded by the stdin fix)

| Attempt | Wall time | Model events | Tool calls | Files changed | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Direct implementation | 600.0 s | 0 | 0 | 0 | Timed out before first JSON event |
| Ladder setup | 300.0 s | 0 | 0 | 0 | Timed out before first JSON event |
| Ladder setup retry | 300.0 s | 0 | 0 | 0 | Timed out before first JSON event |

The runner sent SIGTERM at each deadline. Event logs were empty because stdin never reached EOF; reported input, cache-read, cache-write and output tokens were all zero *observed*, not proof of zero provider billing. Pi printed only a `pi-web-access` compatibility warning to stderr. The seed's two CLI tests failed as expected before implementation; neither clone produced the CLI during these invalid runs.

Local evidence is retained under `/tmp/perfect-pi-eval.D5W640/`: `seed/`, `direct/`, `ladder/`, `run.mjs`, event logs and per-attempt summary JSON. This is temporary storage and may be removed by the operating system. The two clone HEADs remained `8cf5514` and their worktrees remained clean at the end of the experiment.

## Conclusion

The end-to-end ladder is **functional** on this fixture: the ticket contract, blocking subagent dispatch, explicit worktrees, verified-merge completion and cleanup all behaved as designed, and the blocking edge really gated ticket 02. It is **not** cheaper than direct implementation for a single small feature; the one sample shows about 4.3x the reported tokens and 6.4x the wall time, and a spec generated by a model still needed a human correction. Its value is durable decisions, resumable ticket state and review evidence for work that genuinely spans sessions — not token efficiency. Treat these numbers as one observational sample on one model, not a general claim; the earlier `defaultThinkingLevel` concern from the handoff is unsupported by this run.
