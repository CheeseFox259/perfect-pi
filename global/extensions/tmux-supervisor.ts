import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getEngine() {
  const candidates = [
    resolve(__dirname, "../../scripts/tmux-tickets.mjs"),
    resolve(__dirname, "../scripts/tmux-tickets.mjs"),
    resolve(process.cwd(), "scripts/tmux-tickets.mjs"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return import(c);
    }
  }
  throw new Error("Could not find tmux-tickets.mjs in expected paths.");
}

function discoverFeatures(repoRoot: string): { name: string; ticketCount: number }[] {
  const scratchDir = join(repoRoot, ".scratch");
  if (!existsSync(scratchDir)) return [];
  try {
    return readdirSync(scratchDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(scratchDir, d.name, "issues")))
      .map((d) => {
        const issuesDir = join(scratchDir, d.name, "issues");
        const count = readdirSync(issuesDir).filter((f) => f.endsWith(".md")).length;
        return { name: d.name, ticketCount: count };
      })
      .filter((f) => f.ticketCount > 0);
  } catch {
    return [];
  }
}

async function selectOption<T extends string>(
  ctx: ExtensionContext,
  title: string,
  subtitle: string,
  items: SelectItem[],
): Promise<T | null> {
  if (!ctx.ui?.custom) return null;
  return ctx.ui.custom<T | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title))));
    if (subtitle) container.addChild(new Text(theme.fg("muted", subtitle)));
    const list = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    list.onSelect = (item) => done(item.value as T);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel")));
    container.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (d: string) => { list.handleInput(d); tui.requestRender(); },
    };
  });
}

export default function tmuxSupervisorExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tmux_tickets",
    label: "Tmux Ticket Supervisor",
    description: "Supervise spec ticket execution across parallel tmux sessions with a live observability dashboard. Dispatches tasks to isolated git worktrees, runs children with cpa/gemini-3.8-flash-high, and tracks execution status.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("frontier"),
        Type.Literal("dispatch"),
        Type.Literal("status"),
        Type.Literal("wait"),
        Type.Literal("kill"),
      ]),
      feature: Type.String({ description: "Feature slug corresponding to .scratch/<feature>/" }),
      spec: Type.Optional(Type.String({ description: "Path to spec markdown file" })),
      tickets: Type.Optional(Type.Array(Type.String(), { description: "Optional list of ticket IDs to force-dispatch" })),
      integrationBranch: Type.Optional(Type.String({ description: "Base branch to branch from and merge into" })),
      sessionName: Type.Optional(Type.String({ description: "Custom tmux session name (defaults to pi-spec-<feature>)" })),
      wait: Type.Optional(Type.Boolean({ description: "Whether to wait until all dispatched tickets finish" })),
      timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout in seconds when waiting (default: 600)" })),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const engine = await getEngine();
      const repoRoot = ctx.cwd || process.cwd();

      if (params.action === "frontier") {
        const all = engine.findFeatureTickets(repoRoot, params.feature);
        const frontier = engine.computeFrontier(all);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                feature: params.feature,
                totalTickets: all.length,
                frontierTickets: frontier.map((t: any) => ({
                  id: t.id,
                  title: t.title,
                  blockedBy: t.blockedBy,
                  branch: t.branch,
                })),
              }, null, 2),
            },
          ],
        };
      }

      if (params.action === "dispatch") {
        const res = await engine.dispatchFrontier({
          repoRoot,
          feature: params.feature,
          spec: params.spec,
          ticketIds: params.tickets,
          integrationBranch: params.integrationBranch,
          sessionName: params.sessionName,
          wait: params.wait ?? false,
          timeoutMs: (params.timeoutSeconds ?? 600) * 1000,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      }

      if (params.action === "status") {
        const status = engine.getRunStatus(repoRoot, params.feature);
        return {
          content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        };
      }

      if (params.action === "wait") {
        const status = engine.getRunStatus(repoRoot, params.feature);
        if (!status.exists || status.tickets.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "No active run found to wait for." }) }],
          };
        }
        const ids = status.tickets.map((t: any) => t.ticketId);
        const waitResult = await engine.waitForRun(status.runDir, ids, (params.timeoutSeconds ?? 600) * 1000);
        return {
          content: [{ type: "text", text: JSON.stringify(waitResult, null, 2) }],
        };
      }

      if (params.action === "kill") {
        const sName = params.sessionName || `pi-spec-${params.feature}`;
        const killed = engine.killTmuxSession(sName);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sessionName: sName, killed }),
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown action: ${params.action}` }) }],
      };
    },
  });

  pi.registerCommand("tmux-tickets", {
    description: "Manage and observe parallel tmux ticket sessions (/tmux-tickets [status|frontier|kill] [feature])",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const repoRoot = ctx.cwd || process.cwd();
      let action = parts[0] || "";
      let feature = parts[1] || "";

      // Interactive mode when no args provided
      if (!action && ctx.mode === "tui" && ctx.ui?.custom) {
        const chosen = await selectOption<string>(ctx, "Tmux Ticket Supervisor", "Manage parallel spec ticket sessions", [
          { value: "status", label: "View run status", description: "Inspect active or latest ticket run" },
          { value: "frontier", label: "Show frontier tickets", description: "List tickets ready for dispatch" },
          { value: "kill", label: "Kill tmux session", description: "Terminate an active tmux session" },
        ]);
        if (!chosen) return;
        action = chosen;
      }
      if (!action) action = "status";

      // Interactive feature selection when not specified
      if (!feature && ctx.mode === "tui" && ctx.ui?.custom) {
        const features = discoverFeatures(repoRoot);
        if (features.length === 0) {
          feature = "default";
        } else if (features.length === 1) {
          feature = features[0].name;
        } else {
          const items: SelectItem[] = features.map((f) => ({
            value: f.name,
            label: f.name,
            description: `${f.ticketCount} ticket(s)`,
          }));
          const chosen = await selectOption<string>(ctx, "Select Feature", "Choose a feature to inspect", items);
          if (!chosen) return;
          feature = chosen;
        }
      }
      if (!feature) feature = "default";

      try {
        const engine = await getEngine();
        if (action === "frontier") {
          const all = engine.findFeatureTickets(repoRoot, feature);
          const frontier = engine.computeFrontier(all);
          const summary = frontier.length === 0
            ? `Feature '${feature}': No tickets on the frontier.`
            : `Feature '${feature}': ${frontier.length} frontier tickets ready:\n` +
              frontier.map((t: any) => `  #${t.id}: ${t.title}`).join("\n");
          ctx.ui.notify(summary, "info");
          return;
        }

        if (action === "status") {
          const res = engine.getRunStatus(repoRoot, feature);
          if (!res.exists) {
            ctx.ui.notify(`No ticket runs found for feature '${feature}'.`, "warning");
            return;
          }
          const liveText = res.sessionAlive ? "ALIVE (attach: tmux attach -t " + res.sessionName + ")" : "INACTIVE";
          const counts = res.tickets.reduce((acc: any, t: any) => {
            acc[t.status] = (acc[t.status] || 0) + 1;
            return acc;
          }, {});
          const countsText = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
          ctx.ui.notify(`Session ${res.sessionName} [${liveText}]\nTickets (${res.tickets.length}): ${countsText}`, "info");
          return;
        }

        if (action === "kill") {
          const sName = `pi-spec-${feature}`;
          const killed = engine.killTmuxSession(sName);
          ctx.ui.notify(killed ? `Killed tmux session '${sName}'.` : `Session '${sName}' was not running.`, "info");
          return;
        }

        ctx.ui.notify("Usage: /tmux-tickets [status|frontier|kill] [feature]", "warning");
      } catch (err: any) {
        ctx.ui.notify(`Tmux supervisor error: ${err.message}`, "error");
      }
    },
  });
}
