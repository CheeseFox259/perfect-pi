import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function init(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const habitsDir = join(agentDir, "habits");
  const scriptsDir = join(agentDir, "scripts");

  const loadHabits = () => import(pathToFileURL(join(scriptsDir, "model-habits.mjs")).href);

  pi.on("before_agent_start", async (event, ctx) => {
    const model = ctx.model;
    if (!model) return;
    try {
      const { resolveHabitsFile, readHabits } = await loadHabits();
      const resolved = resolveHabitsFile(habitsDir, model.id);
      if (!resolved) return;
      const { lines, truncated } = readHabits(resolved.path);
      if (lines.length === 0) return;
      for (const line of lines) {
        event.systemPromptOptions.promptGuidelines.push(line);
      }
      if (truncated) {
        ctx.ui?.notify?.(
          `Model habits for ${resolved.name} exceeded limit and were truncated. Edit with /habits edit.`,
          "warning",
        );
      }
    } catch {}
  });

  pi.registerCommand("habits", {
    description: "View, edit, or list model habit correction prompts",
    handler: async (args, ctx) => {
      const { normalizeModelId, resolveHabitsFile, readHabits, listHabits } = await loadHabits();
      const sub = args.trim().split(/\s+/)[0];

      if (sub === "list") {
        const habits = listHabits(habitsDir);
        if (habits.length === 0) {
          ctx.ui.notify("No habit files found.", "info");
          return;
        }
        const summary = habits.map(
          (h: any) => `  ${h.name.padEnd(36)} ${h.lineCount} rule${h.lineCount !== 1 ? "s" : ""}`,
        );
        ctx.ui.notify(`Model habits:\n${summary.join("\n")}`, "info");
        return;
      }

      if (sub === "edit") {
        const modelId = args.replace(/^edit\s*/, "").trim() || ctx.model?.id;
        if (!modelId) { ctx.ui.notify("No model selected.", "warning"); return; }
        const normalized = normalizeModelId(modelId);
        const filePath = join(habitsDir, `${normalized}.md`);
        if (!existsSync(habitsDir)) mkdirSync(habitsDir, { recursive: true });
        if (!existsSync(filePath)) writeFileSync(filePath, "- \n", "utf8");
        const editor = process.env.EDITOR || "vi";
        const { execFileSync } = await import("node:child_process");
        execFileSync(editor, [filePath], { stdio: "inherit" });
        ctx.ui.notify(`Habits for ${normalized} saved. Changes take effect next turn.`, "info");
        return;
      }

      // Default: show current model's habits
      const modelId = sub || ctx.model?.id;
      if (!modelId) { ctx.ui.notify("No model selected.", "warning"); return; }
      const queryId = sub || (ctx.model?.id ?? modelId);
      const resolved = resolveHabitsFile(habitsDir, queryId);
      if (!resolved) {
        const norm = normalizeModelId(queryId);
        ctx.ui.notify(
          `No habits for ${norm}.\nCreate: ${join(habitsDir, norm + ".md")}\nOr run: /habits edit`,
          "info",
        );
        return;
      }
      const { lines, truncated } = readHabits(resolved.path);
      const display = lines.map((l: string) => `  - ${l}`).join("\n");
      ctx.ui.notify(
        `Habits for ${resolved.name} (${lines.length} rule${lines.length !== 1 ? "s" : ""})${truncated ? " [TRUNCATED]" : ""}:\n${display}`,
        "info",
      );
    },
  });
}
