# Issue tracker: GitHub

Issues and specs live in GitHub Issues. Use `gh` for configured repository operations, and read issue bodies, comments, labels, and (for PRs) diffs before acting.

**PRs as a request surface: no.** Set this to `yes` only when external PRs are intentionally triaged as requests.

When publishing tickets, create the parent/spec and child issues in dependency order, apply the configured `ready-for-agent` label, and use native sub-issues/dependencies where available. If native relationships are unavailable, record `Blocked by` in each remote body.

For every published implementation ticket, create a local ledger at `.scratch/<feature>/issues/<NN>-<slug>.md` with `Remote: <URL>`, `Acceptance source: remote`, and the shared execution fields. The remote body remains authoritative for acceptance. Claims, verified commits, and failed-attempt records are local Git state; mirror assignees, comments, labels, and closure only after explicit authorization.

Wayfinder maps are labelled `wayfinder:map`; decision children use `wayfinder:research`, `prototype`, `grilling`, or `task`. Claim by local ledger first, then optionally assign remotely. Resolve with a local answer pointer and optionally mirror the comment/closure remotely.
