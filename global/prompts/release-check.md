---
description: Check whether the current work is ready to release
argument-hint: "[scope]"
---
Perform a release-readiness review. Check tests, typecheck, build, migrations, environment requirements, generated files, security-sensitive changes, and affected user-facing paths. Do not modify files unless explicitly requested. Report findings first, then evidence and remaining risks.

Scope:
${@:-the current branch}
