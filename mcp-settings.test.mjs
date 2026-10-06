import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeMcpSecret, readMcpSecret } from "./scripts/mcp-secrets.mjs";
import { configureMiniMax, projectMcpOverride, configureServerKey, applyMcpDefaults, inspectMcpDefaults } from "./scripts/mcp-config.mjs";
import { spawnSync } from "node:child_process";
import { detectPiRuntime } from "./scripts/pi-runtime.mjs";
import { pathToFileURL } from "node:url";

test("private key storage is locked, mode 0600, and absent from native MCP config", t => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-private-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  storeMcpSecret(dir, "MiniMax", "MINIMAX_API_KEY", "synthetic-test-key");
  assert.equal(readMcpSecret(dir, "MiniMax", "MINIMAX_API_KEY"), "synthetic-test-key");
  if (process.platform !== "win32") assert.equal(statSync(join(dir, "mcp-private/secrets.json")).mode & 0o777, 0o600);
  configureMiniMax(dir, "https://api.minimaxi.com");
  assert.ok(!readFileSync(join(dir, "mcp.json"), "utf8").includes("synthetic-test-key"));
  configureServerKey(dir, "MiniMax", "MINIMAX_API_KEY");
  const config = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf8")).mcpServers.MiniMax;
  assert.equal(config.enabled, false);
  assert.equal(config.args.filter(arg => arg.endsWith("mcp-launch.mjs")).length, 1);
  assert.throws(() => configureMiniMax(dir, "https://host-controlled-by-project.example"));
  assert.throws(() => storeMcpSecret(dir, "../escape", "KEY", "value"));
});
test("optional MCP defaults preserve explicit choices, other servers and secrets", t => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-defaults-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const defaults = { MiniMax: { enabled: false }, "ask-user-questions": { enabled: false } };
  const current = { autoEnableCodemode: false, mcpServers: {
    MiniMax: { command: "private", env: { API_KEY: "synthetic" } },
    "ask-user-questions": { command: "ask", enabled: true },
    "codebase-memory": { command: "graph" }, "context-mode": { command: "docs" },
  } };
  const before = structuredClone(current);
  const next = applyMcpDefaults(current, defaults);
  assert.deepEqual(current, before);
  assert.deepEqual(next, { ...current, mcpServers: { ...current.mcpServers, MiniMax: { ...current.mcpServers.MiniMax, enabled: false } } });
  assert.deepEqual(applyMcpDefaults(next, defaults), next);
  assert.deepEqual(applyMcpDefaults({}, defaults), { mcpServers: {} });
  assert.throws(() => applyMcpDefaults(current, { MiniMax: { enabled: "false" } }), /Invalid/);
  assert.throws(() => applyMcpDefaults(current, { MiniMax: { enabled: false, exposure: "hidden" } }), /Invalid/);
  assert.throws(() => applyMcpDefaults([], defaults), /Invalid/);
  assert.equal(inspectMcpDefaults(dir, defaults).status, "SYNCED");
});

test("secret storage refuses symlinks and lock contention", t => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-lock-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "outside")); symlinkSync(join(dir, "outside"), join(dir, "mcp-private"));
  assert.throws(() => storeMcpSecret(dir, "MiniMax", "KEY", "x"));
  rmSync(join(dir, "mcp-private")); mkdirSync(join(dir, "mcp-private/.write-lock"), { recursive: true });
  assert.throws(() => storeMcpSecret(dir, "MiniMax", "KEY", "x"), /busy/);
});
test("MCP wrapper redacts child output without placing the key in argv", t => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-launch-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const secret = "synthetic-secret-redaction";
  storeMcpSecret(dir, "fixture", "API_KEY", secret);
  const script = 'console.log(process.env.API_KEY);console.error(process.env.API_KEY);';
  const result = spawnSync(process.execPath, ["scripts/mcp-launch.mjs", dir, "fixture", "API_KEY", process.execPath, "-e", script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes(secret)); assert.ok(!result.stderr.includes(secret));
  assert.match(result.stdout, /REDACTED/); assert.match(result.stderr, /REDACTED/);
});
test("MCP child receives its configured environment, not unrelated ambient API keys", t => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-env-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  storeMcpSecret(dir, "fixture", "API_KEY", "synthetic-selected-key");
  const result = spawnSync(process.execPath, ["scripts/mcp-launch.mjs", dir, "fixture", "API_KEY", process.execPath, "-e",
    'console.log(JSON.stringify({leaked:!!process.env.UNRELATED_PROVIDER_API_KEY,configured:!!process.env.API_KEY}))'], {
    env: { ...process.env, UNRELATED_PROVIDER_API_KEY: "do-not-forward" }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { leaked: false, configured: true });
});

test("MCP child keeps resolved native nonsecret config values", async t => {
  const { childEnvironment } = await import("./scripts/mcp-launch.mjs");
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-resolved-env-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  configureMiniMax(dir, "https://api.minimaxi.com");
  const previous = process.env.MINIMAX_API_HOST;
  try {
    process.env.MINIMAX_API_HOST = "https://api.minimaxi.com";
    const env = childEnvironment(dir, "MiniMax", "MINIMAX_API_KEY", "synthetic-key");
    assert.equal(env.MINIMAX_API_HOST, "https://api.minimaxi.com");
  } finally { if (previous === undefined) delete process.env.MINIMAX_API_HOST; else process.env.MINIMAX_API_HOST = previous; }
});

test("MCP launcher exits on SIGTERM and keeps output redacted across chunks", async t => {
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-stop-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  storeMcpSecret(dir, "fixture", "API_KEY", "synthetic-chunk-secret");
  const script = 'process.stdout.write(process.env.API_KEY.slice(0,10));setTimeout(()=>process.stdout.write(process.env.API_KEY.slice(10)+"\\nready\\n"),20);setInterval(()=>{},1000);';
  const child = spawn(process.execPath, ["scripts/mcp-launch.mjs", dir, "fixture", "API_KEY", process.execPath, "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { child.kill("SIGTERM"); });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("launcher readiness timeout")), 5000);
    child.stdout.on("data", chunk => { output += chunk; if (output.includes("ready")) { clearTimeout(timer); resolve(); } });
  });
  assert.ok(!output.includes("synthetic-chunk-secret")); assert.match(output, /REDACTED/);
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("launcher did not close")), 5000); child.once("close", () => { clearTimeout(timer); resolve(); }); });
});

test("native MCP config honors trusted project profiles without project keys", async t => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-project-test-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agent = join(dir, "agent"), cwd = join(dir, "project");
  configureMiniMax(agent, "https://api.minimaxi.com");
  projectMcpOverride(cwd, "MiniMax", { enabled: true, exposure: "hidden" });
  const runtime = await detectPiRuntime();
  const { loadExtensions } = await import(pathToFileURL(join(runtime.root, "dist/core/extensions/loader.js")));
  const loaded = await loadExtensions([join(import.meta.dirname, "global/extensions/mcp-settings.ts")], import.meta.dirname);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.ok(extension.commands.has("mcp-setup")); assert.ok(extension.commands.has("mcp-key")); assert.ok(extension.commands.has("mcp-project"));
  const notifications = [];
  await extension.commands.get("mcp-project").handler("MiniMax off hidden", {
    isProjectTrusted: () => false, ui: { notify: value => notifications.push(value) }, cwd,
  });
  assert.match(notifications[0], /not saved/);
  const { loadMcpConfig } = await import(pathToFileURL(join(runtime.root, "dist/extensions/mcp/config.js")));
  const trusted = loadMcpConfig({ agentDir: agent, cwd, projectTrusted: true });
  assert.deepEqual(trusted.errors, []); assert.equal(trusted.servers[0].config.enabled, true); assert.equal(trusted.servers[0].config.exposure, "hidden");
  const untrusted = loadMcpConfig({ agentDir: agent, cwd, projectTrusted: false });
  assert.equal(untrusted.servers[0].config.enabled, false);
  const project = JSON.parse(readFileSync(join(cwd, ".pi/mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(project.mcpServers.MiniMax).sort(), ["enabled", "exposure"]);
});
