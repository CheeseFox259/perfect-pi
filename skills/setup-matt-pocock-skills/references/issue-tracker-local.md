# Issue tracker: Local Markdown

Issues and specs live in `.scratch/` and are versioned with Git.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- Spec: `.scratch/<feature-slug>/spec.md`.
- One implementation ticket per file: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`.
- Implementation tickets use plain metadata lines: `Triage`, `Execution`, `Claimed by`, `Branch`, `Blocked by`, `Verified commit`, and `Last attempt`.
- `Triage` and `Execution` are separate. Wayfinder tickets use `Type` and `Status` instead.
- Comments append under `## Comments`.

## Operations

Publishing creates the appropriate local files. Fetching reads the path named by the user. A ticket is on the implementation frontier when `Execution: open`, it has no claim, and every listed blocker has `Execution: complete`. Claims are committed before dispatch. Completion requires a merged, checked commit recorded in `Verified commit`.

## Wayfinding operations

The map is `.scratch/<effort>/map.md`; child decision tickets are numbered files under `.scratch/<effort>/issues/`. Each has `Type: research|prototype|grilling|task` and `Status: claimed|resolved`. `Blocked by` lists ticket numbers. Claim by setting `Status: claimed` before work. Resolve by appending `## Answer`, setting `Status: resolved`, and adding a context pointer to the map's Decisions so far.
