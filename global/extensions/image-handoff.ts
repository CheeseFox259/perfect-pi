import { existsSync, readFileSync, statSync, lstatSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "typebox";
import { Container, Text, SelectList, Input, Key, matchesKey } from "@earendil-works/pi-tui";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export async function waitForImage(ctx: any, prompt: string, signal?: AbortSignal): Promise<{ action: string; path?: string }> {
  if (signal?.aborted) return { action: "cancel" };
  return ctx.ui.custom((tui: any, theme: any, _keys: any, done: any) => {
    const container = new Container();
    const input = new Input();
    let enteringPath = false, settled = false, promptOffset = 0;
    const finish = (value: any) => { if (settled) return; settled = true; signal?.removeEventListener("abort", abort); done(value); };
    const abort = () => finish({ action: "cancel" });
    const list = new SelectList([
      { value: "clipboard", label: "Import Clipboard Image" },
      { value: "file", label: "Import Image File" },
      { value: "skip", label: "Skip Image" },
    ], 3, { selectedPrefix: (s: string) => theme.fg("accent", s), selectedText: (s: string) => theme.fg("accent", s), description: (s: string) => s,
      scrollInfo: (s: string) => s, noMatch: (s: string) => s });
    list.onSelect = (item: any) => { if (item.value === "file") { enteringPath = true; input.focused = true; } else finish({ action: item.value }); };
    list.onCancel = () => finish({ action: "cancel" });
    input.onSubmit = (path: string) => { if (path.trim()) finish({ action: "file", path: path.trim() }); };
    container.addChild(new Text(theme.fg("accent", "Generate Image In Browser"), 0, 0));
    container.addChild(new Text(prompt, 0, 1));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    return {
      get focused() { return input.focused; }, set focused(value: boolean) { input.focused = value && enteringPath; },
      render(width: number) {
        const choices = enteringPath ? input.render(width) : list.render(width);
        const rows = Math.max(4, (tui.terminal?.rows ?? 40) - choices.length - 8);
        const promptLines = container.render(width);
        promptOffset = Math.min(promptOffset, Math.max(0, promptLines.length - rows));
        return [...promptLines.slice(promptOffset, promptOffset + rows), ...(promptLines.length > rows ? ["Prompt: Page Up / Page Down"] : []), ...choices];
      },
      invalidate() { container.invalidate(); },
      handleInput(data: string) {
        if (matchesKey(data, Key.pageDown)) promptOffset += Math.max(1, (tui.terminal?.rows ?? 40) - 12);
        else if (matchesKey(data, Key.pageUp)) promptOffset = Math.max(0, promptOffset - Math.max(1, (tui.terminal?.rows ?? 40) - 12));
        else if (enteringPath && matchesKey(data, Key.escape)) { enteringPath = false; input.setValue(""); }
        else if (enteringPath) input.handleInput(data); else list.handleInput(data);
        tui.requestRender();
      },
      dispose() { signal?.removeEventListener("abort", abort); input.setValue(""); },
    };
  });
}
export default function imageHandoff(pi: ExtensionAPI) {
  pi.registerTool({
    name: "image_handoff", label: "Image Handoff", exposure: "model-only", executionMode: "sequential",
    description: "Present a web image-generation prompt and wait for the user to return a clipboard image or file. No image API. Cancel/skip returns without a generated asset.",
    promptGuidelines: ["Replace only the image-model invocation. Prepare the same complete design prompt as for a direct image-model call; preserve its style, language, constraints and detail. Keep clipboard/file instructions outside the prompt. Do not add test markers except in an explicit workflow test."],
    parameters: Type.Object({ prompt: Type.String({ minLength: 1, description: "Complete, unchanged image-model prompt only. No handoff instructions." }), destination: Type.Optional(Type.String()) }),
    async execute(_id, params, signal, update, ctx) {
      if (ctx.mode !== "tui" || !ctx.hasUI || !ctx.ui?.custom) return { content: [{ type: "text", text: "Image generation prompt (copy the following block unchanged):" }, { type: "text", text: params.prompt }, { type: "text", text: "Waiting for the user to return an image; do not continue visual implementation." }], details: { status: "waiting_for_image" }, terminate: true };
      update?.({ content: [{ type: "text", text: params.prompt }], details: { status: "waiting_for_image" } });
      const choice = await waitForImage(ctx, params.prompt, signal);
      if (["cancel", "skip"].includes(choice.action)) return { content: [{ type: "text", text: `Image handoff ${choice.action}; no image received.` }], details: { status: choice.action }, terminate: choice.action === "cancel" };
      try {
        if (signal?.aborted) throw new Error("cancelled");
        let path;
        if (choice.action === "clipboard") {
          path = resolve(ctx.cwd, params.destination ?? `.scratch/mockup-${Date.now()}.png`);
          const target = relative(ctx.cwd, path);
          if (!target || target.startsWith("..") || isAbsolute(target) || existsSync(path)) throw new Error("Choose a new image path inside the project");
          let parent = dirname(path);
          while (parent !== resolve(ctx.cwd)) {
            if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error("Unsafe image directory");
            const next = dirname(parent); if (next === parent) throw new Error("Unsafe image directory"); parent = next;
          }
          const here = dirname(fileURLToPath(import.meta.url));
          const helper = [join(getAgentDir(), "scripts/clipboard-image.mjs"), join(here, "../../scripts/clipboard-image.mjs")].find(existsSync);
          if (!helper) throw new Error("Managed clipboard helper not found");
          const { extractClipboardImage } = await import(pathToFileURL(helper).href);
          const result = extractClipboardImage(path);
          if (!result.ok) throw new Error("Clipboard does not contain a supported image");
        } else path = resolve(ctx.cwd, choice.path!);
        if (!statSync(path).isFile() || statSync(path).size > 10 * 1024 * 1024) throw new Error("Unsupported image file");
        const image = readFileSync(path);
        const mimeType = image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
          : image[0] === 255 && image[1] === 216 && image[2] === 255 ? "image/jpeg"
          : image.subarray(0, 4).toString() === "RIFF" && image.subarray(8, 12).toString() === "WEBP" ? "image/webp" : undefined;
        if (!mimeType || image.length > 10 * 1024 * 1024) throw new Error("Unsupported image or image exceeds 10 MiB");
        return { content: [{ type: "text", text: `Returned image: ${path}` }, { type: "image", data: image.toString("base64"), mimeType }], details: { status: "received", path } };
      } catch {
        return { content: [{ type: "text", text: "Image import failed. Ask the user to return a valid PNG/JPEG/WebP image; do not invent the missing image." }], details: { status: "waiting_for_image" }, isError: true, terminate: true };
      }
    },
  });
}
