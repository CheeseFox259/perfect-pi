---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or ask the user for files/pattern using `question` in interactive mode)
3. Check against all rules in the fetched guidelines
4. For live rendered UI or visual verification, use `agent_browser` to inspect rendered layout, focus states, and accessibility trees
5. Output findings in the terse `file:line` format

## Guidelines Source

Fetch fresh guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use `fetch_content` (from `pi-web-access`) or `agent_browser` to retrieve the latest rules. The fetched content contains all the rules and output format instructions. Do not invoke a nonexistent `WebFetch` tool.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above using `fetch_content` or `agent_browser`
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. For rendered DOM or visual verification, use `agent_browser` (do not run ad-hoc browser shell commands)
5. If a local dev server is required to render UI for review, manage it with Pi's `process` tool rather than a blocking shell
6. Output findings using the format specified in the guidelines

If no files specified, ask the user which files or URL to review (using `question` in interactive sessions).
