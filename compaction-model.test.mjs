import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { detectPiRuntime } from "./scripts/pi-runtime.mjs";
import { DEFAULT_COMPACTION_MODEL, parseModelRoute, readCompactionModel, writeCompactionModel, resolveCompactionModel } from "./global/extensions/compaction-settings.mjs";

const runtime = await detectPiRuntime();
const pi = await import(pathToFileURL(runtime.entry).href);
const { FileSettingsStorage, InMemorySettingsStorage } = await import(pathToFileURL(join(dirname(runtime.entry), "core/settings-manager.js")).href);
const { loadExtensions } = await import(pathToFileURL(join(dirname(runtime.entry), "core/extensions/loader.js")).href);
const { createJiti } = await import(pathToFileURL(join(dirname(runtime.entry), "core/extensions/jiti-loader.js")).href);
const jiti = createJiti(runtime.entry, { alias: { "@earendil-works/pi-coding-agent": runtime.entry } });
const { compactWithConfiguredModel } = await jiti.import(join(import.meta.dirname, "global/extensions/compaction-model.ts"));

function fixture({ split = false, failure = false, missing = false, empty = false } = {}) {
  const calls = [], notifications = [];
  const signal = new AbortController();
  const storage = new InMemorySettingsStorage();
  const model = { ...DEFAULT_COMPACTION_MODEL, id: DEFAULT_COMPACTION_MODEL.model, api: "openai-completions", contextWindow: 100000, maxTokens: 4096 };
  const message = { role: "user", content: [{ type: "text", text: "synthetic history" }], timestamp: 0 };
  const preparation = { firstKeptEntryId: "kept", messagesToSummarize: [message], turnPrefixMessages: split ? [message] : [],
    isSplitTurn: split, tokensBefore: 32000, previousSummary: "prior summary", settings: { reserveTokens: 16384 },
    fileOps: { read: new Set(["README.md"]), written: new Set(), edited: new Set(["app.ts"]) } };
  const ctx = { cwd: import.meta.dirname, isProjectTrusted: () => false,
    model: { provider: "main", id: "conversation" }, ui: { notify: (...args) => notifications.push(args) },
    modelRegistry: { find: () => missing ? undefined : model, streamSimple: (selected, context, options) => {
      calls.push({ selected, context, options });
      return { result: async () => {
        if (failure) throw new Error("synthetic failure");
        return { role: "assistant", content: [{ type: "text", text: empty ? " " : "synthetic summary" }], stopReason: "stop",
          usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      } };
    } } };
  const event = { preparation, signal: signal.signal, customInstructions: "preserve open decisions", reason: "manual" };
  return { storage, ctx, event, signal, calls, notifications };
}

test("global model default, validation and slash-containing IDs", () => {
  assert.deepEqual(resolveCompactionModel(), DEFAULT_COMPACTION_MODEL);
  assert.deepEqual(parseModelRoute("provider/vendor/model"), { provider: "provider", model: "vendor/model" });
  for (const value of [null, [], { provider: "", model: "x" }, { provider: "x", model: 2 }]) {
    assert.throws(() => resolveCompactionModel({ perfectPiCompaction: value }));
  }
  assert.throws(() => parseModelRoute("model"));
});

test("BOM and empty global files work, malformed/nonobject files stay untouched", () => {
  for (const text of ["\uFEFF{}", " \n\t"]) {
    const storage = new InMemorySettingsStorage(); storage.withLock("global", () => text);
    assert.deepEqual(readCompactionModel(storage), DEFAULT_COMPACTION_MODEL);
    writeCompactionModel(storage, DEFAULT_COMPACTION_MODEL);
    assert.deepEqual(readCompactionModel(storage), DEFAULT_COMPACTION_MODEL);
  }
  for (const text of ["null", "[]", "not json"]) {
    const storage = new InMemorySettingsStorage(); storage.withLock("global", () => text);
    assert.throws(() => readCompactionModel(storage));
    assert.throws(() => writeCompactionModel(storage, DEFAULT_COMPACTION_MODEL));
    storage.withLock("global", current => { assert.equal(current, text); return undefined; });
  }
});

test("locked global settings preserve unrelated data and ignore project routing", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-compaction-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "settings.json");
  writeFileSync(file, JSON.stringify({ theme: "dark", packages: ["fixture"], custom: { preserved: true } }));
  const storage = new FileSettingsStorage(join(directory, "project"), directory);
  writeCompactionModel(storage, { provider: "other", model: "vendor/model" });
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.theme, "dark"); assert.deepEqual(saved.packages, ["fixture"]); assert.deepEqual(saved.custom, { preserved: true });
  assert.deepEqual(readCompactionModel(storage), { provider: "other", model: "vendor/model" });
  const memory = new InMemorySettingsStorage();
  memory.withLock("project", () => JSON.stringify({ perfectPiCompaction: { provider: "untrusted", model: "bad" } }));
  assert.deepEqual(readCompactionModel(memory), DEFAULT_COMPACTION_MODEL);
});

test("native compaction preserves kept entry, files, instructions and usage on all triggers", async () => {
  for (const reason of ["manual", "threshold", "overflow"]) {
    const f = fixture(); f.event.reason = reason;
    const result = await compactWithConfiguredModel(f.event, f.ctx, f.storage);
    assert.equal(result.compaction.firstKeptEntryId, "kept");
    assert.equal(result.compaction.tokensBefore, 32000);
    assert.equal(result.compaction.usage.input, 10);
    assert.deepEqual(result.compaction.details.readFiles, ["README.md"]);
    assert.deepEqual(result.compaction.details.modifiedFiles, ["app.ts"]);
    assert.match(result.compaction.summary, /<modified-files>/);
    assert.match(JSON.stringify(f.calls[0].context), /preserve open decisions/);
    assert.match(JSON.stringify(f.calls[0].context), /prior summary/);
    assert.equal(f.calls[0].selected.id, DEFAULT_COMPACTION_MODEL.model);
    assert.equal(f.calls[0].options.signal, f.event.signal);
    assert.equal(f.ctx.model.id, "conversation");
  }
});

test("native split-turn path retains both summaries and combined usage", async () => {
  const f = fixture({ split: true });
  const result = await compactWithConfiguredModel(f.event, f.ctx, f.storage);
  assert.equal(f.calls.length, 2);
  assert.match(result.compaction.summary, /Turn Context \(split turn\)/);
  assert.equal(result.compaction.usage.input, 20);
});

test("missing model or failed requests return to Pi default compaction", async () => {
  for (const opts of [{ missing: true }, { failure: true }, { empty: true }]) {
    const f = fixture(opts);
    assert.equal(await compactWithConfiguredModel(f.event, f.ctx, f.storage), undefined);
    assert.equal(f.notifications.length, 1);
    assert.match(f.notifications[0][0], /current conversation model/);
  }
});

test("abort before or during summarization never falls back", async () => {
  const f = fixture(); f.signal.abort();
  assert.deepEqual(await compactWithConfiguredModel(f.event, f.ctx, f.storage), { cancel: true });
  assert.equal(f.calls.length, 0); assert.equal(f.notifications.length, 0);
  const next = fixture();
  const cancelDuring = async () => { next.signal.abort(); throw new Error("cancel"); };
  assert.deepEqual(await compactWithConfiguredModel(next.event, next.ctx, next.storage, cancelDuring), { cancel: true });
  assert.equal(next.notifications.length, 0);
});

test("real extension command registers and cancelled picker does not write", async () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const directory = mkdtempSync(join(tmpdir(), "pi-compaction-command-"));
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
  const loaded = await loadExtensions([join(import.meta.dirname, "global/extensions/compaction-model.ts")], import.meta.dirname);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.ok(extension.handlers.has("session_before_compact"));
  const f = fixture();
  f.ctx.hasUI = true; f.ctx.signal = f.signal.signal;
  f.ctx.modelRegistry.getAvailable = () => [{ provider: "cpa", id: "gemini-3.8-flash-high" }];
  let selections = 0;
  f.ctx.ui.select = async (_title, choices, opts) => { selections++; assert.equal(choices[0], "cpa/gemini-3.8-flash-high"); assert.ok(opts.signal); return undefined; };
  await extension.commands.get("compaction-model").handler("", f.ctx);
  assert.equal(selections, 1); assert.equal(f.notifications.length, 0);
  const command = extension.commands.get("compaction-model");
  await command.handler("cpa/gemini-3.8-flash-high", f.ctx);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "settings.json"), "utf8")).perfectPiCompaction, DEFAULT_COMPACTION_MODEL);
  await command.handler("status", f.ctx);
  assert.match(f.notifications.at(-1)[0], /cpa\/gemini-3.8-flash-high/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real AgentSession compaction persists custom route without changing conversation model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-compaction-session-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(directory, "agent"); mkdirSync(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let session;
  try {
    const { fauxProvider, fauxAssistantMessage } = await import(pathToFileURL(join(runtime.root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js")).href);
    const faux = fauxProvider({ provider: "compaction-fixture", api: "compaction-fixture-api" });
    faux.setResponses([fauxAssistantMessage("a"), fauxAssistantMessage("b"), fauxAssistantMessage("c")]);
    const model = faux.getModel();
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ perfectPiCompaction: { provider: model.provider, model: model.id } }));
    const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } });
    let summaryCalls = 0;
    const loader = new pi.DefaultResourceLoader({ cwd: directory, agentDir, settingsManager,
      additionalExtensionPaths: [join(import.meta.dirname, "global/extensions/compaction-model.ts")],
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: "Synthetic compaction fixture", extensionFactories: [{ name: "fixture", factory(api) {
        api.registerProvider(faux.provider);
        api.on("session_start", (_event, ctx) => {
          ctx.modelRegistry.streamSimple = () => ({ result: async () => { summaryCalls++; return fauxAssistantMessage("Synthetic persisted summary"); } });
        });
      } }] });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    const manager = pi.SessionManager.create(directory, join(directory, "sessions"));
    ({ session } = await pi.createAgentSession({ cwd: directory, agentDir, model, thinkingLevel: "off", settingsManager,
      resourceLoader: loader, sessionManager: manager, tools: [] }));
    await session.bindExtensions({ onError(error) { throw new Error(String(error.error)); } });
    for (let i = 0; i < 3; i++) await session.prompt(`Synthetic turn ${i}: ${"history ".repeat(200)}`);
    await session.compact("Preserve synthetic decisions");
    const entry = manager.getBranch().find(entry => entry.type === "compaction");
    assert.ok(entry); assert.match(entry.summary, /Synthetic persisted summary/);
    assert.equal(entry.details.perfectPiCompaction.route, `${model.provider}/${model.id}`);
    assert.equal(session.model.id, model.id); assert.ok(summaryCalls > 0);
  } finally {
    session?.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
