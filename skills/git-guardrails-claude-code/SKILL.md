---
name: git-guardrails-claude-code
description: Set up native Pi guardrails using @aliou/pi-guardrails to block dangerous git commands (push, reset --hard, clean, branch -D, checkout/restore .) before execution.
---

# Setup Git Guardrails

Configure deterministic guardrails to intercept and block dangerous git operations before they execute.

In Pi, this functionality is provided natively by the installed `@aliou/pi-guardrails` package (`npm:@aliou/pi-guardrails@0.19.0`), replacing legacy Claude Code bash hook scripts with native `permission-gate` policy enforcement.

## What Gets Blocked

The guardrails intercept and automatically block:

- `git push` (all variants including `--force`)
- `git reset --hard`
- `git clean -f` / `git clean -fd`
- `git branch -D`
- `git checkout .` / `git restore .`

When blocked by the permission gate, Pi halts execution and displays the denial message to the agent, preventing unauthorized writes or destructive state loss.

## Configuration via @aliou/pi-guardrails

Guardrails configuration lives in JSON files validated against the `@aliou/pi-guardrails` schema:

- **Project scope**: `.pi/extensions/guardrails.json`
- **Global scope**: `~/.pi/agent/extensions/guardrails.json`

### Interactive Configuration

You can manage guardrails interactively in Pi:

```text
/guardrails:settings
```

Select **Permission Gate** to configure dangerous command patterns, auto-deny rules, or confirmation prompts.

### Direct JSON Configuration

To configure automatic blocking for dangerous git operations, add or merge the `permissionGate.autoDenyPatterns` array into your settings file:

```json
{
  "$schema": "https://unpkg.com/@aliou/pi-guardrails@0.19.0/schema.json",
  "permissionGate": {
    "autoDenyPatterns": [
      {
        "pattern": "git push",
        "description": "BLOCKED: Pushing to remote is prevented by git guardrails."
      },
      {
        "pattern": "git reset --hard",
        "description": "BLOCKED: Hard reset is prevented by git guardrails."
      },
      {
        "pattern": "git clean -f",
        "description": "BLOCKED: Forced clean is prevented by git guardrails."
      },
      {
        "pattern": "git clean -fd",
        "description": "BLOCKED: Forced clean is prevented by git guardrails."
      },
      {
        "pattern": "git branch -D",
        "description": "BLOCKED: Forced branch deletion is prevented by git guardrails."
      },
      {
        "pattern": "git checkout .",
        "description": "BLOCKED: Discarding working directory changes is prevented by git guardrails."
      },
      {
        "pattern": "git restore .",
        "description": "BLOCKED: Discarding working directory changes is prevented by git guardrails."
      }
    ]
  }
}
```

> **Note on schema fields**: In `@aliou/pi-guardrails`, `version` is a package semver marker (e.g. `"0.19.0"`) stamped by migrations and is optional in user config files (do not set integer `version: 1`). Global `enabled` defaults to `true`. Under `permissionGate`, `autoDenyPatterns` automatically blocks matched commands without interactive prompting; `requireConfirmation` only governs interactive prompts for standard dangerous patterns.

## Steps

### 1. Determine Scope

In an interactive session, use `question` to ask whether to configure for:
- **This project only**: `.pi/extensions/guardrails.json`
- **Global for all projects**: `~/.pi/agent/extensions/guardrails.json`

### 2. Apply Configuration

If the target configuration file already exists, read it and merge the git patterns into `permissionGate.autoDenyPatterns` while preserving existing policies and path access settings. If it does not exist, create the file with the schema above.

### 3. Verify Enforcement Safely

Never test enforcement using live destructive commands or push dry-runs against a real remote. Instead, verify safely via schema validation and an isolated non-executing classifier test:

1. **Schema validation**: Validate the resulting JSON settings file against `@aliou/pi-guardrails/schema.json`.
2. **Classifier check**: Verify that the configured substring and regex patterns cover each dangerous command variation (e.g. `git push origin main`, `git reset --hard`, `git clean -fd`) without executing them.
