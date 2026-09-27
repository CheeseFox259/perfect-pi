import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const ITEMS: SelectItem[] = [
  { value: "route", label: "Route", description: "Recommend next workflow (/skill:route)" },
  { value: "verify", label: "Verify", description: "Run product verification (/verify)" },
  { value: "ui-check", label: "UI check", description: "Exercise browser flow (/ui-check)" },
  { value: "release-check", label: "Release check", description: "Check release readiness (/release-check)" },
  { value: "code-review", label: "Code review", description: "Two-axis code review (/skill:code-review)" },
  { value: "context", label: "Context", description: "Inspect current context (/context)" },
  { value: "model", label: "Model", description: "Open the model selector (/model)" },
  { value: "settings", label: "Settings", description: "Open Pi settings (/settings)" },
];

async function showPalette(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Perfect Pi"))));
    container.addChild(new Text(theme.fg("muted", "Choose an action")));
    const list = new SelectList(ITEMS, Math.min(ITEMS.length, 9), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    list.onSelect = (item) => done(item.value);
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

  if (!selected) return;
  if (selected === "model") {
    pi.sendUserMessage("/model", { expandPromptTemplates: true });
    return;
  }
  if (selected === "settings") {
    pi.sendUserMessage("/settings", { expandPromptTemplates: true });
    return;
  }
  if (selected === "route") {
    pi.sendUserMessage("/skill:route", { expandPromptTemplates: true });
    return;
  }
  if (selected === "code-review") {
    pi.sendUserMessage("/skill:code-review", { expandPromptTemplates: true });
    return;
  }
  pi.sendUserMessage(`/${selected}`, { expandPromptTemplates: true });
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
