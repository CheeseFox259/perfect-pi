# Evidence Levels

Use the lowest level that is sufficient for the change, then climb higher for user-facing or high-risk behavior.

| Level | Evidence | Typical use |
|---|---|---|
| L1 | lint, typecheck | local implementation changes |
| L2 | unit/integration tests | behavior and contracts |
| L3 | build, migration, generated artifacts | packaging and deployment risk |
| L4 | real application startup | runtime configuration and wiring |
| L5 | browser critical path | UI, auth, routing, persistence |
| L6 | console/network/log inspection | integration and production-like failures |
| L7 | screenshot and responsive review | visual and interaction changes |
