# Review modes and capture

Resolve every named ref with `git rev-parse --verify '<ref>^{commit}'`. Record the SHA so branch movement cannot change the review. Record `git status --short` and the requested paths at capture time. Use argument arrays or safe quoting for paths; enumerate filenames with NUL delimiters when scripting.

## Working-tree

The baseline is the implementation's starting SHA when supplied, otherwise current `HEAD` for a current-change review. `git diff --binary <baseline> -- <scope>` captures the tracked final working tree against that baseline, including staged and unstaged effects. It does not include untracked files. Record index-only intent as well with `git diff --cached --binary <baseline> -- <scope>` when staged and unstaged edits differ, so staged changes later undone in the worktree are visible and not confused with the final product.

List untracked files with `git ls-files --others --exclude-standard -z -- <scope>`. Capture every relevant new file's contents in the packet and label it an addition. If using `git diff --no-index /dev/null <file>` to render text additions, exit 1 means differences, not tool failure. Binary files need a suitable content inspection and a declared limitation if unavailable. Ignored files are outside the default scope; include an explicitly requested safe file manually and record why.

If work already existed at implementation start, a starting commit alone cannot attribute ownership. Preserve the initial tracked diff, initial untracked inventory, and the initial contents of files that will be touched. Supply those to both reviewers. For exact attribution, use snapshot mode with before and after versions of task-owned files, including additions and deletions. Never conceal that an exact initial snapshot is missing.

## Committed

For exact baseline-to-tip review, use `git diff --binary <base-sha> <tip-sha> -- <scope>` and `git log <base-sha>..<tip-sha> --oneline`. For a branch or PR merge-base review, resolve and record `git merge-base <target-sha> <tip-sha>` first, then use that SHA as the base. Three-dot syntax is appropriate only when merge-base semantics were requested. Record any dirty files as excluded from committed coverage.

## Snapshot

A snapshot packet contains a manifest of paths and content hashes plus copied contents or a patch sufficient to inspect the selected scope. A before/after comparison records both manifests, adds/deletes, and their comparison. A current-tree audit records one manifest and says “no comparison baseline”; do not label its absence of a diff a clean bill of health. Include selected untracked files exactly as in working-tree mode.

Keep capture artifacts outside the repo and do not use `git add`, `stash`, a temporary commit, or checkout to manufacture a review boundary. Capture each file once for the packet, check for changes during capture, and give both agents the same immutable packet. They may read additional code for context but must report findings against the captured version. If implementation changes after review, review affected changes again before claiming the final result was reviewed.
