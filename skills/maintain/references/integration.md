# Integration Acceptance

A new tool or package is a complete Perfect Pi integration only when every applicable row is satisfied:

| Area | Acceptance evidence |
| --- | --- |
| Source and pin | Official source, license, package/runtime version or immutable Git ref recorded in the manifest; no floating `latest`, unversioned `npx -y`, branch or moving URL. |
| Ownership | Setup declares and synchronizes the component; doctor reports missing/drifted/stale state; unrelated user config and credentials remain unchanged; removal is ownership-aware. |
| Exposure | Every tool has a deliberate exposure. Default-deny (`hidden` or an explicit allowlist) is used for execution, deletion, upgrade, external publication, secret access and lifecycle hooks until reviewed. `codemode` is exposure control, not an OS sandbox. |
| Boundary | Native adapters, hooks, prompts, skills, background daemons, storage paths, network egress and overlapping Perfect Pi components are inventoried. Only the selected integration mode is active. |
| Security | Secrets are entered through the existing private path; child environments are filtered; project writes require trust; guardrails and tool restrictions are tested. |
| Functional path | The real host discovers the server and calls one representative useful read/query operation with a bounded fixture. A protocol initialize or `pi mcp list` is only connection evidence. |
| Failure path | Invalid config, missing binary/package, tool error, timeout and shutdown are bounded and reported. Dangerous tools are verified unreachable when policy says hidden. |
| Reproducibility | A clean fixture can run setup twice and produce the same managed configuration. The pinned package/ref, data directory and migration behavior are tested. |
| Documentation | Capability, overlap, opt-in steps, limitations, untested paths and restart/reload rules are recorded. Claims use measured evidence and exact tool names. |
| Verification | Focused tests, repository regressions, contracts, audit and doctor run after implementation and after sync. Results are separated into Verified, Not run, Blocked and Not applicable. |

A server that merely appears as `connected` is **partially integrated** until ownership, pinning, policy and functional evidence are complete.

For MCP-only integration, do not load a package's native Pi adapter or install its hooks unless that adapter has passed an independent lifecycle and conflict review. For a native adapter integration, test hook ordering, cancellation, compaction, tool interception and coexistence with SoL-Pi and guardrails.
