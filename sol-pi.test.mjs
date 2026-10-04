import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { installedPackageMatches } from "./setup.mjs";
import { checkSolPiContract } from "./scripts/check-sol-pi-contract.mjs";
import { authorizeReducer } from "./global/extensions/sol-pi-consent.mjs";
let piEntry;
try { piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")); }
catch { piEntry = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js"); }
const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import(pathToFileURL(piEntry));
const { fauxAssistantMessage, fauxProvider, fauxToolCall } = await import(pathToFileURL(join(dirname(piEntry), "../node_modules/@earendil-works/pi-ai/dist/providers/faux.js")));
const SOL_PI_SOURCE = "git:github.com/CheeseFox259/SoL-Pi@93fd67a833da1b6236cf2582f02f7a6454d6d941";
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? tmpdir(), ".pi", "agent");
const adapter = join(import.meta.dirname, "global/extensions/sol-pi.ts");
const baseConfig = { version: 1, actionFusion: true, observationPack: true, evidencePreservingReducer: false, onlineContextCompact: false, cacheWriteReadRatio: 12.5 };
const textOf = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
let scenarioId = 0;

/**
 * Model of pi's extension selector (interactive-mode.js showExtensionSelector):
 * one slot, a new dialog clears the container without settling the previous promise,
 * and only opts.signal can settle a dialog without a human. Returns the opened dialogs.
 */
function confirmSelector({ answerAfterMs = 0, answer = true } = {}) {
  const opened = [];
  let mounted = null;
  const timer = setInterval(() => {
    if (!mounted || mounted.settled) return;
    mounted.settled = true;
    mounted.resolve(answer === undefined ? undefined : answer ? "Allow" : "Deny");
    mounted = null;
  }, answerAfterMs);
  timer.unref?.();
  return {
    opened,
    stop: () => clearInterval(timer),
    uiContext: {
      input: async () => undefined, editor: async () => undefined, custom: async () => undefined,
      notify: () => {}, onTerminalInput: () => () => {}, setStatus: () => {}, setWorkingMessage: () => {}, setWorkingVisible: () => {},
      setWorkingIndicator: () => {}, setHiddenThinkingLabel: () => {}, setWidget: () => {}, setFooter: () => {}, setHeader: () => {}, setTitle: () => {},
      pasteToEditor: () => {}, setEditorText: () => {}, getEditorText: () => "", setEditorComponent: () => {}, getEditorComponent: () => undefined,
      addAutocompleteProvider: () => {},
      select: (title, options, opts) => {
        const dialog = { title, options, opts, settled: false };
        opened.push(dialog);
        return new Promise((resolve) => {
          dialog.resolve = (value) => { dialog.settled = true; resolve(value); };
          if (mounted && !mounted.settled) dialog.supersededPrevious = mounted;
          mounted = dialog;
          opts?.signal?.addEventListener("abort", () => { if (mounted === dialog) mounted = null; dialog.resolve(undefined); }, { once: true });
        });
      },
    },
  };
}

async function scenario(t, { responses, denyBash = false, config = {}, tools, seed, reducerResponse, preAuthorize, bindings, beforeRun, timeoutMs = 30_000 } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "perfect-pi-sol-test-"));
  let session;
  t.after(async () => { session?.dispose(); await rm(cwd, { recursive: true, force: true }); });
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi", "sol-pi.json"), JSON.stringify({ ...baseConfig, ...config }));
  await mkdir(join(cwd, "skills/ask-matt"), { recursive: true });
  await writeFile(join(cwd, "skills/ask-matt/phase-contract.json"),
    await readFile(join(import.meta.dirname, "skills/ask-matt/phase-contract.json"), "utf8"));
  if (seed) await seed(cwd);
  const id = ++scenarioId;
  const faux = fauxProvider({ provider: `perfect-sol-${id}`, api: `perfect-sol-api-${id}` });
  faux.setResponses(responses);
  let bashCalls = 0;
  let reducerCalls = 0;
  let currentContext;
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }, { projectTrusted: true });
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, additionalExtensionPaths: [adapter],
    extensionFactories: [{ name: "guard-fixture", factory: (pi) => {
      pi.registerProvider(faux.provider);
      pi.on("session_start", (_event, ctx) => { currentContext = ctx; });
      if (reducerResponse) pi.on("session_start", (_event, ctx) => {
        const originalFind = ctx.modelRegistry.find.bind(ctx.modelRegistry);
        ctx.modelRegistry.find = (provider, id) => provider === "cpa" && id === "gemini-3.8-flash-high" ? { ...faux.getModel(), provider, id } : originalFind(provider, id);
        const originalComplete = ctx.modelRegistry.complete.bind(ctx.modelRegistry);
        ctx.modelRegistry.complete = async (model, request, options) => {
          if (model.provider !== "cpa") return originalComplete(model, request, options);
          reducerCalls++;
          const response = fauxAssistantMessage(await reducerResponse(request));
          return { ...response, provider: model.provider, model: model.id, usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 } } };
        };
      });
      pi.on("tool_call", (event) => {
        if (event.toolName !== "bash") return;
        bashCalls++;
        if (denyBash) return { block: true, reason: "fixture blocked bash" };
      });
    }}],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: "Deterministic SoL-Pi adapter fixture.",
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const manager = SessionManager.create(cwd, join(cwd, "sessions"));
  ({ session } = await createAgentSession({ cwd, agentDir, tools, model: faux.getModel(), thinkingLevel: "off", resourceLoader: loader, sessionManager: manager, settingsManager }));
  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error.error instanceof Error ? error.error.message : String(error.error ?? error)), ...bindings });
  // Pre-authorize reducer for test sessions that enable it, since test fixtures have no TUI confirm.
  // Sessions that exercise the consent prompt itself pass preAuthorize: false and a TUI uiContext.
  if (preAuthorize ?? Boolean(config?.evidencePreservingReducer)) {
    authorizeReducer(manager.getSessionId());
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (beforeRun) await beforeRun(session);
  let watchdog;
  try {
    await Promise.race([
      session.prompt("Execute the fixture.", { expandPromptTemplates: false }),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error(`run did not settle within ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally { clearTimeout(watchdog); }
  if (errors.length > 0) throw new Error(errors.join("; "));
  const results = manager.getBranch().filter((entry) => entry.type === "message" && entry.message.role === "toolResult").map((entry) => entry.message);
  return { cwd, session, manager, results, bashCalls, faux, reducerCalls, loader, context: () => currentContext };
}
const fusedResponses = (command, path = "sample.txt") => [
  fauxAssistantMessage(fauxToolCall("write", { path, content: "adapter fixture\n", then_run: { command } }), { stopReason: "toolUse" }),
  fauxAssistantMessage("fixture complete"),
];

test("SoL-Pi is installed at the managed commit", async () => {
  assert.equal(await installedPackageMatches(SOL_PI_SOURCE), true);
});
test("compatibility contract verifies all required modules and exports", async () => {
  const result = await checkSolPiContract();
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.ok(result.verifiedModules.includes("extensions/action-fusion/file-queue.ts"));
  assert.ok(result.verifiedExports.includes("config.ts:loadSolPiConfig"));
  assert.ok(result.verifiedExports.includes("extensions/observation-pack/index.ts:registerObservationPack"));
});
test("fusion invokes the guarded nested bash pipeline", async (t) => {
  const f = await scenario(t, { responses: fusedResponses("printf forbidden"), denyBash: true });
  assert.equal(f.bashCalls, 1);
  assert.equal(f.results[0].isError, true);
  assert.match(textOf(f.results[0]), /\[then_run:failed\].*\nfixture blocked bash/);
  assert.equal(await readFile(join(f.cwd, "sample.txt"), "utf8"), "adapter fixture\n");
});
test("fusion reports success and keeps nested execution evidence", async (t) => {
  const f = await scenario(t, { responses: fusedResponses("printf validation-ok") });
  assert.equal(f.bashCalls, 1);
  assert.equal(f.results[0].isError, false);
  assert.match(textOf(f.results[0]), /\[then_run:succeeded\]\nvalidation-ok/);
  assert.equal(f.results[0].nestedCalls.calls[0].name, "bash");
});
test("fused validation timeout fails without rolling back the mutation", async (t) => {
  const f = await scenario(t, { responses: [
    fauxAssistantMessage(fauxToolCall("write", { path: "sample.txt", content: "timeout fixture", then_run: { command: "sleep 2", timeout: 0.05 } }), { stopReason: "toolUse" }),
    fauxAssistantMessage("fixture complete"),
  ] });
  assert.equal(f.results[0].isError, true);
  assert.match(textOf(f.results[0]), /\[then_run:failed\]/);
  assert.equal(await readFile(join(f.cwd, "sample.txt"), "utf8"), "timeout fixture");
});
test("nonzero validation is failed, never succeeded, and preserves the write", async (t) => {
  const f = await scenario(t, { responses: fusedResponses("printf failed; exit 7") });
  assert.equal(f.results[0].isError, true);
  assert.match(textOf(f.results[0]), /\[then_run:failed\]/);
  assert.doesNotMatch(textOf(f.results[0]), /\[then_run:succeeded\]/);
  assert.equal(await readFile(join(f.cwd, "sample.txt"), "utf8"), "adapter fixture\n");
});
test("mutation failure skips the validation", async (t) => {
  const f = await scenario(t, { responses: [
    fauxAssistantMessage(fauxToolCall("edit", { path: "missing.txt", edits: [{ oldText: "a", newText: "b" }], then_run: { command: "printf unexpected" } }), { stopReason: "toolUse" }),
    fauxAssistantMessage("fixture complete"),
  ] });
  assert.equal(f.results[0].isError, true);
  assert.equal(f.bashCalls, 0);
});
test("CLI tool restrictions prevent a fused bash escape", async (t) => {
  const f = await scenario(t, { responses: fusedResponses("printf unexpected"), tools: ["write"] });
  assert.equal(f.results[0].isError, true);
  assert.match(textOf(f.results[0]), /\[then_run:failed\]/);
  assert.equal(f.bashCalls, 0);
});
test("large results are projected as recall handles and recalled bytes remain exact", async (t) => {
  const body = "exact observation evidence\n".repeat(800);
  let observation;
  const f = await scenario(t, { seed: (cwd) => writeFile(join(cwd, "evidence.txt"), body), responses: [
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt", offset: 1, limit: 1 }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt", offset: 2, limit: 1 }), { stopReason: "toolUse" }),
    (context) => {
      const text = context.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((b) => b.type === "text").map((b) => b.text) : []).join("\n");
      observation = text.match(/id: (obs_[a-f0-9]{24})/)?.[1];
      assert.ok(observation, "large replay becomes a stable recall handle");
      return fauxAssistantMessage(fauxToolCall("obs_recall", { id: observation, offset: 0 }), { stopReason: "toolUse" });
    },
    fauxAssistantMessage("fixture complete"),
  ] });
  assert.equal(f.results.at(-1).isError, false);
  assert.match(textOf(f.results.at(-1)), /exact observation evidence/);
  const archive = join(f.manager.getSessionDir(), "sol-pi", f.manager.getSessionId(), "observation-pack", "objects", `${observation}.txt`);
  assert.equal(await readFile(archive, "utf8"), textOf(f.results[0]));
});

test("disabling recall through CLI leaves large observations in context", async (t) => {
  const body = "exact evidence\n".repeat(1000);
  await scenario(t, { tools: ["read"], seed: (cwd) => writeFile(join(cwd, "evidence.txt"), body), responses: [
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt", offset: 1, limit: 1 }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("read", { path: "evidence.txt", offset: 2, limit: 1 }), { stopReason: "toolUse" }),
    (context) => {
      const text = context.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text) : []).join("\n");
      assert.ok(text.includes(body));
      assert.doesNotMatch(text, /id: obs_[a-f0-9]{24}/);
      return fauxAssistantMessage("fixture complete");
    },
  ] });
});

test("repeated session_start reloads project flags and withdraws previous tools", async (t) => {
  const f = await scenario(t, { responses: [fauxAssistantMessage("first session complete")], config: { onlineContextCompact: true } });
  assert.ok(f.session.getActiveToolNames().includes("update_plan"));
  await writeFile(join(f.cwd, ".pi", "sol-pi.json"), JSON.stringify({ ...baseConfig, actionFusion: false, observationPack: false, onlineContextCompact: false }));
  f.manager.newSession();
  const extension = f.loader.getExtensions().extensions.find((item) => item.path === adapter);
  for (const handler of extension.handlers.get("session_start")) await handler({ type: "session_start" }, f.context());
  assert.ok(!f.session.getActiveToolNames().includes("update_plan"));
  assert.ok(!f.session.getActiveToolNames().includes("obs_recall"));
  const configEntry = f.manager.getBranch().find((entry) => entry.type === "custom" && entry.customType === "perfect-pi-sol-config");
  assert.ok(configEntry);
  assert.equal(configEntry.data.actionFusion, false);
});

const reducerConfig = { evidencePreservingReducer: true, evidencePreservingReducerProvider: "cpa", evidencePreservingReducerModel: "gemini-3.8-flash-high" };
const log = "build evidence line\n".repeat(500);
const logResponses = (count = 1) => [
  ...Array.from({ length: count }, () => fauxAssistantMessage(fauxToolCall("bash", { command: "cat diagnostics.log # npm test" }), { stopReason: "toolUse" })),
  fauxAssistantMessage("fixture complete"),
];
test("parallel tool results share one reducer consent prompt and never orphan the run", async (t) => {
  const selector = confirmSelector({ answerAfterMs: 5 });
  t.after(() => selector.stop());
  const f = await scenario(t, {
    config: reducerConfig,
    seed: (cwd) => writeFile(join(cwd, "diagnostics.log"), log), reducerResponse: () => "invalid receipt",
    preAuthorize: false,
    bindings: { mode: "tui", uiContext: selector.uiContext },
    responses: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "cat diagnostics.log # npm test" }), fauxToolCall("bash", { command: "cat diagnostics.log # npm test" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("fixture complete"),
    ],
    timeoutMs: 10_000,
  });
  assert.equal(selector.opened.length, 1, "one prompt per session, however many tool results arrive");
  assert.equal(selector.opened[0].settled, true);
  assert.equal(f.results.length, 2, "both parallel tool results complete");
  assert.equal(f.manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === "perfect-pi-sol-reducer-authorized").length, 1);
});
test("interrupting a pending reducer consent prompt releases the run", async (t) => {
  const selector = confirmSelector();
  selector.stop(); // a prompt nobody answers: the user pressed Escape instead
  t.after(() => selector.stop());
  const f = await scenario(t, {
    config: reducerConfig,
    seed: (cwd) => writeFile(join(cwd, "diagnostics.log"), log), reducerResponse: () => "invalid receipt",
    preAuthorize: false,
    bindings: { mode: "tui", uiContext: selector.uiContext },
    responses: [
      fauxAssistantMessage([fauxToolCall("bash", { command: "cat diagnostics.log # npm test" }), fauxToolCall("bash", { command: "cat diagnostics.log # npm test" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("fixture complete"),
    ],
    beforeRun: async (session) => { setTimeout(() => { void session.abort(); }, 250).unref?.(); },
    timeoutMs: 10_000,
  });
  assert.equal(selector.opened.length, 1);
  assert.ok(selector.opened[0].opts?.signal, "the prompt is bound to the run signal so Escape can settle it");
  assert.equal(selector.opened[0].settled, true, "Escape settles the prompt instead of wedging the turn");
  assert.equal(f.results.length, 2, "both tool results survive the interrupt");
  assert.equal(f.session.isIdle, true);
});
test("ordinary tool results do not ask permission for an unused reducer", async (t) => {
  const selector = confirmSelector();
  t.after(() => selector.stop());
  const f = await scenario(t, {
    config: reducerConfig, preAuthorize: false,
    bindings: { mode: "tui", uiContext: selector.uiContext },
    responses: [fauxAssistantMessage([fauxToolCall("bash", { command: "printf one" }), fauxToolCall("bash", { command: "printf two" })], { stopReason: "toolUse" }), fauxAssistantMessage("complete")],
  });
  assert.equal(selector.opened.length, 0);
  assert.equal(f.results.length, 2);
});
test("reducer fallback preserves the log and accounts for the attempted model call", async (t) => {
  const f = await scenario(t, { responses: logResponses(), config: reducerConfig, seed: (cwd) => writeFile(join(cwd, "diagnostics.log"), log), reducerResponse: () => "invalid receipt" });
  assert.equal(f.reducerCalls, 1);
  assert.equal(textOf(f.results[0]), log);
  assert.equal(f.results[0].usage.totalTokens, 110);
  assert.equal(f.results[0].usage.cost.total, 0.002);
});
test("verified reducer receipts retain exact quotes and include model usage", async (t) => {
  const f = await scenario(t, { responses: logResponses(), config: reducerConfig, seed: (cwd) => writeFile(join(cwd, "diagnostics.log"), log), reducerResponse: (request) => {
    const hash = request.messages[0].content[0].text.match(/source_sha256=([a-f0-9]+)/)[1];
    return JSON.stringify({ schema: "sol-pi-evidence-receipt/1", source_sha256: hash, status: "success", uncertain: false, evidence: [{ kind: "summary", quote: "build evidence line" }] });
  }});
  assert.equal(f.reducerCalls, 1);
  assert.match(textOf(f.results[0]), /sol_pi_evidence_receipt_v1/);
  assert.match(textOf(f.results[0]), /build evidence line/);
  assert.equal(f.results[0].usage.totalTokens, 110);
});
test("reducer request budget caps at 20 and subsequent logs pass through unchanged", async (t) => {
  const f = await scenario(t, { responses: logResponses(21), config: reducerConfig, seed: (cwd) => writeFile(join(cwd, "diagnostics.log"), log), reducerResponse: () => "invalid receipt" });
  assert.equal(f.reducerCalls, 20);
  assert.equal(textOf(f.results[20]), log);
  assert.equal(f.results[20].usage, undefined);
});
test("reducer rejects unauthorized route specified in project sol-pi.json", async (t) => {
  await assert.rejects(async () => {
    await scenario(t, {
      responses: [fauxAssistantMessage("complete")],
      config: {
        evidencePreservingReducer: true,
        evidencePreservingReducerProvider: "unauthorized-provider",
        evidencePreservingReducerModel: "unauthorized-model",
      },
    });
  }, /not authorized by manifest policy/);
});
test("telemetry entries are persisted for action fusion, recall, and reducer", async (t) => {
  const f = await scenario(t, {
    responses: [
      fauxAssistantMessage(fauxToolCall("write", { path: "telemetry.txt", content: "hello\n", then_run: { command: "echo ok" } }), { stopReason: "toolUse" }),
      fauxAssistantMessage("complete"),
    ],
  });
  const fusionEntries = f.manager.getEntries().filter((e) => e.type === "custom" && e.customType === "perfect-pi-sol-action-fusion");
  assert.equal(fusionEntries.length, 1);
  assert.equal(fusionEntries[0].data.succeeded, true);
  assert.equal(fusionEntries[0].data.turnsSaved, 1);
});
test("obs_recall throws unknown observation id for foreign or nonexistent handle", async (t) => {
  const f = await scenario(t, {
    responses: [
      fauxAssistantMessage(fauxToolCall("obs_recall", { id: "obs_0123456789abcdef01234567" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("complete"),
    ],
  });
  assert.equal(f.results[0].isError, true);
  assert.match(textOf(f.results[0]), /Unknown observation id/);
});
test("runtime phase contract loads and covers core Matt Pocock skills", async () => {
  const contractPath = join(import.meta.dirname, "skills", "ask-matt", "phase-contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  assert.ok(contract, "phase contract must load");
  assert.equal(contract.version, 1);
  assert.equal(contract.phases["grill-me"].policy, "forbidden");
  assert.equal(contract.phases["to-spec"].policy, "checkpoint_eligible");
  assert.equal(contract.phases["to-tickets"].policy, "strong_boundary");
  assert.equal(contract.phases["implement"].policy, "fresh_context");
  assert.equal(contract.phases["tdd"].policy, "forbidden");
  assert.equal(contract.gates.gateA_durability.failClosed, true);
});
test("upstream fork fixes: verified by contract check on patched SoL-Pi", async () => {
  const result = await checkSolPiContract();
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.actualRef, "93fd67a833da1b6236cf2582f02f7a6454d6d941");
  assert.ok(result.verifiedExports.includes("extensions/online-context-compact/index.ts:buildCompactionInstructions"));
});
test("explicit phase completion verifies scoped artifacts and persists a boundary", async (t) => {
  const contract = await readFile(join(import.meta.dirname, "skills/ask-matt/phase-contract.json"), "utf8");
  const f = await scenario(t, {
    config: { onlineContextCompact: true },
    seed: async (cwd) => {
      await mkdir(join(cwd, "skills/ask-matt"), { recursive: true });
      await writeFile(join(cwd, "skills/ask-matt/phase-contract.json"), contract);
      await mkdir(join(cwd, ".scratch/alpha"), { recursive: true });
      await writeFile(join(cwd, ".scratch/alpha/spec.md"), "# durable alpha spec");
    },
    responses: [
      fauxAssistantMessage(fauxToolCall("sol_phase", { action: "begin", skill: "to-spec", feature: "alpha" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("sol_phase", { action: "complete" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("sol_phase", { action: "clear" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("complete"),
    ],
  });
  assert.equal(f.results[0].details.phase.status, "in_progress");
  assert.equal(f.results[1].details.phase.status, "completed");
  assert.equal(f.results[2].details.phase, null);
  assert.equal(f.manager.getEntries().filter(e => e.customType === "perfect-pi-phase-state").length, 3);
});
test("phase completion without the selected feature's artifacts fails closed", async (t) => {
  const contract = await readFile(join(import.meta.dirname, "skills/ask-matt/phase-contract.json"), "utf8");
  const f = await scenario(t, {
    config: { onlineContextCompact: true },
    seed: async (cwd) => {
      await mkdir(join(cwd, "skills/ask-matt"), { recursive: true });
      await writeFile(join(cwd, "skills/ask-matt/phase-contract.json"), contract);
      await mkdir(join(cwd, ".scratch/other"), { recursive: true });
      await writeFile(join(cwd, ".scratch/other/spec.md"), "# unrelated spec");
    },
    responses: [
      fauxAssistantMessage(fauxToolCall("sol_phase", { action: "begin", skill: "to-spec", feature: "alpha" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("sol_phase", { action: "complete" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("complete"),
    ],
  });
  assert.equal(f.results[1].isError, true);
  assert.match(textOf(f.results[1]), /not durable/);
});
test("relative skill reads activate phase tracking", async (t) => {
  const f = await scenario(t, {
    seed: async (cwd) => {
      await mkdir(join(cwd, "skills/tdd"), { recursive: true });
      await writeFile(join(cwd, "skills/tdd/SKILL.md"), "# synthetic TDD instructions");
    },
    responses: [fauxAssistantMessage(fauxToolCall("read", { path: "skills/tdd/SKILL.md" }), { stopReason: "toolUse" }), fauxAssistantMessage("complete")],
  });
  assert.equal(f.manager.getEntries().find(e => e.customType === "perfect-pi-phase-transition").data.phase, "tdd");
});
test("runtime phase tracking records phase transitions for skill commands", async (t) => {
  const f = await scenario(t, {
    responses: [
      fauxAssistantMessage("ready"),
      fauxAssistantMessage("complete"),
    ],
  });
  await f.session.prompt("/skill:grill-me stress-test plan", { expandPromptTemplates: false });
  const transitions = f.manager.getEntries().filter((e) => e.type === "custom" && e.customType === "perfect-pi-phase-transition");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].data.phase, "grill-me");
  assert.equal(transitions[0].data.policy, "forbidden");
});
