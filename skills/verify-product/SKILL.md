---
name: verify-product
description: Verify that a product change works through project checks and real user-facing paths. Use after implementation, bug fixes, releases, or UI changes.
---

# Verify Product

Verify behavior in layers. Read project `AGENTS.md`, `.pi` resources, package scripts, and any project verification guide before choosing commands.

## Evidence ladder

1. Static: lint, typecheck, formatting, static analysis.
2. Automated: unit, integration, and end-to-end tests.
3. Artifact: build, migrations, generated clients, package validation.
4. Runtime: start the real application and confirm health.
5. Browser: exercise affected critical paths with the browser capability when available.
6. Diagnostics: inspect server logs, browser console, and failed network requests.
7. Visual: inspect screenshots and responsive interaction for user-facing changes.

## Rules

- Match the evidence to the risk and changed surface.
- Prefer the project's existing scripts and conventions.
- Use a process manager for long-running servers when available.
- Use browser verification for UI, routing, auth, persistence, and integration changes when the environment supports it.
- Never claim a check ran when it did not.
- Report four explicit sections: Verified, Not run, Blocked, Not applicable.
- Include exact commands, test counts, URLs or flows, and relevant error summaries.
- Do not rewrite tests or weaken checks just to obtain a green result.
