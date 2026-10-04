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
const SOL_PI_SOURCE = "git:github.com/NVlabs/SoL-Pi@e1a586af0ad8956f42ae5b26bba20e48fbf30e00";
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? tmpdir(), ".pi", "agent");
const adapter = join(import.meta.dirname, "global/extensions/sol-pi.ts");
const baseConfig = { version: 1, actionFusion: true, observationPack: true, evidencePreservingReducer: false, onlineContextCompact: false, cacheWriteReadRatio: 12.5 };
const textOf = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
let scenarioId = 0;

async function scenario(t, { responses, denyBash = false, config = {}, tools, seed, reducerResponse } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "perfect-pi-sol-test-"));
  let session;
  t.after(async () => { session?.dispose(); await rm(cwd, { recursive: true, force: true }); });
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi", "sol-pi.json"), JSON.stringify({ ...baseConfig, ...config }));
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
  await session.bindExtensions({ onError: (error) => errors.push(error.error instanceof Error ? error.error.message : String(error.error ?? error)) });
  // Pre-authorize reducer for test sessions that enable it, since test fixtures have no TUI confirm.
  if (config?.evidencePreservingReducer) {
    authorizeReducer(manager.getSessionId());
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  await session.prompt("Execute the fixture.", { expandPromptTemplates: false });
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
