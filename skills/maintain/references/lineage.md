# Lineage Reconciliation

Perfect Pi uses three inputs for each override: local enhanced content, upstream at the override's `baseRef`, and upstream at the candidate head. `upstreams[source].pinnedRef` is the source-wide installed target; it is not a substitute for an override's base.

1. Run `node reconcile.mjs diff <skill>` for each affected override and inspect its `preservedFeatures`, customizations and companion files. Identify actual upstream changes before deciding whether the base can advance.
2. Verify upstream paths at both base and head. A missing path can be registry error, a move or deletion; inspect `git ls-tree -r <ref> --name-only` and search for `/<name>/SKILL.md`. Skills may be nested under engineering, productivity, in-progress or misc. Repoint a moved head path without inventing a different base.
3. Fetch exact base and candidate content and perform an actual merge:

```bash
git merge-file -p -L local-enhancement -L upstream-base -L upstream-latest <localPath> <basePath> <upstreamLatestPath>
```

The three paths must contain distinct roles. Merging the base or local file against itself is not update evidence. A zero exit is a clean text merge, not proof of behavioral preservation. Inspect results and every changed companion; resolve Pi command/execution conflicts toward local semantics while retaining upstream methodology in adapted form. After resolving conflicts, verify that markers are absent and all preserved features remain covered.

4. Advance `manifest.json:skills[].ref` and `components.json:upstreams[source].pinnedRef` together. Advance an override's `baseRef` only after all affected files were reconciled and verified. For a non-overridden-only update, retain override bases. Never add a skills `pinnedRef` field to the manifest.
5. A deleted upstream skill has no latest file to merge. Either retire the manifest requirement, references and inventory together, or retain the last upstream content under `skills/<name>/SKILL.md` as an override whose description records upstream retirement and whose base remains at the last carrying commit.
6. Run source status, regression tests, skill audit and actual resource discovery after authorized sync. Report unchanged override bases and deferred deltas explicitly. Registry/source alignment alone does not prove method-level reconciliation.
