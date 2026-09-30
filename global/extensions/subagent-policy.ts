import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

/**
 * Model policy for child Pi sessions. The default is intentionally explicit:
 * without this extension, pi-matt-subagent inherits the parent model.
 */
export const DEFAULT_SUBAGENT_MODEL = "cpa/gemini-3.8-flash-high";
export const DEFAULT_SUBAGENT_THINKING = "high";
export const ALLOWED_SUBAGENT_MODELS = new Set([DEFAULT_SUBAGENT_MODEL]);
const CHILD_TOOLS = new Set(["subagent", "research"]);

function parseModel(input: Record<string, unknown>): string | undefined {
  if (typeof input.model === "string" && input.model.trim()) return input.model.trim();
  if (typeof input.input !== "string" || !input.input.trim()) return undefined;
  try {
    const nested = JSON.parse(input.input) as unknown;
    if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).model === "string") {
      const model = (nested as Record<string, unknown>).model as string;
      return model.trim() || undefined;
    }
  } catch {
    // pi-matt-subagent owns malformed input validation; this policy only
    // inspects a well-formed optional model field.
  }
  return undefined;
}

function requestedAgents(input: Record<string, unknown>): string[] {
  const names: string[] = [];
  if (typeof input.agent === "string") names.push(input.agent);
  for (const key of ["tasks", "chain"]) {
    const items = input[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).agent === "string") {
        names.push((item as Record<string, unknown>).agent as string);
      }
    }
  }
  return [...new Set(names)];
}

function nearestProjectAgent(cwd: string, name: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".pi", "agents", `${name}.md`);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function pinnedRoleModel(cwd: string, name: string): string | undefined {
  const candidates = [
    join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "agents", `${name}.md`),
    nearestProjectAgent(cwd, name),
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    try {
      const frontmatter = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---/);
      const model = frontmatter?.[1].match(/^model:\s*([^\s#]+)\s*$/m)?.[1];
      if (model) return model;
    } catch {
      // Discovery will report missing or malformed roles separately.
    }
  }
  return undefined;
}

function modelAllowed(model: string, approved: Set<string>): boolean {
  return ALLOWED_SUBAGENT_MODELS.has(model) || approved.has(model);
}

function policyStatus(approved: Set<string>, defaultModel: string): string {
  const approvedText = approved.size > 0 ? [...approved].join(", ") : "none";
  return `default=${defaultModel}; allowlist=${[...ALLOWED_SUBAGENT_MODELS].join(", ")}; session approvals=${approvedText}`;
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

export default function subagentPolicy(pi: ExtensionAPI): void {
  const approved = new Set<string>();
  let defaultModel = DEFAULT_SUBAGENT_MODEL;

  pi.registerCommand("subagent-model", {
    description: "Inspect or authorize the model policy for subagent and research children",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      let action = "";
      let model = "";

      if (trimmed) {
        // Text-based backward compatibility: /subagent-model allow provider/model
        [action, model] = trimmed.split(/\s+/, 2);
      } else if (ctx.mode === "tui" && ctx.ui?.custom) {
        const items: SelectItem[] = [
          { value: "status", label: "View current policy", description: policyStatus(approved, defaultModel) },
          { value: "allow", label: "Allow a model", description: "Authorize a model for this session" },
          ...(approved.size > 0 ? [{ value: "revoke", label: "Revoke a model", description: `${approved.size} model(s) currently approved` }] : []),
          { value: "default", label: "Set default model", description: `Current: ${defaultModel}` },
          { value: "reset", label: "Reset to defaults", description: "Clear all session overrides" },
        ];
        const chosen = await selectOption<string>(ctx, "Subagent Model Policy", policyStatus(approved, defaultModel), items);
        if (!chosen) return;
        action = chosen;
      }

      if (!action || action === "status") {
        ctx.ui.notify(policyStatus(approved, defaultModel), "info");
        return;
      }

      if (action === "allow") {
        if (!model && ctx.mode === "tui" && ctx.ui?.custom) {
          const registryModels: string[] = [];
          try {
            const available = (ctx as any).modelRegistry?.getAvailable?.() ?? [];
            for (const m of available) {
              const key = `${m.provider}/${m.id}`;
              if (!modelAllowed(key, approved)) registryModels.push(key);
            }
          } catch {}
          const items: SelectItem[] = [
            ...registryModels.map((m) => ({ value: m, label: m })),
            { value: "__custom__", label: "Type a model…", description: "Enter provider/model manually" },
          ];
          const chosen = await selectOption<string>(ctx, "Allow Model", "Select a model to authorize", items);
          if (!chosen) return;
          if (chosen === "__custom__") {
            const input = await ctx.ui.input?.("Allow Model", "Enter provider/model (e.g. hikari/gpt-6-astra)");
            if (!input?.trim()) return;
            model = input.trim();
          } else {
            model = chosen;
          }
        }
        if (!model) {
          ctx.ui.notify("Usage: /subagent-model allow provider/model", "warning");
          return;
        }
        approved.add(model);
        ctx.ui.notify(`Authorized ${model} for this session's subagent calls.`, "info");
        return;
      }

      if (action === "revoke") {
        if (!model && ctx.mode === "tui" && ctx.ui?.custom) {
          if (approved.size === 0) {
            ctx.ui.notify("No models currently approved to revoke.", "warning");
            return;
          }
          const items: SelectItem[] = [...approved].map((m) => ({ value: m, label: m }));
          const chosen = await selectOption<string>(ctx, "Revoke Model", "Select a model to revoke", items);
          if (!chosen) return;
          model = chosen;
        }
        if (!model) {
          ctx.ui.notify("Usage: /subagent-model revoke provider/model", "warning");
          return;
        }
        approved.delete(model);
        ctx.ui.notify(`Revoked session authorization for ${model}.`, "info");
        return;
      }

      if (action === "default") {
        if (!model && ctx.mode === "tui" && ctx.ui?.custom) {
          const allowedModels = [...new Set([...ALLOWED_SUBAGENT_MODELS, ...approved])];
          const items: SelectItem[] = allowedModels.map((m) => ({
            value: m,
            label: m + (m === defaultModel ? " (current)" : ""),
          }));
          const chosen = await selectOption<string>(ctx, "Set Default Model", "Choose default model for child sessions", items);
          if (!chosen) return;
          model = chosen;
        }
        if (!model) {
          ctx.ui.notify("Usage: /subagent-model default provider/model", "warning");
          return;
        }
        if (!modelAllowed(model, approved)) {
          ctx.ui.notify(`Refusing default ${model}. Authorize it first with /subagent-model allow ${model}.`, "error");
          return;
        }
        defaultModel = model;
        ctx.ui.notify(`Default child model set to ${model} for this session.`, "info");
        return;
      }

      if (action === "reset") {
        approved.clear();
        defaultModel = DEFAULT_SUBAGENT_MODEL;
        ctx.ui.notify("Subagent model policy reset for this session.", "info");
        return;
      }

      ctx.ui.notify(
        "Usage: /subagent-model | /subagent-model allow provider/model | /subagent-model revoke provider/model | /subagent-model default provider/model | /subagent-model reset",
        "warning",
      );
    },
  });

  pi.on("tool_call", (event, ctx: ExtensionContext) => {
    if (!CHILD_TOOLS.has(event.toolName)) return;
    const input = event.input as Record<string, unknown>;
    const requested = parseModel(input);
    if (requested && !modelAllowed(requested, approved)) {
      return {
        block: true,
        terminate: true,
        reason: `Subagent model ${requested} is blocked by policy. Ask the user to authorize it with /subagent-model allow ${requested}; the model cannot authorize itself. ${policyStatus(approved, defaultModel)}`,
      };
    }

    for (const agent of requestedAgents(input)) {
      const pinned = pinnedRoleModel(ctx.cwd, agent);
      if (pinned && !modelAllowed(pinned, approved)) {
        return {
          block: true,
          terminate: true,
          reason: `Agent role ${agent} pins blocked model ${pinned}. The user must authorize it with /subagent-model allow ${pinned} or change the role model.`,
        };
      }
    }

    // Direct hidden fields override JSON input in pi-matt-subagent's merge
    // contract. This prevents silent inheritance of an expensive parent model.
    input.model = requested ?? defaultModel;
    if (input.thinkingLevel === undefined) input.thinkingLevel = DEFAULT_SUBAGENT_THINKING;
    return undefined;
  });
}
