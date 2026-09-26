---
description: Verify a user-facing flow in the real application
argument-hint: "[flow]"
---
Use `verify-product` and the browser capability when available. Start the real application if needed. Exercise the affected critical path, inspect console errors and failed network requests, and check loading, empty, error, responsive, and success states. Report concrete evidence and blockers; do not claim visual or browser verification if it did not run.

Flow:
${@:-the affected user-facing flow}
