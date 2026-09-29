/**
 * Tools Extension
 *
 * Provides a /tools command to enable/disable tools interactively.
 * Tool selection persists across session reloads and respects branch navigation.
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Use /tools to open the tool selector
 */

import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

const CAPABILITIES = {
	web: ["web_search", "source_check", "fetch_content", "get_search_content"],
	browser: ["agent_browser", "agent_browser_code", "agent_browser_tools"],
	mcp: ["mcp", "mcpScript"],
	lsp: ["lsp_diagnostics", "lsp_fix"],
	process: ["process"],
	research: ["research"],
} as const;
const optionalTools = new Set<string>(Object.values(CAPABILITIES).flat());
const capabilityNames = Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[];

// State persisted to session
interface ToolsState {
	enabledTools: string[];
}

export default function toolsExtension(pi: ExtensionAPI) {
	// Track enabled tools
	let enabledTools: Set<string> = new Set();
	let allTools: ToolInfo[] = [];
	let cliAllowedTools: Set<string> | undefined;
	const allowed = (name: string) => !cliAllowedTools || cliAllowedTools.has(name);

	// Persist current state
	function persistState() {
		pi.appendEntry<ToolsState>("tools-config", {
			enabledTools: Array.from(enabledTools),
		});
	}

	// Apply current tool selection
	function applyTools() {
		enabledTools = new Set([...enabledTools].filter(allowed));
		pi.setActiveTools(Array.from(enabledTools));
	}

	// Find the last tools-config entry in the current branch
	function restoreFromBranch(ctx: ExtensionContext) {
		allTools = pi.getAllTools();

		// Get entries in current branch only
		const branchEntries = ctx.sessionManager.getBranch();
		let savedTools: string[] | undefined;

		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "tools-config") {
				const data = entry.data as ToolsState | undefined;
				if (data?.enabledTools) {
					savedTools = data.enabledTools;
				}
			}
		}

		if (savedTools) {
			// Restore saved tool selection (filter to only tools that still exist)
			const allToolNames = allTools.map((t) => t.name);
			enabledTools = new Set(savedTools.filter((t: string) => allToolNames.includes(t)));
			applyTools();
		} else {
			// Without saved state use compact defaults, unless CLI tools were explicit.
			enabledTools = new Set(pi.getActiveTools().filter((name) => cliAllowedTools || !optionalTools.has(name)));
			applyTools();
		}
	}

	pi.registerTool({
		name: "capabilities",
		label: "Capabilities",
		description: "Enable optional Pi tools before using them: web, browser, mcp, lsp, process, research. Empty input lists availability.",
		promptGuidelines: ["If a skill needs an inactive tool, enable its group with capabilities, then use it in a subsequent call. Tool activation does not grant permission for external writes."],
		parameters: Type.Object({
			enable: Type.Optional(Type.Array(Type.Union(capabilityNames.map((name) => Type.Literal(name))))),
		}),
		executionMode: "sequential",
		async execute(_id, params) {
			const registered = new Set(pi.getAllTools().map((tool) => tool.name));
			enabledTools = new Set(pi.getActiveTools());
			for (const group of params.enable ?? []) {
				for (const name of CAPABILITIES[group]) {
					if (registered.has(name) && allowed(name)) enabledTools.add(name);
				}
			}
			if (params.enable?.length) {
				applyTools();
				persistState();
			}
			const groups = Object.fromEntries(capabilityNames.map((group) => [group, {
				active: CAPABILITIES[group].filter((name) => enabledTools.has(name)),
				available: CAPABILITIES[group].filter((name) => registered.has(name) && allowed(name)),
				excludedByCli: CAPABILITIES[group].filter((name) => registered.has(name) && !allowed(name)),
				missing: CAPABILITIES[group].filter((name) => !registered.has(name)),
			}]));
			return { content: [{ type: "text", text: JSON.stringify(groups) }], details: groups };
		},
	});

	// Register /tools command
	pi.registerCommand("tools", {
		description: "Enable/disable tools",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tools requires TUI mode", "error");
				return;
			}

			// Refresh active selection too: capability loaders may change it.
			allTools = pi.getAllTools();
			enabledTools = new Set(pi.getActiveTools());

			await ctx.ui.custom((tui, theme, _kb, done) => {
				// Build settings items for each tool
				const items: SettingItem[] = allTools.filter((tool) => allowed(tool.name)).map((tool) => ({
					id: tool.name,
					label: tool.name,
					currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
					values: ["enabled", "disabled"],
				}));

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [theme.fg("accent", theme.bold("Tool Configuration")), ""];
						}
						invalidate() {}
					})(),
				);

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						// Update enabled state and apply immediately
						if (newValue === "enabled") {
							enabledTools.add(id);
						} else {
							enabledTools.delete(id);
						}
						applyTools();
						persistState();
					},
					() => {
						// Close dialog
						done(undefined);
					},
				);

				container.addChild(settingsList);

				const component = {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};

				return component;
			});
		},
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		// The runtime has already applied CLI allow/deny lists at this point.
		const args = process.argv.slice(0, process.argv.indexOf("--") < 0 ? undefined : process.argv.indexOf("--"));
		const explicit = args.some((arg) =>
			/^(--tools|--exclude-tools|--no-tools|--no-builtin-tools)(=|$)/.test(arg)
			|| ["-t", "-xt", "-nt", "-nbt"].includes(arg));
		cliAllowedTools = explicit ? new Set(pi.getActiveTools()) : undefined;
		restoreFromBranch(ctx);
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});
}
