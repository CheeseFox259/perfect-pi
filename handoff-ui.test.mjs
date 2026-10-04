import assert from "node:assert/strict";
import test from "node:test";
import { detectPiRuntime } from "./scripts/pi-runtime.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const runtime = await detectPiRuntime();
const { createJiti } = await import(pathToFileURL(join(runtime.root, "dist/core/extensions/jiti-loader.js")));
const { createRequire } = await import("node:module"); const require = createRequire(runtime.entry);
const jiti = createJiti(runtime.entry, { alias: { "@earendil-works/pi-coding-agent": runtime.entry,
  "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"), typebox: require.resolve("typebox") } });
const { SecretInput, promptMcpKey } = await jiti.import(join(import.meta.dirname, "global/extensions/mcp-settings.ts"));
const { waitForImage, default: registerImage } = await jiti.import(join(import.meta.dirname, "global/extensions/image-handoff.ts"));
const theme = { fg: (_name, text) => text };
function ui(script) {
  return { mode: "tui", hasUI: true, ui: { custom: async factory => {
    let answer, complete = false;
    const component = factory({ requestRender() {} }, theme, {}, value => { assert.equal(complete, false); complete = true; answer = value; });
    component.focused = true;
    await script(component);
    assert.equal(complete, true); component.dispose?.(); return answer;
  } } };
}
test("MCP key input never renders a secret, supports paste, focus and cancellation", async () => {
  const input = new SecretInput(); input.focused = true; input.setValue("synthetic-hidden-secret");
  assert.ok(!input.render(80).join("\n").includes("synthetic-hidden-secret"));
  const ctx = ui(component => {
    component.handleInput("\x1b[200~synthetic-key\x1b[201~");
    assert.ok(!component.render(40).join("\n").includes("synthetic-key")); component.handleInput("\r");
  });
  assert.equal(await promptMcpKey(ctx, "Private MCP Key"), "synthetic-key");
  assert.equal(await promptMcpKey(ui(component => component.handleInput("\x1b")), "Private MCP Key"), undefined);
  await assert.rejects(promptMcpKey({ mode: "rpc", hasUI: true }, "Key"));
});
test("MCP key command updates only the selected private key without transcript leakage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-key-command-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    const { configureMiniMax } = await import("./scripts/mcp-config.mjs");
    const { readMcpSecret } = await import("./scripts/mcp-secrets.mjs");
    configureMiniMax(dir, "https://api.minimaxi.com");
    const { loadExtensions } = await import(pathToFileURL(join(runtime.root, "dist/core/extensions/loader.js")));
    const loaded = await loadExtensions([join(import.meta.dirname, "global/extensions/mcp-settings.ts")], import.meta.dirname);
    assert.deepEqual(loaded.errors, []);
    const notifications = [];
    const ctx = ui(component => { component.handleInput("synthetic-private-key"); assert.ok(!component.render(30).join("\n").includes("synthetic-private-key")); component.handleInput("\r"); });
    ctx.ui.notify = text => notifications.push(text);
    await loaded.extensions[0].commands.get("mcp-key").handler("MiniMax", ctx);
    assert.equal(readMcpSecret(dir, "MiniMax", "MINIMAX_API_KEY"), "synthetic-private-key");
    assert.ok(!notifications.join("\n").includes("synthetic-private-key"));
    assert.match(notifications.at(-1), /saved privately/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("image panel waits with prompt and accepts clipboard, file, skip and abort", async () => {
  const prompt = "A synthetic UI reference prompt";
  const clipboard = await waitForImage(ui(component => { assert.match(component.render(50).join("\n"), /synthetic UI reference/); component.handleInput("\r"); }), prompt);
  assert.equal(clipboard.action, "clipboard");
  const file = await waitForImage(ui(component => { component.handleInput("\x1b[B"); component.handleInput("\r"); component.handleInput("/tmp/mock.png"); component.handleInput("\r"); }), prompt);
  assert.equal(file.action, "file"); assert.equal(file.path, "/tmp/mock.png");
  const skip = await waitForImage(ui(component => { component.handleInput("\x1b[B"); component.handleInput("\x1b[B"); component.handleInput("\r"); }), prompt);
  assert.equal(skip.action, "skip");
  const controller = new AbortController();
  const aborted = await waitForImage(ui(() => controller.abort()), prompt, controller.signal);
  assert.equal(aborted.action, "cancel");
});
test("handoff preserves a long multilingual prompt and exposes its ending through paging", async () => {
  let tool; registerImage({ registerTool(value) { tool = value; } });
  const prompt = '精确文案 “保存” — 16:9\n' + 'Preserve style, hierarchy and negative constraints.\n'.repeat(300) + 'FINAL_PROMPT_MARKER';
  const updates = [];
  const ctx = ui(component => {
    assert.ok(!component.render(80).join('\n').includes('FINAL_PROMPT_MARKER'));
    for (let i = 0; i < 30; i++) { component.handleInput('\x1b[6~'); component.render(80); }
    assert.ok(component.render(80).join('\n').includes('FINAL_PROMPT_MARKER'));
    component.handleInput('\x1b');
  });
  await tool.execute('preservation', { prompt }, undefined, value => updates.push(value), ctx);
  assert.equal(updates[0].content[0].text, prompt);
  const nonTui = await tool.execute('preservation', { prompt }, undefined, undefined, { mode: 'json', hasUI: false });
  assert.equal(nonTui.content[1].text, prompt);
});

test("image tool returns actual returned image, rejects missing images and terminates outside TUI", async t => {
  let tool; registerImage({ registerTool(value) { tool = value; } });
  const directory = mkdtempSync(join(tmpdir(), "pi-image-handoff-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "reference.png");
  writeFileSync(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5uQAAAAASUVORK5CYII=", "base64"));
  const context = ui(component => { component.handleInput("\x1b[B"); component.handleInput("\r"); component.handleInput(file); component.handleInput("\r"); }); context.cwd = directory;
  const result = await tool.execute("fixture", { prompt: "Synthetic concept prompt" }, undefined, undefined, context);
  assert.equal(result.details.status, "received"); assert.equal(result.content[1].type, "image");
  const prompt = "Complete prompt with exact labels, layout constraints, and no gradients.";
  const nonTui = await tool.execute("fixture", { prompt }, undefined, undefined, { mode: "json", hasUI: false });
  assert.equal(nonTui.terminate, true); assert.equal(nonTui.details.status, "waiting_for_image");
  assert.equal(nonTui.content[1].text, prompt);
  for (const path of [join(directory, "missing.png"), join(directory, "invalid.txt")]) {
    if (path.endsWith(".txt")) writeFileSync(path, "not an image");
    const bad = ui(component => { component.handleInput("\x1b[B"); component.handleInput("\r"); component.handleInput(path); component.handleInput("\r"); }); bad.cwd = directory;
    const failure = await tool.execute("failure", { prompt: "Synthetic prompt" }, undefined, undefined, bad);
    assert.equal(failure.isError, true); assert.equal(failure.terminate, true); assert.equal(failure.details.status, "waiting_for_image");
  }
});
