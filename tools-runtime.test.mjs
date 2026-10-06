import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { detectPiRuntime } from "./scripts/pi-runtime.mjs";
import { ensureEagerWebTools } from "./scripts/web-access-config.mjs";

// No provider requests or personal MCP connections: the response is local faux data.
test("real Pi first request declares common capability tools without a handshake", async t => {
  const runtime = await detectPiRuntime();
  const installed = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"), "npm/node_modules");
  const paths = [
    join(installed, "pi-web-access/dist/index.js"),
    join(installed, "@aliou/pi-processes/extensions/processes/index.ts"),
    join(installed, "pi-agent-browser-native/dist/extensions/agent-browser/index.js"),
    join(installed, "@narumitw/pi-lsp/dist/index.ts"),
    join(installed, "pi-matt-subagent/extensions/subagent.ts"),
  ];
  if (!paths.every(existsSync)) { t.skip("Managed capability packages are not installed in this environment"); return; }
  const dir = mkdtempSync(join(tmpdir(), "perfect-pi-eager-session-"));
  const agentDir = join(dir, "agent"); mkdirSync(agentDir);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let session;
  try {
    ensureEagerWebTools(agentDir);
    const pi = await import(pathToFileURL(runtime.entry));
    const { fauxProvider, fauxAssistantMessage } = await import(pathToFileURL(join(runtime.root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js")));
    const faux = fauxProvider({ provider: "eager-fixture", api: "eager-fixture-api" });
    faux.setResponses([fauxAssistantMessage("Synthetic response; no tools executed")]);
    const settingsManager = pi.SettingsManager.inMemory({ defaultTools: ["+codemode"], compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new pi.DefaultResourceLoader({ cwd: dir, agentDir, settingsManager,
      additionalExtensionPaths: [...paths, join(import.meta.dirname, "global/extensions/tools.ts")],
      disabledBuiltinExtensions: ["mcp"], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: "Synthetic default-tool fixture",
      extensionFactories: [{ name: "fixture", factory(api) { api.registerProvider(faux.provider); } }],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const manager = pi.SessionManager.inMemory(dir);
    ({ session } = await pi.createAgentSession({ cwd: dir, agentDir, model: faux.getModel(), thinkingLevel: "off", settingsManager, resourceLoader: loader, sessionManager: manager }));
    await session.bindExtensions({ onError(error) { throw new Error(String(error.error)); } });
    const expected = ["web_search", "source_check", "fetch_content", "get_search_content", "process", "agent_browser", "agent_browser_code", "agent_browser_tools", "lsp_diagnostics", "lsp_fix", "subagent", "research"];
    for (const name of expected) assert.ok(session.getActiveToolNames().includes(name), `${name} inactive`);
    assert.ok(!session.getAllTools().some(tool => tool.name === "web_enable"));
    await session.prompt("Synthetic first turn");
    const declared = manager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "system")
      .flatMap(entry => entry.message.toolsAdded ?? []).map(tool => tool.name);
    for (const name of expected) assert.ok(declared.includes(name), `${name} absent from first request`);
    assert.equal(manager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "toolResult").length, 0);
  } finally {
    session?.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
