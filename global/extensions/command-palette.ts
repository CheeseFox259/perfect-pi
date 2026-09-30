import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Model } from "@earendil-works/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

function discoverSpecs(cwd: string): { value: string; label: string; description: string }[] {
  if (!cwd) return [];
  const scratchDir = join(cwd, ".scratch");
  if (!existsSync(scratchDir)) return [];
  try {
    return readdirSync(scratchDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const specPath = join(".scratch", d.name, "spec.md");
        const issuesDir = join(scratchDir, d.name, "issues");
        const ticketCount = existsSync(issuesDir)
          ? readdirSync(issuesDir).filter((f) => f.endsWith(".md")).length
          : 0;
        return { name: d.name, specPath, hasSpec: existsSync(join(cwd, specPath)), ticketCount };
      })
      .filter((f) => f.hasSpec)
      .map((f) => ({
        value: f.specPath,
        label: f.name,
        description: f.ticketCount > 0 ? `${f.ticketCount} ticket(s)` : "spec.md",
      }));
  } catch {
    return [];
  }
}

function discoverGitTargets(cwd: string): SelectItem[] {
  if (!cwd) return [];
  const items: SelectItem[] = [];
  const run = (args: string[]): string => {
    try { return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000 }).trim(); }
    catch { return ""; }
  };
  // Working tree
  const diffStat = run(["diff", "--stat", "--no-color"]);
  if (diffStat) {
    const fileCount = diffStat.split("\n").length - 1;
    items.push({ value: "__working__", label: "Working tree changes", description: `${fileCount} file(s) changed` });
  }
  // Staged
  const stagedStat = run(["diff", "--cached", "--stat", "--no-color"]);
  if (stagedStat) {
    const fileCount = stagedStat.split("\n").length - 1;
    items.push({ value: "__staged__", label: "Staged changes", description: `${fileCount} file(s) staged` });
  }
  // Last commit
  const lastCommit = run(["log", "-1", "--oneline", "--no-color"]);
  if (lastCommit) {
    items.push({ value: "HEAD~1..HEAD", label: "Last commit", description: lastCommit.slice(0, 60) });
  }
  // Recent branches (non-current, up to 5)
  const currentBranch = run(["branch", "--show-current"]);
  const branches = run(["branch", "--sort=-committerdate", "--format=%(refname:short)", "--no-color"])
    .split("\n")
    .filter((b) => b && b !== currentBranch)
    .slice(0, 5);
  for (const branch of branches) {
    items.push({ value: `${branch}..HEAD`, label: `vs ${branch}`, description: `Diff from ${branch} to HEAD` });
  }
  return items;
}

const MAIN_ITEMS: SelectItem[] = [
  { value: "route", label: "Route", description: "Recommend next workflow (/skill:route)" },
  { value: "grill", label: "Grill", description: "Stress-test a plan or design (/skill:grilling)" },
  { value: "spec", label: "Spec", description: "Turn this conversation into a spec (/skill:to-spec)" },
  { value: "tickets", label: "Tickets", description: "Break a spec into slices with blockers (/skill:to-tickets)" },
  { value: "implement-spec", label: "Implement spec", description: "Work a ticket graph via subagents (/skill:implement-spec)" },
  { value: "maintain", label: "Maintain", description: "Audit upstream updates & reconcile overrides (/skill:maintain)" },
  { value: "verify", label: "Verify", description: "Run product verification (/verify)" },
  { value: "ui-check", label: "UI check", description: "Exercise browser flow (/ui-check)" },
  { value: "release-check", label: "Release check", description: "Check release readiness (/release-check)" },
  { value: "code-review", label: "Code review", description: "Two-axis code review (/skill:code-review)" },
  { value: "context", label: "Context", description: "Inspect current context (/context)" },
  { value: "model", label: "Model", description: "Switch active model (interactive picker)" },
  { value: "thinking", label: "Thinking", description: "Set thinking level budget" },
  { value: "tools", label: "Tools", description: "Toggle active tools (/tools)" },
  { value: "settings", label: "Settings", description: "Open configuration & preferences" },
  { value: "tmux-tickets", label: "Tmux tickets", description: "Observe parallel spec ticket sessions (/tmux-tickets)" },
];

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
    if (subtitle) {
      container.addChild(new Text(theme.fg("muted", subtitle)));
    }
    const list = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    list.onSelect = (item) => done(item.value as T);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "up/down navigate - enter select - esc cancel")));
    container.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
    return {
      render(width: number) { return container.render(width); },
      invalidate() { container.invalidate(); },
      handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
    };
  });
}

async function showPalette(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI || !ctx.ui?.custom) return;

  const selected = await selectOption<string>(ctx, "Perfect Pi", "Choose an action", MAIN_ITEMS);
  if (!selected) return;

  // 1. Model switching (direct API call, zero LLM messages)
  if (selected === "model") {
    const available = ctx.modelRegistry?.getAvailable() ?? [];
    if (available.length === 0) {
      ctx.ui.notify?.("No authenticated models found", "warning");
      return;
    }
    const currentModelKey = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
    const modelItems: SelectItem[] = available.map((m: Model<any>) => {
      const key = `${m.provider}/${m.id}`;
      const isCurrent = key === currentModelKey;
      return {
        value: key,
        label: `${m.name || m.id}${isCurrent ? " (active)" : ""}`,
        description: `${m.provider}/${m.id}`,
      };
    });
    const chosen = await selectOption<string>(ctx, "Select Model", `Current: ${currentModelKey || "none"}`, modelItems);
    if (!chosen) return;
    const target = available.find((m: Model<any>) => `${m.provider}/${m.id}` === chosen);
    if (target) {
      const ok = await pi.setModel(target);
      if (ok) {
        ctx.ui.notify?.(`Model switched to ${target.name || target.id}`, "info");
      } else {
        ctx.ui.notify?.(`Failed to switch to ${chosen}: missing credentials`, "error");
      }
    }
    return;
  }

  // 2. Thinking level setting (direct API call, zero LLM messages)
  if (selected === "thinking") {
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
    const currentLevel = pi.getThinkingLevel();
    const levelItems: SelectItem[] = levels.map((lvl) => ({
      value: lvl,
      label: `${lvl}${lvl === currentLevel ? " (active)" : ""}`,
      description: `Set thinking budget to ${lvl}`,
    }));
    const chosenLevel = await selectOption<typeof levels[number]>(ctx, "Thinking Level", `Current: ${currentLevel}`, levelItems);
    if (!chosenLevel) return;
    pi.setThinkingLevel(chosenLevel);
    ctx.ui.notify?.(`Thinking level set to ${chosenLevel}`, "info");
    return;
  }

  // 3. Settings navigation (opens built-in overlay via editor submission or extension panels)
  if (selected === "settings") {
    const settingItems: SelectItem[] = [
      { value: "pi-settings", label: "Pi Settings", description: "Insert /settings into editor (press Enter to open overlay)" },
      { value: "ccstyle", label: "UI & Style (/ccstyle)", description: "Open Claude Code style config panel" },
      { value: "tools", label: "Tools (/tools)", description: "Open tool enable/disable selector" },
    ];
    const chosenSetting = await selectOption<string>(ctx, "Settings", "Choose configuration area", settingItems);
    if (!chosenSetting) return;
    if (chosenSetting === "pi-settings") {
      ctx.ui.setEditorText?.("/settings");
      ctx.ui.notify?.("Press Enter to open Pi Settings", "info");
      return;
    }
    if (chosenSetting === "ccstyle") {
      pi.sendUserMessage("/ccstyle", { expandPromptTemplates: true });
      return;
    }
    if (chosenSetting === "tools") {
      pi.sendUserMessage("/tools", { expandPromptTemplates: true });
      return;
    }
    return;
  }

  // 4. Route task (prompts for task if editor is empty, then triggers skill:route)
  if (selected === "route") {
    let task = ctx.ui.getEditorText?.()?.trim() || "";
    if (!task) {
      const input = await ctx.ui.input?.("Route Task", "Enter the task you want to route (e.g. Add OAuth, fix payment bug)...");
      if (!input?.trim()) return;
      task = input.trim();
    } else {
      ctx.ui.setEditorText?.("");
    }
    pi.sendUserMessage(`/skill:route ${task}`, { expandPromptTemplates: true });
    return;
  }

  // 4b. Grill (stress-test a plan/design with interactive questionnaire)
  if (selected === "grill") {
    let task = ctx.ui.getEditorText?.()?.trim() || "";
    if (!task) {
      const input = await ctx.ui.input?.("Grill plan / design", "Enter the plan, design, or feature to stress-test...");
      if (!input?.trim()) return;
      task = input.trim();
    } else {
      ctx.ui.setEditorText?.("");
    }
    pi.sendUserMessage(`/skill:grilling ${task}`, { expandPromptTemplates: true });
    return;
  }

  // 4c. Spec (capture this conversation, or pass a feature reference)
  if (selected === "spec") {
    let task = ctx.ui.getEditorText?.()?.trim() || "";
    if (!task) {
      const input = await ctx.ui.input?.("Feature to specify", "Optional feature reference; leave empty to use the conversation...");
      if (input == null) return;
      task = input.trim();
    } else {
      ctx.ui.setEditorText?.("");
    }
    pi.sendUserMessage(task ? `/skill:to-spec ${task}` : "/skill:to-spec", { expandPromptTemplates: true });
    return;
  }

  // 4d. Tickets (break a spec or plan into vertical slices with blocking edges)
  if (selected === "tickets") {
    let ref = ctx.ui.getEditorText?.()?.trim() || "";
    if (ref) {
      ctx.ui.setEditorText?.("");
    } else {
      const specs = discoverSpecs(ctx.cwd);
      const items: SelectItem[] = [
        { value: "__conversation__", label: "Use current conversation", description: "Break the discussed plan into tickets" },
        ...specs,
        { value: "__custom__", label: "Type a path…", description: "Enter a spec path or issue number" },
      ];
      const chosen = await selectOption<string>(ctx, "Spec → Tickets", "Select a spec to break into ticket slices", items);
      if (chosen == null) return;
      if (chosen === "__custom__") {
        const input = await ctx.ui.input?.("Spec to break into tickets", "Enter a spec path or issue number…");
        if (!input?.trim()) return;
        ref = input.trim();
      } else if (chosen !== "__conversation__") {
        ref = chosen;
      }
    }
    pi.sendUserMessage(ref ? `/skill:to-tickets ${ref}` : "/skill:to-tickets", { expandPromptTemplates: true });
    return;
  }

  // 4e. Implement spec (work the ticket graph frontier with subagents)
  if (selected === "implement-spec") {
    let ref = ctx.ui.getEditorText?.()?.trim() || "";
    if (ref) {
      ctx.ui.setEditorText?.("");
    } else {
      const specs = discoverSpecs(ctx.cwd);
      const items: SelectItem[] = [
        { value: "__conversation__", label: "Use current conversation", description: "Implement from the discussed spec" },
        ...specs,
        { value: "__custom__", label: "Type a path…", description: "Enter a spec path or issue number" },
      ];
      const chosen = await selectOption<string>(ctx, "Implement Spec", "Select a spec to implement", items);
      if (chosen == null) return;
      if (chosen === "__custom__") {
        const input = await ctx.ui.input?.("Spec to implement", "Enter a spec path or issue number…");
        if (!input?.trim()) return;
        ref = input.trim();
      } else if (chosen !== "__conversation__") {
        ref = chosen;
      }
    }
    pi.sendUserMessage(ref ? `/skill:implement-spec ${ref}` : "/skill:implement-spec", { expandPromptTemplates: true });
    return;
  }

  // 4f. Maintain (audit upstream updates & reconcile overrides)
  if (selected === "maintain") {
    pi.sendUserMessage("/skill:maintain", { expandPromptTemplates: true });
    return;
  }

  // 5. Code review (git-aware target picker)
  if (selected === "code-review") {
    let ref = ctx.ui.getEditorText?.()?.trim() || "";
    if (ref) {
      ctx.ui.setEditorText?.("");
    } else {
      const gitItems = discoverGitTargets(ctx.cwd);
      const items: SelectItem[] = [
        ...gitItems,
        { value: "__custom__", label: "Type a ref…", description: "Enter a branch, commit, or diff range" },
      ];
      if (items.length > 1) {
        const chosen = await selectOption<string>(ctx, "Code Review", "Select what to review", items);
        if (chosen == null) return;
        if (chosen === "__working__" || chosen === "__staged__") {
          // Let code-review skill auto-detect
          ref = "";
        } else if (chosen === "__custom__") {
          const input = await ctx.ui.input?.("Code Review", "Enter a ref, branch, or diff range (e.g. main..HEAD)…");
          if (!input?.trim()) return;
          ref = input.trim();
        } else {
          ref = chosen;
        }
      }
    }
    pi.sendUserMessage(ref ? `/skill:code-review ${ref}` : "/skill:code-review", { expandPromptTemplates: true });
    return;
  }

  // 6. Verify (scope picker)
  if (selected === "verify") {
    let scope = ctx.ui.getEditorText?.()?.trim() || "";
    if (scope) {
      ctx.ui.setEditorText?.("");
    } else {
      const items: SelectItem[] = [
        { value: "", label: "All checks", description: "Run every available verification" },
        { value: "tests", label: "Tests only", description: "Run the project test suite" },
        { value: "types", label: "Type check", description: "Run the type checker" },
        { value: "build", label: "Build", description: "Verify the project builds cleanly" },
        { value: "lint", label: "Lint", description: "Run linter checks" },
        { value: "__custom__", label: "Type a scope…", description: "Enter a custom verification scope" },
      ];
      const chosen = await selectOption<string>(ctx, "Verify", "Select verification scope", items);
      if (chosen == null) return;
      if (chosen === "__custom__") {
        const input = await ctx.ui.input?.("Verify", "Enter a custom scope…");
        if (!input?.trim()) return;
        scope = input.trim();
      } else {
        scope = chosen;
      }
    }
    pi.sendUserMessage(scope ? `/verify ${scope}` : "/verify", { expandPromptTemplates: true });
    return;
  }

  // 7. UI check (passes optional flow from editor)
  if (selected === "ui-check") {
    const flow = ctx.ui.getEditorText?.()?.trim() || "";
    if (flow) {
      ctx.ui.setEditorText?.("");
      pi.sendUserMessage(`/ui-check ${flow}`, { expandPromptTemplates: true });
    } else {
      pi.sendUserMessage("/ui-check", { expandPromptTemplates: true });
    }
    return;
  }

  // 8. Release check (passes optional scope from editor)
  if (selected === "release-check") {
    const scope = ctx.ui.getEditorText?.()?.trim() || "";
    if (scope) {
      ctx.ui.setEditorText?.("");
      pi.sendUserMessage(`/release-check ${scope}`, { expandPromptTemplates: true });
    } else {
      pi.sendUserMessage("/release-check", { expandPromptTemplates: true });
    }
    return;
  }

  // 9. Context inspection (extension command)
  if (selected === "context") {
    pi.sendUserMessage("/context", { expandPromptTemplates: true });
    return;
  }

  // 10. Tools configuration (extension command)
  if (selected === "tools") {
    pi.sendUserMessage("/tools", { expandPromptTemplates: true });
    return;
  }

  // 11. Tmux ticket supervisor (triggers interactive selection)
  if (selected === "tmux-tickets") {
    pi.sendUserMessage("/tmux-tickets", { expandPromptTemplates: true });
    return;
  }
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("palette", {
    description: "Open the Perfect Pi command palette",
    handler: async (_args, ctx) => showPalette(pi, ctx),
  });
  pi.registerShortcut(Key.ctrlShift("p"), {
    description: "Open the Perfect Pi command palette",
    handler: async (ctx) => showPalette(pi, ctx),
  });
}
