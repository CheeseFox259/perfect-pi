---
name: route
description: Recommend one next engineering workflow for a task and stop without executing it. Use when the user explicitly asks which workflow to follow.
disable-model-invocation: true
---

# Route

Classify the request and recommend exactly one next path. Do not inspect or modify files, call tools, start a workflow, or invent a second methodology.

- Trivial query or bounded local change -> `direct`
- Bug, regression, unexplained failure, or performance issue -> `diagnosing-bugs`
- Unclear feature, product behavior, or requirements -> `grill-with-docs`
- Huge, ambiguous, multi-session effort -> `wayfinder`
- Review of a branch, diff, PR, working tree, or current configuration snapshot -> `code-review`
- Product-level completion or release evidence -> `verify-product`

The implementation routes first ask whether the current decisions must survive this session, then whether the work fits one session:

- Direction agreed, explicitly deferred to a fresh session or delegated to a subagent -> `to-spec` (concise decision/acceptance/test record), even if coding itself is small
- Work to do now, fits one session, direction agreed -> `implement`
- Agreed spec or plan, more than one session of work and no approved ticket graph yet -> `to-tickets`
- Existing spec with an approved ticket graph ready to execute -> `implement-spec`

Choose the most specific existing artifact: an approved ticket graph takes precedence over making another spec, and `to-tickets` requires an agreed spec or plan. For larger work with no durable spec, start with `to-spec` and route again after publication. Do not create tickets merely because a small task is deferred.

Respond with:

```text
Route: <one route>
Why: <one short reason>
Next: <direct, /skill:<route>, or the relevant prompt>
```

Use `direct` for trivial queries and bounded local changes; there is no `/skill:direct` command. Stop after the recommendation. `wayfinder` uses the local Pi decision-map workflow; do not claim a particular tracker or project has been runtime-verified without evidence. A route is not permission to execute it.

When the route is `to-spec`, `to-tickets`, or `implement-spec`, append a conditional note to `Next`: those skills need `docs/agents/issue-tracker.md` in the repo, so run `/skill:setup-matt-pocock-skills` first if it is missing. Do not go looking for that file — checking would mean a tool call, which this skill forbids. Phrase the note as a condition, not as a finding.
