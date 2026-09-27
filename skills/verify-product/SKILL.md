---
name: verify-product
description: Verify a product change through risk-appropriate project checks and real user-facing paths. Use after implementation, bug fixes, UI changes, or release preparation.
---

# Verify Product

Choose the lightest tier that proves the changed behavior, then report evidence honestly.

- Tier 0: direct query or bounded local change. Inspect, make the minimal change, and run a cheap relevant check.
- Tier 1: normal bug or feature. Use `implement` or `diagnosing-bugs`, then run relevant LSP, tests, typecheck, build, or review checks.
- Tier 2: UI, auth, payments, critical flow, major refactor, or release candidate. Run Tier 1, start the real app, exercise the affected browser path, and inspect console/network evidence when available.

Use the project's existing scripts and verification rules. Use `process` for long-running servers. Use the browser for user-facing behavior when the environment supports it.

Always report exactly these sections:

- **Verified**: checks actually run and their concrete results.
- **Not run**: relevant checks intentionally not executed.
- **Blocked**: checks that could not run and why.
- **Not applicable**: checks unrelated to this change.

Include commands, counts, URLs/flows, and error summaries. Never write `should work`, `probably fixed`, or `looks good` as evidence. Do not weaken or rewrite checks to obtain a green result.
