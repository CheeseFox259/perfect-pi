import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
      const action = parts[0] || "status";
      const feature = parts[1] || "default";
      const repoRoot = ctx.cwd || process.cwd();

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

        ctx.ui.notify("Usage: /tmux-tickets status [feature] | /tmux-tickets frontier [feature] | /tmux-tickets kill [feature]", "warning");
      } catch (err: any) {
        ctx.ui.notify(`Tmux supervisor error: ${err.message}`, "error");
      }
    },
  });
}
