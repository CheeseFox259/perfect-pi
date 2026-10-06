# Native Tools, MCP and Image Handoff

## Native Tools

New installations initialize `defaultTools: ["+codemode"]` without overwriting existing user settings. Existing users can enable `code` or `mcp` with `capabilities`, or use `/tools`. The MCP group uses Pi's native `codemode`, `tool_search` and registered resource tools, not the retired `mcp`/`mcpScript` bridge names. CLI tool exclusions remain authoritative. If a legacy selection has no native-default metadata, its saved choices are preserved; use `capabilities` explicitly to opt in. Branch state records the native defaults present when the selection was saved; new defaults are added once, while an explicit later disable remains disabled.

`capabilities` and `sol_phase` return native structured content. Their displayed text remains available, but codemode can consume the structured result directly. Tmux supervisor results also carry structured content. These changes do not change authorization rules or tracker ownership.

## MiniMax MCP

MiniMax Coding Plan MCP is a stdio server started by `uvx minimax-coding-plan-mcp -y`. The tested server exposes `web_search` and `understand_image`. Its search sends a query to MiniMax; image understanding may upload the selected image. Availability does not authorize disclosure of project data, and no image upload was performed during this implementation.

Official sources:

- https://platform.minimax.cn/docs/guides/token-plan-mcp-guide
- https://github.com/MiniMax-AI/MiniMax-Coding-Plan-MCP

The requested docs URL was blocked by the research fetcher's fake-IP check. Search results from official docs/repository and the actual installed server were used to validate command, environment names and tool registration.

### Key Entry

Use Palette -> Settings -> MiniMax MCP Setup or `/mcp-setup` for initial configuration. Select the official region host and paste the key into the masked TUI dialog. Escape cancels without saving. Use Palette -> Settings -> MCP API Key or `/mcp-key MiniMax` to update it. No key is accepted as a command argument. These dialogs require interactive TUI; RPC/JSON/print must not fall back to visible input or chat.

The implementation stores the key in `<agent-dir>/mcp-private/secrets.json`, with POSIX directory permissions 0700 and file permissions 0600. This is a permission-restricted file, **not encrypted storage or a sandbox**. Processes with the same user permissions and trusted extensions may access it. Native Windows ACL hardening has not been verified.

Global `mcp.json` contains a Node stdio launcher and non-secret command/host values. The launcher retrieves the selected key privately, injects it only into its MCP child's environment, and redacts the key from child stdout/stderr. The key is not put into argv, project config, session entries, or repository files. The launcher also filters ambient environment variables, retaining OS startup variables and names explicitly configured for that server; it does not forward unrelated provider API keys. It forwards shutdown to its own child process group on POSIX; it never discovers and kills other MCP processes by name.

Reconnect through native `/mcp` after a key update; `/reload` applies a newly configured server. Key management currently supports one selected environment key per stdio server. Existing HTTP servers continue to use Pi's native OAuth/provider-auth or their own environment configuration; this dialog does not rewrite HTTP auth. Generic stdio use is `/mcp-key server ENVIRONMENT_KEY`, after configuring that server globally.

Both stores use atomic replacement and bounded directory locks. A crash can leave a stale lock; do not remove it while a writer is active. Inspect the `.perfect-pi-lock` or `mcp-private/.write-lock` only when the corresponding writer is stopped. Native MCP's own configuration editor does not share this custom lock, so avoid concurrent profile/key edits from multiple Pi processes.

Setup manages helper code, extensions and the declared public code/document MCP entries only. It does **not** manage `mcp-private/` or personal MCP entries; the native `mcp.json` remains a mixed-ownership file. See [managed MCP ownership and workflows](managed-mcp.md). Importing an existing Claude MiniMax key requires explicit user permission; `scripts/import-minimax-from-claude.mjs` only imports that server, refuses an existing Pi MiniMax entry, and leaves Claude's file untouched.

### Project Profile

For a trusted project with a globally configured MiniMax server:

```text
/mcp-project MiniMax on codemode
/mcp-project MiniMax on deferred
/mcp-project MiniMax off hidden
```

This writes only `enabled` and `exposure` overrides under `<project>/.pi/mcp.json`. It preserves other servers and rejects a project entry that already replaces the global server with its own executable/URL. No key or global host is copied into the project. Run `/reload` to apply. Untrusted projects cannot write a profile through this command; Pi itself ignores project MCP config when untrusted. Native `/mcp` remains the connection/auth/exposure manager.

## Web Image Handoff

No image-generation API is required or called. Only the image-model invocation is replaced: Pi retains responsibility for the original design analysis, full prompt, reference requirements, variants and subsequent critique. Handoff must not simplify or rewrite that prompt. Clipboard/file instructions are separate UI text. There is no handoff-specific prompt-length cap; long prompts remain available through paging and the full transcript output.

Prototype builds a complete image prompt, then calls `image_handoff`. Its TUI panel remains open while the user generates an image on a website. The tool transcript contains the full prompt; the panel shows a bounded preview and keeps the import choices visible even for long prompts.

The user selects **Import Clipboard Image**, **Import Image File**, or **Skip Image**. Clipboard uses the managed helper, never a project's script. New clipboard destinations must be inside the project and must not already exist or pass through symlinked parent directories. A local PNG/JPEG/WebP file up to 10 MiB is returned as an actual multimodal attachment. Import cancellation or failure ends the turn; the agent must not invent the missing image or proceed silently. Explicit skip may continue without an image. In non-TUI mode the tool returns the prompt and terminates the turn so the user can attach an image later.

## Usage and Measurement

`observe.mjs` now aggregates assistant, tool-result, compaction, branch-summary and native usage entries. It reports totals and breakdowns by operation kind and attributed model; unattributed usage remains explicitly unattributed. A parent tool result already contains nested usage, so nestedCalls receipts and reducer telemetry are not added a second time. Equivalent persisted-message/event copies and native `compaction_end` checkpoint copies are deduplicated while repeated operations remain counted. `requests` still means assistant responses with usage, not all auxiliary operations.

`measure.mjs` uses the actual CLI system message's `toolsAdded` definitions. It no longer creates a separate SDK session that lacks the CLI's native built-in loadout. Importing the module is side-effect free; running its CLI still makes one provider request and requires the normal budget/authorization.

## Verification Boundary

Real MiniMax tool registration and one public-documentation search through native Pi codemode succeeded. The first test script subsequently timed out during cleanup; a corrected script verified registration/discovery and explicit session_shutdown without repeating the paid search. During investigation two older MiniMax processes were mistakenly terminated; Claude configuration/credentials were not modified, but its connection may require reconnecting. This is an operational mistake, not a verified clean first E2E run.

No user image, private project data, or real chat/classifier/image-generation API was sent during verification. The rest of the workflow is exercised through actual Pi loader/TUI components and isolated files/fake provider fixtures. Live managed extensions and skills require a separately authorized setup sync before their new commands and tools appear.
