import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, DynamicBorder, Key, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const ITEMS: SelectItem[] = [
  { value: "verify", label: "Verify", description: "Run product verification" },
  { value: "ui-check", label: "UI check", description: "Exercise the affected browser flow" },
  { value: "review", label: "Review", description: "Review the current diff" },
  { value: "release-check", label: "Release check", description: "Check release readiness" },
  { value: "context", label: "Context", description: "Inspect current context" },
  { value: "files", label: "Files", description: "Browse referenced and changed files" },
  { value: "model", label: "Model", description: "Open the model selector" },
  { value: "settings", label: "Settings", description: "Open Pi settings" },
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
    await pi.sendUserMessage("Open the model selector so I can choose the active model.");
    return;
  }
  if (selected === "settings") {
    await pi.sendUserMessage("Open Pi settings.");
    return;
  }
  await pi.sendUserMessage(`Run the /${selected} workflow now.`);
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
