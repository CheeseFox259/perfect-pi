---
name: route
description: Recommend one next engineering workflow for a task and stop without executing it. Use when the user explicitly asks which workflow to follow.
disable-model-invocation: true
---

# Route

Classify the request and recommend exactly one next path. Do not inspect or modify files, call tools, start a workflow, or invent a second methodology.

- Trivial query or bounded local change -> `direct`
- Bug, regression, unexplained failure, or performance issue -> `diagnosing-bugs`
- Clear bounded implementation with an agreed direction -> `implement`
- Unclear feature, product behavior, or requirements -> `grill-with-docs`
- Huge, ambiguous, multi-session effort -> `wayfinder`
- Review of a branch, diff, or PR -> `code-review`
- Product-level completion or release evidence -> `verify-product`

Respond with:

```text
Route: <one route>
Why: <one short reason>
Next: <direct, /skill:<route>, or the relevant prompt>
```

Use `direct` for trivial queries and bounded local changes; there is no `/skill:direct` command. Stop after the recommendation. A route is not permission to execute it.
