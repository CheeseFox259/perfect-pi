import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createEditToolDefinition, createWriteToolDefinition, DefaultPackageManager,
  getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionContext, type ExtensionToolContext, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const SOL_PI_SOURCE = "git:github.com/CheeseFox259/SoL-Pi@93fd67a833da1b6236cf2582f02f7a6454d6d941";

export interface ReducerPolicy {
  provider: string;
  model: string;
  maxRequestsPerSession: number;
}

export interface SolPiPolicy {
  source: string;
  pinnedRef: string;
  reducerPolicy: ReducerPolicy;
}

export interface PhaseConfig {
  skill: string;
  command: string;
  policy: "forbidden" | "checkpoint_eligible" | "strong_boundary" | "fresh_context";
  allowMidPhaseCompact: boolean;
  allowBoundaryCompact: boolean;
  recommendedBoundaryAction: "continue" | "compact" | "fresh_context" | "clear";
  rationale: string;
  durabilityGate?: {
    requiredArtifacts?: string[];
    gitCleanOrCommitted?: boolean;
    failClosed?: boolean;
  };
  customInstructions?: string;
}

export interface PhaseContract {
  version: number;
  title: string;
  phases: Record<string, PhaseConfig>;
  gates: Record<string, any>;
}

import {
  loadPhaseContract as readPhaseContract, checkDurabilityGate, isPhaseBoundaryEligible,
  beginPhase, completePhase, clearPhase, getActivePhase, snapshotPhase, MIN_TOKENS_SAVED,
} from "./sol-pi-phase.mjs";
export const loadPhaseContract = readPhaseContract;

export function loadSolPiPolicy(agentDir: string = getAgentDir()): SolPiPolicy {
  const candidates = [
    join(agentDir, "manifest.json"),
    join(process.cwd(), "manifest.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const manifest = JSON.parse(readFileSync(candidate, "utf8"));
        if (manifest.solPi) {
          return {
            source: manifest.solPi.source ?? SOL_PI_SOURCE,
            pinnedRef: manifest.solPi.pinnedRef ?? "93fd67a833da1b6236cf2582f02f7a6454d6d941",
            reducerPolicy: {
              provider: manifest.solPi.reducerPolicy?.provider ?? "cpa",
              model: manifest.solPi.reducerPolicy?.model ?? "gemini-3.8-flash-high",
              maxRequestsPerSession: Number(manifest.solPi.reducerPolicy?.maxRequestsPerSession ?? 20),
            },
          };
        }
      } catch {}
    }
  }
  return {
    source: SOL_PI_SOURCE,
    pinnedRef: "93fd67a833da1b6236cf2582f02f7a6454d6d941",
    reducerPolicy: {
      provider: "cpa",
      model: "gemini-3.8-flash-high",
      maxRequestsPerSession: 20,
    },
  };
}

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
          pi.appendEntry("perfect-pi-sol-action-fusion", {
            command: then_run.command,
            succeeded: !command.isError,
            turnsSaved: command.isError ? 0 : 1,
          });
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

/**
 * Session-scoped consent state for the reducer.
 * Authorization is granted once per session via Ctrl+P palette or the first interactive prompt,
 * and does NOT inherit to subagents or new sessions.
 */
import { isReducerAuthorized as _isRA, authorizeReducer as _authR, denyReducer, reducerDecision, resetReducerConsent, requestReducerConsent } from "./sol-pi-consent.mjs";

export const isReducerAuthorized = _isRA;
export const authorizeReducer = _authR;

/** A consent prompt must never outlive the turn that raised it. */
const CONSENT_PROMPT_TIMEOUT_MS = 60_000;

async function ensureReducerConsent(extensionApi: ExtensionAPI, ctx: ExtensionContext, route: string, sessionId: string, requestSignal?: AbortSignal): Promise<boolean> {
  const signals = [ctx.signal, requestSignal].filter((signal): signal is AbortSignal => Boolean(signal));
  const operationSignal = signals.length ? AbortSignal.any(signals) : undefined;
  if (operationSignal?.aborted) return false;
  const decision = reducerDecision(sessionId, route);
  if (decision !== undefined) return decision;
  const prior = [...ctx.sessionManager.getEntries()].reverse().find((e: any) =>
    e.type === "custom" && ["perfect-pi-sol-reducer-authorized", "perfect-pi-sol-reducer-denied"].includes(e.customType)
    && e.data?.sessionId === sessionId && e.data?.route === route);
  if (prior) {
    const granted = prior.customType === "perfect-pi-sol-reducer-authorized";
    (granted ? _authR : denyReducer)(sessionId, route);
    return granted;
  }
  if (ctx.mode !== "tui" || !ctx.hasUI || !ctx.ui?.select) return false;
  const granted = await requestReducerConsent(sessionId, async (signal: AbortSignal) => {
    const selected = await ctx.ui.select(`Send diagnostic logs to ${route} for this session?`, ["Allow", "Deny"],
      { signal, timeout: CONSENT_PROMPT_TIMEOUT_MS });
    if (signal.aborted || selected === undefined) return undefined;
    const allowed = selected === "Allow";
    (allowed ? _authR : denyReducer)(sessionId, route);
    extensionApi.appendEntry(allowed ? "perfect-pi-sol-reducer-authorized" : "perfect-pi-sol-reducer-denied", { route, sessionId });
    return allowed;
  }, { route, signal: operationSignal, timeout: CONSENT_PROMPT_TIMEOUT_MS });
  return granted === true;
}

export function registerAccountedReducer(extensionApi: ExtensionAPI, reducer: any, ctxConfig: any, policy: SolPiPolicy = loadSolPiPolicy()) {
  const authorizedRoute = `${policy.reducerPolicy.provider}/${policy.reducerPolicy.model}`;
  const maxRequests = policy.reducerPolicy.maxRequestsPerSession;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0) throw new Error("Reducer request budget must be a non-negative safe integer");
  // Wrap only the reducer's registry calls; other extensions keep the original context.
  const bridge = Object.create(extensionApi);
  bridge.on = (name: string, handler: any) => extensionApi.on(name as any, async (event: any, ctx: ExtensionContext) => {
    // Nested bash is reduced once. Its fused parent already contains that receipt.
    if (event.toolName === "edit" || event.toolName === "write") return;
    const sessionId = ctx.sessionManager.getSessionId();
    let usage: any;
    const registry = new Proxy(ctx.modelRegistry, {
      get(target, key) {
        if (key === "complete") return async (model: any, context: any, options: any) => {
          if (`${model.provider}/${model.id}` !== authorizedRoute) {
            throw new Error(`Reducer model '${model.provider}/${model.id}' is not authorized by manifest policy ('${authorizedRoute}')`);
          }
          const countAttempts = () => ctx.sessionManager.getEntries().filter((entry: any) => entry.type === "custom" && (
            (entry.customType === "perfect-pi-sol-reducer-attempt" && entry.data?.sessionId === sessionId)
            || (entry.customType === "perfect-pi-sol-reducer-call" && !entry.data?.attemptId && (entry.data?.sessionId === sessionId || entry.data?.sessionId === undefined))
          )).length;
          if (countAttempts() >= maxRequests) throw new Error(`Reducer session budget exhausted (${maxRequests} requests); preserve the original log`);
          options?.signal?.throwIfAborted();
          if (!(await ensureReducerConsent(extensionApi, ctx, authorizedRoute, sessionId, options?.signal))) throw new Error("Reducer consent not granted; preserve the original log");
          options?.signal?.throwIfAborted();
          const calls = countAttempts();
          if (calls >= maxRequests) throw new Error(`Reducer session budget exhausted (${maxRequests} requests); preserve the original log`);
          const attemptId = `${sessionId}:${calls + 1}`;
          extensionApi.appendEntry("perfect-pi-sol-reducer-attempt", { sessionId, route: authorizedRoute, attemptId, call: calls + 1, toolCallId: event.toolCallId });
          let response;
          try {
            response = await target.complete(model, context, options);
          } catch (error) {
            extensionApi.appendEntry("perfect-pi-sol-reducer-call-failed", { sessionId, route: authorizedRoute, attemptId, toolCallId: event.toolCallId,
              reason: error instanceof Error ? error.message : String(error) });
            throw error;
          }
          usage = combineUsage(usage, response.usage);
          extensionApi.appendEntry("perfect-pi-sol-reducer-call", {
            route: authorizedRoute,
            sessionId, attemptId, toolCallId: event.toolCallId,
            call: calls + 1,
            inputTokens: response.usage?.input ?? 0,
            outputTokens: response.usage?.output ?? 0,
          });
          return response;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let replacement;
    try {
      replacement = await handler(event, { ...ctx, modelRegistry: registry });
      if (replacement && replacement !== event) {
        extensionApi.appendEntry("perfect-pi-sol-reducer-receipt", {
          route: authorizedRoute,
          accepted: true,
          inputTokens: usage?.input ?? 0,
          outputTokens: usage?.output ?? 0,
        });
      }
    } catch (error) {
      extensionApi.appendEntry("perfect-pi-sol-reducer-fallback", {
        route: authorizedRoute,
        reason: error instanceof Error ? error.message : String(error),
      });
      // Fail-closed: on handler exception, preserve the original event content intact
      return usage ? { ...event, usage: combineUsage(event.usage, usage) } : undefined;
    }
    if (!usage) return replacement;
    // Guard: if replacement is undefined (handler returned nothing), use the original event
    const base = replacement ?? event;
    return { ...base, usage: combineUsage(event.usage, usage) };
  });
  reducer.registerEvidencePreservingReducer(bridge, {
    reducerProvider: ctxConfig.evidencePreservingReducerProvider,
    reducerModel: ctxConfig.evidencePreservingReducerModel,
  });
}

export default async function solPiIntegration(pi: ExtensionAPI) {
  const manager = new DefaultPackageManager({ cwd: process.cwd(), agentDir: getAgentDir(), settingsManager: SettingsManager.inMemory() });
  const initialPolicy = loadSolPiPolicy(getAgentDir());
  let root = manager.getInstalledPath(initialPolicy.source, "user")
    || manager.getInstalledPath(SOL_PI_SOURCE, "user")
    || join(getAgentDir(), "git", "github.com", "CheeseFox259", "SoL-Pi")
    || join(getAgentDir(), "git", "github.com", "NVlabs", "SoL-Pi");
  if (!existsSync(join(root, "package.json"))) {
    const fallback = join(getAgentDir(), "git", "github.com", "CheeseFox259", "SoL-Pi");
    if (existsSync(join(fallback, "package.json"))) root = fallback;
  }
  if (!root || !existsSync(join(root, "package.json"))) throw new Error("SoL-Pi package missing. Run Perfect Pi setup before loading the adapter.");
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
    // Clear per-session consent for the new generation; subagents start unauthorized.
    resetReducerConsent(ctx.sessionManager.getSessionId());
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
    for (const tool of registered.values()) {
      if (tool.name === "edit") pi.registerTool(createEditToolDefinition(ctx.cwd));
      else if (tool.name === "write") pi.registerTool(createWriteToolDefinition(ctx.cwd));
      else pi.registerTool({ ...tool, exposure: "hidden" });
    }
    registered = new Map();
    const policy = loadSolPiPolicy(getAgentDir());
    const authorizedRoute = `${policy.reducerPolicy.provider}/${policy.reducerPolicy.model}`;
    const config = configModule.loadSolPiConfig(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
    const configPath = configModule.findConfigPath(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
    if (config.evidencePreservingReducer) {
      const configuredRoute = `${config.evidencePreservingReducerProvider}/${config.evidencePreservingReducerModel}`;
      if (configuredRoute !== authorizedRoute) {
        throw new Error(`SoL-Pi reducer route '${configuredRoute}' is not authorized by manifest policy ('${authorizedRoute}')`);
      }
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
      bridge.registerTool = (tool: ToolDefinition<any, any, any>) => {
        if (tool.name === "obs_recall") {
          const originalExecute = tool.execute;
          const wrapped = {
            ...tool,
            execute: async (id: string, params: any, signal: any, update: any, tCtx: any) => {
              const res = await originalExecute(id, params, signal, update, tCtx);
              pi.appendEntry("perfect-pi-sol-observation-recall", { id: params?.id, offset: params?.offset ?? 0 });
              return res;
            },
          };
          scoped.registerTool(wrapped);
          return;
        }
        scoped.registerTool(tool);
      };
      bridge.on = (name: string, handler: any) => scoped.on(name, (event: any, context: ExtensionContext) => {
        if (name === "context" && !pi.getActiveTools().includes("obs_recall")) return;
        return handler(event, context);
      });
      observations.registerObservationPack(bridge);
    }
    if (config.evidencePreservingReducer) {
      registerAccountedReducer(scoped, await load("extensions/evidence-preserving-reducer/index.ts"), config, policy);
    }
    // --- Runtime Phase Contract Enforcement ---
    const contract = loadPhaseContract(getAgentDir(), ctx.cwd, ctx.isProjectTrusted());
    const phaseSessionId = ctx.sessionManager.getSessionId();
    clearPhase(phaseSessionId, authorizedRoute);
    const previousPhase = [...ctx.sessionManager.getBranch()].reverse().find((entry: any) =>
      entry.type === "custom" && entry.customType === "perfect-pi-phase-state"
      && entry.data?.sessionId === phaseSessionId && entry.data?.route === authorizedRoute);
    if (previousPhase?.data?.phase && contract?.phases[previousPhase.data.phase.skill]) {
      const saved = previousPhase.data.phase;
      beginPhase(phaseSessionId, authorizedRoute, { ...contract.phases[saved.skill], skill: saved.skill }, { cwd: ctx.cwd, feature: saved.feature });
      if (saved.completed) completePhase(phaseSessionId, authorizedRoute);
    }
    const persistPhase = () => pi.appendEntry("perfect-pi-phase-state", {
      sessionId: phaseSessionId, route: authorizedRoute, phase: snapshotPhase(phaseSessionId, authorizedRoute)?.phase ?? null,
    });
    const transitionPhase = (action: string, skill?: string, feature?: string) => {
      if (action === "begin") {
        if (!skill || !contract?.phases[skill]) throw new Error("Unknown phase or invalid phase contract");
        if (feature && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(feature)) throw new Error("Feature must be a single safe directory name");
        beginPhase(phaseSessionId, authorizedRoute, { ...contract.phases[skill], skill }, { cwd: ctx.cwd, feature });
        pi.appendEntry("perfect-pi-phase-transition", { phase: skill, policy: contract.phases[skill].policy, recommendedBoundaryAction: contract.phases[skill].recommendedBoundaryAction });
      } else if (action === "complete") {
        const phase = getActivePhase(phaseSessionId, authorizedRoute);
        if (!phase) throw new Error("No active phase");
        if (!checkDurabilityGate(ctx.cwd, phase.durabilityGate, { feature: phase.feature })) throw new Error("Phase deliverables are not durable; preserve context");
        completePhase(phaseSessionId, authorizedRoute);
      } else if (action === "clear") {
        clearPhase(phaseSessionId, authorizedRoute);
      } else if (action !== "status") {
        throw new Error("Use begin, complete, clear, or status");
      }
      if (action !== "status") persistPhase();
      return getActivePhase(phaseSessionId, authorizedRoute);
    };
    pi.registerCommand("sol-phase", {
      description: "Manage an explicit workflow boundary: begin <skill> [feature], complete, clear, status",
      handler: async (args, commandCtx) => {
        try {
          const [action = "status", skill, feature] = args.trim().split(/\s+/);
          commandCtx.ui.notify(JSON.stringify(transitionPhase(action, skill, feature)), "info");
        } catch (error) { commandCtx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
      },
    });
    if (config.onlineContextCompact) scoped.registerTool({
      name: "sol_phase", label: "Workflow Phase", executionMode: "sequential",
      description: "Record a workflow boundary. Begin with skill and feature; complete only after durable deliverables and reasoning are finished. Clear before unrelated work. This does not force compaction or replace ticket state.",
      parameters: Type.Object({ action: Type.Union([Type.Literal("begin"), Type.Literal("complete"), Type.Literal("clear"), Type.Literal("status")]), skill: Type.Optional(Type.String()), feature: Type.Optional(Type.String()) }),
      outputSchema: Type.Object({ phase: Type.Union([Type.Null(), Type.Object({ skill: Type.String(), status: Type.String(), completed: Type.Boolean() }, { additionalProperties: true })]) }),
      async execute(_id: string, params: any) {
        const current = transitionPhase(params.action, params.skill, params.feature);
        const phase = current ? structuredClone(current) : null;
        return { content: [{ type: "text", text: JSON.stringify(phase) }], details: { phase }, structuredContent: { phase } };
      },
    });
    scoped.on("input", (inputEvent: any) => {
      const text = typeof inputEvent?.text === "string" ? inputEvent.text : "";
      const match = text.match(/^\/(?:skill:)?([a-zA-Z0-9_-]+)/);
      if (match && contract?.phases[match[1]]) transitionPhase("begin", match[1]);
      else if (getActivePhase(phaseSessionId, authorizedRoute)?.completed && !text.startsWith("/sol-phase")) transitionPhase("clear");
    });
    scoped.on("tool_result", (result: any) => {
      if (result.toolName !== "read" || result.isError) return;
      const path = String(result.input?.path ?? "").replaceAll("\\", "/");
      const match = path.match(/(?:^|\/)skills\/([a-zA-Z0-9_-]+)\/SKILL\.md$/);
      if (match && contract?.phases[match[1]] && getActivePhase(phaseSessionId, authorizedRoute)?.skill !== match[1]) transitionPhase("begin", match[1]);
    });

    if (config.onlineContextCompact) {
      const compact = await load("extensions/online-context-compact/index.ts");
      // Wrap turn_end for OCC: Phase Contract exclusively governs proactive/opportunistic
      // compactions, suppressing OCC mid-phase in reasoning workflows and before deliverables exist.
      let projectedMessages: any[] = [];
      scoped.on("context", (event: any) => { projectedMessages = event.messages; });
      const occBridge = Object.create(scoped);
      occBridge.on = (name: string, handler: any) => {
        if (name === "turn_end") {
          return scoped.on("turn_end", (tEvent: any, tCtx: ExtensionContext) => {
            if (!contract) return;
            const archiveTokens = compact.estimateNativeCompactionTokens(tCtx.sessionManager.getBranch(), compact.DEFAULT_KEEP_RECENT_TOKENS, projectedMessages);
            const tokensSaved = archiveTokens - compact.DEFAULT_NATIVE_SUMMARY_TOKEN_ESTIMATE;
            const minTokensSaved = Math.max(MIN_TOKENS_SAVED, contract.gates?.gateC_economic?.minTokensSaved ?? MIN_TOKENS_SAVED);
            if (tokensSaved < minTokensSaved) return;
            const activePhase = getActivePhase(phaseSessionId, authorizedRoute);
            if (!activePhase || !isPhaseBoundaryEligible(activePhase, { cwd: tCtx.cwd, tokensSaved, minTokensSaved })) return;
            return handler(tEvent, tCtx);
          });
        }
        return scoped.on(name, handler);
      };
      compact.registerOnlineContextCompact(occBridge, config.cacheWriteReadRatio);
    }

    let compactionReason: string | undefined;
    scoped.on("session_before_compact", (compactionEvent: any) => {
      compactionReason = compactionEvent.reason;
      // Both "threshold" and "overflow" are necessary, normal context-pressure compactions
      // triggered when the context window reaches its limit. They proceed directly without
      // veto, warnings, or user decisions.
      // Proactive compactions (OCC) are governed at the turn_end boundary above.
      return;
    });

    scoped.on("session_compact", (compactEvent: any) => {
      pi.appendEntry("perfect-pi-sol-compaction", {
        triggered: true,
        phase: getActivePhase(phaseSessionId, authorizedRoute)?.skill ?? "unknown",
        manual: compactionReason === "manual",
        reason: compactionReason,
        fromExtension: compactEvent?.fromExtension,
      });
      compactionReason = undefined;
    });

    for (const handler of startHandlers) await handler(event, ctx);
    status = {
      source: policy.source,
      pinnedRef: policy.pinnedRef,
      configPath,
      ...config,
      reducerRoute: authorizedRoute,
      reducerPolicy: policy.reducerPolicy,
      phaseContract: contract ? { loaded: true, version: contract.version, phases: Object.keys(contract.phases) } : { loaded: false },
    };
    pi.appendEntry("perfect-pi-sol-config", status);
    if (ctx.mode === "tui") ctx.ui.setStatus("perfect-pi-sol", `SoL: fusion=${config.actionFusion} recall=${config.observationPack} reducer=${config.evidencePreservingReducer} compact=${config.onlineContextCompact}`);
  });
}
