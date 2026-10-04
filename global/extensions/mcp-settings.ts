import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, CURSOR_MARKER, Text, Container, truncateToWidth } from "@earendil-works/pi-tui";

export class SecretInput extends Input {
  render(width: number): string[] {
    const mask = "*".repeat(Math.min(this.getValue().length, Math.max(0, width - 8)));
    return [truncateToWidth(`Key: ${mask}${this.focused ? CURSOR_MARKER : ""}`, width)];
  }
}
export async function promptMcpKey(ctx: any, title: string): Promise<string | undefined> {
  if (ctx.mode !== "tui" || !ctx.hasUI || !ctx.ui?.custom) throw new Error("MCP key entry requires interactive TUI; never put keys in chat or command arguments");
  if (ctx.signal?.aborted) return undefined;
  return ctx.ui.custom((tui: any, theme: any, _keys: any, done: any) => {
    const input = new SecretInput();
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", title), 0, 0));
    container.addChild(input);
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return; settled = true; input.setValue(""); ctx.signal?.removeEventListener("abort", cancel); done(value);
    };
    const cancel = () => finish();
    ctx.signal?.addEventListener("abort", cancel, { once: true });
    if (ctx.signal?.aborted) cancel();
    input.onSubmit = (value: string) => { if (value.trim()) finish(value); };
    return {
      get focused() { return input.focused; }, set focused(value: boolean) { input.focused = value; },
      render: (width: number) => container.render(width), invalidate: () => container.invalidate(),
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) finish();
        else input.handleInput(data);
        tui.requestRender();
      },
      dispose() { input.setValue(""); ctx.signal?.removeEventListener("abort", cancel); },
    };
  });
}
async function helpers() {
  const here = dirname(fileURLToPath(import.meta.url));
  const directory = [join(getAgentDir(), "scripts"), join(here, "../scripts"), join(here, "../../scripts")].find(path => existsSync(join(path, "mcp-secrets.mjs")) && existsSync(join(path, "mcp-config.mjs")));
  if (!directory) throw new Error("Managed MCP helpers not found");
  return { ...await import(pathToFileURL(join(directory, "mcp-secrets.mjs")).href), ...await import(pathToFileURL(join(directory, "mcp-config.mjs")).href) };
}
export default function mcpSettings(pi: ExtensionAPI) {
  pi.registerCommand("mcp-setup", {
    description: "Configure MiniMax Coding Plan MCP with private key input",
    handler: async (args, ctx) => {
      try {
        if (args.trim()) throw new Error("This command accepts no secrets or arguments");
        const helper = await helpers();
        const path = join(getAgentDir(), "mcp.json");
        if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")).mcpServers?.MiniMax) {
          ctx.ui.notify("MiniMax is configured. Use /mcp-key MiniMax to update its key, or /mcp to reconnect.", "info"); return;
        }
        const host = await ctx.ui.select("MiniMax region", helper.MINIMAX_HOSTS, { signal: ctx.signal });
        if (!host) return;
        const value = await promptMcpKey(ctx, "MiniMax / MINIMAX_API_KEY");
        if (!value) return;
        helper.storeMcpSecret(getAgentDir(), "MiniMax", "MINIMAX_API_KEY", value);
        helper.configureMiniMax(getAgentDir(), host);
        ctx.ui.notify("MiniMax MCP configured privately. Run /reload to connect.", "info");
      } catch { ctx.ui.notify("MiniMax configuration was not completed. No key is shown or logged.", "warning"); }
    },
  });
  pi.registerCommand("mcp-key", {
    description: "Set an MCP environment key with hidden input; arguments are server and environment name only",
    handler: async (args, ctx) => {
      try {
        const helper = await helpers();
        let [server, envName, extra] = args.trim().split(/\s+/);
        if (extra) throw new Error("Keys must be entered in the private dialog, never in command arguments");
        if (!server) {
          const path = join(getAgentDir(), "mcp.json");
          const servers = existsSync(path) ? Object.keys(JSON.parse(readFileSync(path, "utf8")).mcpServers ?? {}) : [];
          if (!servers.length) throw new Error("No global MCP servers configured");
          const selected = await ctx.ui.select("MCP server", servers, { signal: ctx.signal });
          if (!selected) return; server = selected;
        }
        envName ||= server === "MiniMax" ? "MINIMAX_API_KEY" : "API_KEY";
        helper.validateSecretTarget(server, envName);
        const configPath = join(getAgentDir(), "mcp.json");
        const configured = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")).mcpServers?.[server] : undefined;
        if (!configured?.command || configured.url) throw new Error("Choose a configured stdio MCP server");
        const value = await promptMcpKey(ctx, `${server} / ${envName}`);
        if (!value) return;
        helper.storeMcpSecret(getAgentDir(), server, envName, value);
        helper.configureServerKey(getAgentDir(), server, envName);
        ctx.ui.notify("MCP key saved privately. Reconnect the server from /mcp to use it.", "info");
      } catch { ctx.ui.notify("MCP key was not saved. Check the server name, permissions, and interactive mode.", "warning"); }
    },
  });
  pi.registerCommand("mcp-project", {
    description: "Configure a trusted project's global-server override: server on|off codemode|deferred|direct|hidden",
    handler: async (args, ctx) => {
      try {
        if (!ctx.isProjectTrusted()) throw new Error("Project trust is required");
        const [server, enabled = "on", exposure = "codemode", extra] = args.trim().split(/\s+/);
        if (extra || !["on", "off"].includes(enabled)) throw new Error("Use server on|off exposure");
        const path = join(getAgentDir(), "mcp.json");
        const global = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
        if (!global.mcpServers?.[server]) throw new Error("Choose an existing global MCP server");
        const helper = await helpers();
        helper.projectMcpOverride(ctx.cwd, server, { enabled: enabled === "on", exposure });
        ctx.ui.notify("Project MCP override saved. Run /reload to apply.", "info");
      } catch { ctx.ui.notify("MCP project profile was not saved. Check trust, server name, and global configuration.", "warning"); }
    },
  });
}
