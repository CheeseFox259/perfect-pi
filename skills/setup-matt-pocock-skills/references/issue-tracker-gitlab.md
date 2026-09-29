# Issue tracker: GitLab

Issues and specs live in GitLab Issues. Use `glab` for configured repository operations, and read issue bodies, notes, labels, and merge request diffs before acting.

**Merge requests as a request surface: no.** Set this to `yes` only when external merge requests are intentionally triaged as requests.

When publishing tickets, create them in dependency order, apply the configured `ready-for-agent` label, and use native blocking links where available. If native relationships are unavailable, record `Blocked by` in each remote body.

For every published implementation ticket, create a local ledger at `.scratch/<feature>/issues/<NN>-<slug>.md` with `Remote: <URL>`, `Acceptance source: remote`, and the shared execution fields. The remote body remains authoritative for acceptance. Claims, verified commits, and failed-attempt records are local Git state; mirror assignees, notes, labels, and closure only after explicit authorization.

Wayfinder maps are labelled `wayfinder:map`; decision children use `wayfinder:research`, `prototype`, `grilling`, or `task`. Claim by local ledger first, then optionally assign remotely. Resolve with a local answer pointer and optionally mirror the note/closure remotely.
