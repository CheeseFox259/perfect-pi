import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createEditToolDefinition, createWriteToolDefinition, DefaultPackageManager,
  getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext, type ExtensionToolContext, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const SOL_PI_SOURCE = "git:github.com/NVlabs/SoL-Pi@e1a586af0ad8956f42ae5b26bba20e48fbf30e00";
const REDUCER_ROUTE = "cpa/gemini-3.8-flash-high";

export function combineUsage(left: any, right: any) {
  if (!left) return right;
  if (!right) return left;
  return {
    ...left,
    ...Object.fromEntries(["input", "output", "cacheRead", "cacheWrite", "totalTokens"].map((key) => [key, (left[key] ?? 0) + (right[key] ?? 0)])),
    cost: Object.fromEntries(["input", "output", "cacheRead", "cacheWrite", "total"].map((key) => [key, (left.cost?.[key] ?? 0) + (right.cost?.[key] ?? 0)])),
  };
}

export function registerSafeFusion(pi: ExtensionAPI, queue: any, hashGuard: any) {
  const thenRun = Type.Optional(Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ minimum: 0 })) }));
  const factories: Array<(cwd: string) => ToolDefinition<any, any, any>> = [createEditToolDefinition, createWriteToolDefinition];
  for (const create of factories) {
    const template = create(process.cwd());
    const parameters = Type.Object({ ...template.parameters.properties, then_run: thenRun });
    pi.registerTool<any, any, any>({
      ...template,
      parameters,
      description: `${template.description} Optional then_run executes a bounded validation command through Pi's guarded bash tool after a successful mutation. A failed validation keeps the mutation. Use process for persistent servers.`,
      async execute(id, input: any, signal, update, ctx: ExtensionToolContext) {
        const { then_run, ...mutation } = input;
        return queue.withFusedFileQueue(queue.resolveToolPath(ctx.cwd, input.path), async () => {
          const result = await create(ctx.cwd).execute(id, mutation, signal, update, ctx);
          if (!then_run || result.isError) return result;
          try {
            await hashGuard(queue.resolveToolPath(ctx.cwd, input.path));
          } catch (error) {
            return { ...result, isError: true, content: [...result.content, { type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
          }
          const command = await ctx.executeTool("bash", then_run, { signal });
          const text = command.result.content.filter((block) => block.type === "text").map((block: any) => block.text).join("\n");
          return {
            ...result,
            isError: command.isError,
            content: [...result.content, { type: "text" as const, text: `[then_run:${command.isError ? "failed" : "succeeded"}]\n${text}` }],
            details: { ...result.details, thenRun: { isError: command.isError, details: command.result.details } },
          };
        });
      },
    });
  }
}

export function registerAccountedReducer(pi: ExtensionAPI, reducer: any, ctxConfig: any) {
  const callsBySession = new Map<string, number>();
  // Wrap only the reducer's registry calls; other extensions keep the original context.
  const bridge = Object.create(pi);
  bridge.on = (name: string, handler: any) => pi.on(name as any, async (event: any, ctx: ExtensionContext) => {
    // Nested bash is reduced once. Its fused parent already contains that receipt.
    if (event.toolName === "edit" || event.toolName === "write") return;
    let usage: any;
    const registry = new Proxy(ctx.modelRegistry, {
      get(target, key) {
        if (key === "complete") return async (model: any, context: any, options: any) => {
          if (`${model.provider}/${model.id}` !== REDUCER_ROUTE) throw new Error("Reducer model is not authorized");
          const sessionId = ctx.sessionManager.getSessionId();
          if (!callsBySession.has(sessionId)) {
            callsBySession.set(sessionId, ctx.sessionManager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "perfect-pi-sol-reducer-call").length);
          }
          const calls = callsBySession.get(sessionId)!;
          if (calls >= 20) throw new Error("Reducer session budget exhausted (20 requests); preserve the original log");
          callsBySession.set(sessionId, calls + 1);
          pi.appendEntry("perfect-pi-sol-reducer-call", { route: REDUCER_ROUTE, call: calls + 1 });
          const response = await target.complete(model, context, options);
          usage = combineUsage(usage, response.usage);
          return response;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let replacement;
    try {
      replacement = await handler(event, { ...ctx, modelRegistry: registry });
    } catch (error) {
      pi.appendEntry("perfect-pi-sol-reducer-fallback", { reason: error instanceof Error ? error.message : String(error) });
    }
    if (!usage) return replacement;
    return { ...replacement, usage: combineUsage(event.usage, usage) };
  });
  reducer.registerEvidencePreservingReducer(bridge, {
    reducerProvider: ctxConfig.evidencePreservingReducerProvider,
    reducerModel: ctxConfig.evidencePreservingReducerModel,
  });
}

export default async function solPiIntegration(pi: ExtensionAPI) {
  const manager = new DefaultPackageManager({ cwd: process.cwd(), agentDir: getAgentDir(), settingsManager: SettingsManager.inMemory() });
  const root = manager.getInstalledPath(SOL_PI_SOURCE, "user");
  if (!root) throw new Error("SoL-Pi package missing. Run Perfect Pi setup before loading the adapter.");
  const load = (file: string) => import(pathToFileURL(join(root, "src", "sol-pi", file)).href);
  const configModule = await load("config.ts");
  let generation = 0;
  let subscriptions: Array<() => void> = [];
  let registered = new Map<string, ToolDefinition<any, any, any>>();
  let status: any;
  pi.registerCommand("sol-pi", {
    description: "Inspect effective SoL-Pi features, config source, and approved reducer route",
    handler: async (_args, ctx) => ctx.ui.notify(JSON.stringify(status ?? { initialized: false }, null, 2), "info"),
  });
  pi.on("session_start", async (event, ctx) => {
    generation++;
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
    for (const tool of registered.values()) {
      if (tool.name === "edit") pi.registerTool(createEditToolDefinition(ctx.cwd));
      else if (tool.name === "write") pi.registerTool(createWriteToolDefinition(ctx.cwd));
      else pi.registerTool({ ...tool, exposure: "hidden" });
    }
    registered = new Map();
    const config = configModule.loadSolPiConfig(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
    const configPath = configModule.findConfigPath(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
    if (config.evidencePreservingReducer && `${config.evidencePreservingReducerProvider}/${config.evidencePreservingReducerModel}` !== REDUCER_ROUTE) {
      throw new Error(`SoL-Pi reducer is limited to the authorized route ${REDUCER_ROUTE}`);
    }
    const currentGeneration = generation;
    const startHandlers: Array<(event: any, context: ExtensionContext) => unknown> = [];
    const scoped = Object.create(pi);
    scoped.registerTool = (tool: ToolDefinition<any, any, any>) => {
      registered.set(tool.name, tool);
      pi.registerTool(tool);
    };
    scoped.on = (name: string, handler: any) => {
      if (name === "session_start") {
        startHandlers.push(handler);
        return () => {};
      }
      const unsubscribe = pi.on(name as any, (nextEvent: any, context: ExtensionContext) => {
        if (generation !== currentGeneration) return;
        return handler(nextEvent, context);
      });
      subscriptions.push(unsubscribe);
      return unsubscribe;
    };
    if (config.actionFusion) {
      const queue = await load("extensions/action-fusion/file-queue.ts");
      const fusion = await load("extensions/action-fusion/then-run.ts");
      registerSafeFusion(scoped, queue, fusion.assertUnchangedBeforeCommand);
    }
    if (config.observationPack) {
      const observations = await load("extensions/observation-pack/index.ts");
      // Packing is safe only while exact recall is callable, including CLI-restricted sessions.
      const bridge = Object.create(scoped);
      bridge.on = (name: string, handler: any) => scoped.on(name, (event: any, context: ExtensionContext) => {
        if (name === "context" && !pi.getActiveTools().includes("obs_recall")) return;
        return handler(event, context);
      });
      observations.registerObservationPack(bridge);
    }
    if (config.evidencePreservingReducer) {
      registerAccountedReducer(scoped, await load("extensions/evidence-preserving-reducer/index.ts"), config);
    }
    if (config.onlineContextCompact) {
      const compact = await load("extensions/online-context-compact/index.ts");
      compact.registerOnlineContextCompact(scoped, config.cacheWriteReadRatio);
    }
    for (const handler of startHandlers) await handler(event, ctx);
    status = { source: SOL_PI_SOURCE, configPath, ...config, reducerRoute: REDUCER_ROUTE };
    pi.appendEntry("perfect-pi-sol-config", status);
    if (ctx.mode === "tui") ctx.ui.setStatus("perfect-pi-sol", `SoL: fusion=${config.actionFusion} recall=${config.observationPack} reducer=${config.evidencePreservingReducer} compact=${config.onlineContextCompact}`);
  });
}
