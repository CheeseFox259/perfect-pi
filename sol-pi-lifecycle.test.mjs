import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { authorizeReducer, reducerDecision, requestReducerConsent, resetReducerConsent } from "./global/extensions/sol-pi-consent.mjs";

const root = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const pi = await import(pathToFileURL(join(root, "dist/index.js")));
const { createJiti } = await import(pathToFileURL(join(root, "dist/core/extensions/jiti-loader.js")));
const require = createRequire(join(root, "dist/index.js"));
const jiti = createJiti(join(root, "dist/index.js"), { alias: { typebox: require.resolve("typebox"), "@earendil-works/pi-coding-agent": join(root, "dist/index.js") } });
const { registerAccountedReducer } = await jiti.import(join(import.meta.dirname, "global/extensions/sol-pi.ts"));
const route = "cpa/gemini-3.8-flash-high";
const model = { provider: "cpa", id: "gemini-3.8-flash-high" };
const config = { evidencePreservingReducerProvider: model.provider, evidencePreservingReducerModel: model.id };
function fixture({ limit = 2, manager = pi.SessionManager.inMemory(), decision = "Allow", fail = false } = {}) {
  resetReducerConsent(manager.getSessionId());
  let handler, prompts = 0, requests = 0;
  const controller = new AbortController();
  const api = { on(_name, value) { handler = value; }, appendEntry(type, data) { manager.appendCustomEntry(type, data); } };
  const ctx = { sessionManager: manager, hasUI: true, mode: "tui", signal: controller.signal,
    ui: { select: async () => { prompts++; return decision; } },
    modelRegistry: { complete: async () => { requests++; if (fail) throw new Error("synthetic network exception"); return { usage: { input: 5, output: 2 } }; } } };
  const reducer = { registerEvidencePreservingReducer(bridge) { bridge.on("tool_result", async (_event, context) => {
    await context.modelRegistry.complete(model, {}, { signal: context.signal });
    return undefined;
  }); } };
  const register = () => registerAccountedReducer(api, reducer, config, { reducerPolicy: { provider: model.provider, model: model.id, maxRequestsPerSession: limit } });
  register();
  return { ctx, manager, controller, register, run: () => handler({ toolName: "bash", toolCallId: "synthetic" }, ctx),
    get prompts() { return prompts; }, get requests() { return requests; } };
}

test("parallel grant emits exactly one durable decision", async () => {
  const f = fixture();
  await Promise.all([f.run(), f.run()]);
  assert.equal(f.prompts, 1);
  assert.equal(f.requests, 2);
  assert.equal(f.manager.getEntries().filter(e => e.customType === "perfect-pi-sol-reducer-authorized").length, 1);
});
test("deny is restored across registration and memory reset without nagging", async () => {
  const f = fixture({ decision: "Deny" });
  await f.run();
  resetReducerConsent(f.manager.getSessionId()); f.register();
  await f.run();
  assert.equal(f.prompts, 1); assert.equal(f.requests, 0);
  assert.equal(reducerDecision(f.manager.getSessionId(), route), false);
});
test("cancel is not denial and can be asked again", async () => {
  const f = fixture({ decision: undefined });
  f.ctx.ui.select = async () => undefined;
  await f.run();
  assert.equal(reducerDecision(f.manager.getSessionId(), route), undefined);
  f.ctx.ui.select = async () => "Allow";
  await f.run(); assert.equal(f.requests, 1);
});
test("fork and changed routes cannot reuse a previous consent receipt", async () => {
  const f = fixture(); await f.run();
  const parent = f.manager.getSessionId();
  const leaf = f.manager.appendMessage({ role: "user", content: [{ type: "text", text: "synthetic" }], timestamp: Date.now() });
  f.manager.createBranchedSession(leaf);
  assert.notEqual(f.manager.getSessionId(), parent);
  const child = fixture({ manager: f.manager, decision: "Deny" });
  await child.run(); assert.equal(child.prompts, 1); assert.equal(child.requests, 0);
  const foreign = pi.SessionManager.inMemory();
  foreign.appendCustomEntry("perfect-pi-sol-reducer-authorized", { sessionId: foreign.getSessionId(), route: "other/model" });
  const changed = fixture({ manager: foreign, decision: "Deny" });
  await changed.run(); assert.equal(changed.prompts, 1); assert.equal(changed.requests, 0);
});
test("network exceptions reserve budget across reload, including concurrent calls", async () => {
  const f = fixture({ fail: true });
  authorizeReducer(f.manager.getSessionId(), route);
  await Promise.all([f.run(), f.run(), f.run()]);
  f.register(); await f.run();
  assert.equal(f.requests, 2);
  assert.equal(f.manager.getEntries().filter(e => e.customType === "perfect-pi-sol-reducer-attempt").length, 2);
  assert.equal(f.manager.getEntries().filter(e => e.customType === "perfect-pi-sol-reducer-call-failed").length, 2);
});
test("reset cancels old prompt without deleting a replacement", async () => {
  resetReducerConsent(); let finish;
  const old = requestReducerConsent("same", () => new Promise(() => {}));
  await Promise.resolve(); resetReducerConsent("same");
  const current = requestReducerConsent("same", () => new Promise(resolve => { finish = resolve; }));
  await old; await Promise.resolve();
  assert.equal(requestReducerConsent("same", () => Promise.resolve(false)), current);
  finish(true); assert.equal(await current, true);
});
test("prompt deadline and already aborted signals settle without dispatch", async () => {
  const controller = new AbortController(); controller.abort(); let called = false;
  assert.equal(await requestReducerConsent("abort", () => { called = true; }, { signal: controller.signal }), undefined);
  assert.equal(called, false);
  assert.equal(await requestReducerConsent("timeout", () => new Promise(() => {}), { timeout: 10 }), undefined);
});
test("real Pi selector: request dedup, Escape and run abort release dialogs", async () => {
  const { InteractiveMode } = await import(pathToFileURL(join(root, "dist/modes/interactive/interactive-mode.js")));
  const { initTheme } = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")));
  initTheme("dark", false);
  const mode = Object.create(InteractiveMode.prototype);
  mode.editor = {}; mode.editorContainer = { clear() {}, addChild() {} };
  mode.ui = { setFocus() {}, requestRender() {} };
  const controller = new AbortController();
  const prompt = (signal) => mode.showExtensionSelector("Synthetic permission", ["Allow", "Deny"], { signal });
  const first = requestReducerConsent("native", prompt, { signal: controller.signal });
  const second = requestReducerConsent("native", prompt, { signal: controller.signal });
  assert.equal(first, second); await Promise.resolve();
  mode.extensionSelector.handleInput("\x1b"); assert.equal(await first, undefined);
  const next = requestReducerConsent("native", prompt, { signal: controller.signal });
  await Promise.resolve(); controller.abort(); assert.equal(await next, undefined);
});
