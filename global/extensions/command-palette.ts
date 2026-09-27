import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Model } from "@earendil-works/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const MAIN_ITEMS: SelectItem[] = [
  { value: "route", label: "Route", description: "Recommend next workflow (/skill:route)" },
  { value: "grill", label: "Grill", description: "Stress-test a plan or design (/skill:grilling)" },
  { value: "verify", label: "Verify", description: "Run product verification (/verify)" },
  { value: "ui-check", label: "UI check", description: "Exercise browser flow (/ui-check)" },
  { value: "release-check", label: "Release check", description: "Check release readiness (/release-check)" },
  { value: "code-review", label: "Code review", description: "Two-axis code review (/skill:code-review)" },
  { value: "context", label: "Context", description: "Inspect current context (/context)" },
  { value: "model", label: "Model", description: "Switch active model (interactive picker)" },
  { value: "thinking", label: "Thinking", description: "Set thinking level budget" },
  { value: "tools", label: "Tools", description: "Toggle active tools (/tools)" },
  { value: "settings", label: "Settings", description: "Open configuration & preferences" },
];

async function selectOption<T extends string>(
  ctx: ExtensionContext,
  title: string,
  subtitle: string,
  items: SelectItem[],
): Promise<T | null> {
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
  if (!ctx.hasUI) return;

  const selected = await selectOption<string>(ctx, "Perfect Pi", "Choose an action", MAIN_ITEMS);
  if (!selected) return;

  // 1. Model switching (direct API call, zero LLM messages)
  if (selected === "model") {
    const available = ctx.modelRegistry?.getAvailable() ?? [];
    if (available.length === 0) {
      ctx.ui.notify("No authenticated models found", "warning");
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
        ctx.ui.notify(`Model switched to ${target.name || target.id}`, "info");
      } else {
        ctx.ui.notify(`Failed to switch to ${chosen}: missing credentials`, "error");
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
    ctx.ui.notify(`Thinking level set to ${chosenLevel}`, "info");
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
      ctx.ui.setEditorText("/settings");
      ctx.ui.notify("Press Enter to open Pi Settings", "info");
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
      const input = await ctx.ui.input("Route Task", "Enter the task you want to route (e.g. Add OAuth, fix payment bug)...");
      if (!input?.trim()) return;
      task = input.trim();
    } else {
      ctx.ui.setEditorText("");
    }
    pi.sendUserMessage(`/skill:route ${task}`, { expandPromptTemplates: true });
    return;
  }

  // 4b. Grill (stress-test a plan/design with interactive questionnaire)
  if (selected === "grill") {
    let task = ctx.ui.getEditorText?.()?.trim() || "";
    if (!task) {
      const input = await ctx.ui.input("Grill plan / design", "Enter the plan, design, or feature to stress-test...");
      if (!input?.trim()) return;
      task = input.trim();
    } else {
      ctx.ui.setEditorText("");
    }
    pi.sendUserMessage(`/skill:grilling ${task}`, { expandPromptTemplates: true });
    return;
  }

  // 5. Code review (passes optional diff ref from editor or asks)
  if (selected === "code-review") {
    const ref = ctx.ui.getEditorText?.()?.trim() || "";
    if (ref) {
      ctx.ui.setEditorText("");
      pi.sendUserMessage(`/skill:code-review ${ref}`, { expandPromptTemplates: true });
    } else {
      pi.sendUserMessage("/skill:code-review", { expandPromptTemplates: true });
    }
    return;
  }

  // 6. Verify (passes optional scope from editor)
  if (selected === "verify") {
    const scope = ctx.ui.getEditorText?.()?.trim() || "";
    if (scope) {
      ctx.ui.setEditorText("");
      pi.sendUserMessage(`/verify ${scope}`, { expandPromptTemplates: true });
    } else {
      pi.sendUserMessage("/verify", { expandPromptTemplates: true });
    }
    return;
  }

  // 7. UI check (passes optional flow from editor)
  if (selected === "ui-check") {
    const flow = ctx.ui.getEditorText?.()?.trim() || "";
    if (flow) {
      ctx.ui.setEditorText("");
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
      ctx.ui.setEditorText("");
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
