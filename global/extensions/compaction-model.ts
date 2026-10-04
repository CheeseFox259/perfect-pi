import { compact, getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseModelRoute, readCompactionModel, writeCompactionModel } from "./compaction-settings.mjs";

export async function compactWithConfiguredModel(event: any, ctx: ExtensionContext, storage: any, nativeCompact = compact) {
  if (event.signal.aborted) return { cancel: true };
  let route = "configured model";
  try {
    const configured = readCompactionModel(storage);
    route = `${configured.provider}/${configured.model}`;
    const model = ctx.modelRegistry.find(configured.provider, configured.model);
    if (!model) throw new Error("Model unavailable");
    // Keep Pi's split-turn summaries, file tracking and kept-entry semantics. The registry
    // resolves credentials, provider headers and transport for the selected model.
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
    const result = await nativeCompact(event.preparation, model, undefined, undefined,
      event.customInstructions, event.signal, "off",
      (selected, context, options) => {
        const stream = ctx.modelRegistry.streamSimple(selected, context, options);
        const result = stream.result.bind(stream);
        stream.result = async () => {
          const response = await result();
          if (response.stopReason === "stop" && !response.content.some(block => block.type === "text" && block.text.trim())) {
            throw new Error("Empty summary response");
          }
          return response;
        };
        return stream;
      },
      undefined, settings.getRetrySettings());
    if (event.signal.aborted) return { cancel: true };
    if (!result.summary?.trim()) throw new Error("Empty summary");
    return { compaction: { ...result, details: { ...result.details, perfectPiCompaction: { route, reason: event.reason } } } };
  } catch {
    if (event.signal.aborted) return { cancel: true };
    ctx.ui.notify(`Compaction with ${route} failed; using the current conversation model.`, "warning");
    // Returning no override lets Pi run its normal compaction, not a second custom call.
    return undefined;
  }
}

export default async function compactionModel(pi: ExtensionAPI) {
  // Pi has no public setter for extension-owned global preferences. Isolate the
  // storage bridge here and verify it in the compatibility canary.
  const here = dirname(fileURLToPath(import.meta.url));
  const resolverPath = [join(here, "../scripts/pi-runtime.mjs"), join(here, "../../scripts/pi-runtime.mjs")].find(existsSync);
  if (!resolverPath) throw new Error("Managed Pi runtime resolver not found");
  const { detectPiRuntime } = await import(pathToFileURL(resolverPath).href);
  let entry: string;
  try {
    entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  } catch {
    const runtime = await detectPiRuntime();
    if (!runtime) throw new Error("Pi runtime not found");
    entry = runtime.entry;
  }
  const { FileSettingsStorage } = await import(pathToFileURL(join(dirname(entry), "core/settings-manager.js")).href);
  const storage = new FileSettingsStorage(process.cwd(), getAgentDir());
  pi.on("session_before_compact", (event, ctx) => compactWithConfiguredModel(event, ctx, storage));
  pi.registerCommand("compaction-model", {
    description: "Choose the global compaction model, or pass provider/modelId",
    handler: async (args, ctx) => {
      try {
        if (args.trim() === "status") {
          const configured = readCompactionModel(storage);
          ctx.ui.notify(`Compaction model: ${configured.provider}/${configured.model}`, "info");
          return;
        }
        let route = args.trim();
        if (!route) {
          if (!ctx.hasUI) throw new Error("Pass provider/modelId or status");
          const configured = readCompactionModel(storage);
          const models = ctx.modelRegistry.getAvailable();
          const routes = models.map(model => `${model.provider}/${model.id}`);
          const current = `${configured.provider}/${configured.model}`;
          routes.sort((a, b) => a === b ? 0 : a === current ? -1 : b === current ? 1 : a.localeCompare(b));
          if (!routes.length) throw new Error("No authenticated models available");
          const selected = await ctx.ui.select(`Global compaction model: ${current}`, routes,
            { signal: ctx.signal, timeout: 60_000 });
          if (!selected) return;
          route = selected;
        }
        const configured = parseModelRoute(route);
        if (!ctx.modelRegistry.find(configured.provider, configured.model)) throw new Error(`Unknown model: ${route}`);
        writeCompactionModel(storage, configured);
        ctx.ui.notify(`Global compaction model set to ${route}`, "info");
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
    },
  });
}
