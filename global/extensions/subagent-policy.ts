import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export default function subagentPolicy(pi: ExtensionAPI): void {
  const approved = new Set<string>();
  let defaultModel = DEFAULT_SUBAGENT_MODEL;

  pi.registerCommand("subagent-model", {
    description: "Inspect or authorize the model policy for subagent and research children",
    handler: async (args, ctx) => {
      const [action, model] = args.trim().split(/\s+/, 2);
      if (!action) {
        ctx.ui.notify(policyStatus(approved, defaultModel), "info");
        return;
      }
      if (action === "allow" && model) {
        approved.add(model);
        ctx.ui.notify(`Authorized ${model} for this session's subagent calls.`, "info");
        return;
      }
      if (action === "revoke" && model) {
        approved.delete(model);
        ctx.ui.notify(`Revoked session authorization for ${model}.`, "info");
        return;
      }
      if (action === "default" && model) {
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
