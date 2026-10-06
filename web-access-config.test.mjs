import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureEagerWebTools, inspectWebToolActivation, webSearchConfigPath } from "./scripts/web-access-config.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "perfect-pi-web-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, "web-search.json") };
}

test("search config resolution preserves upstream legacy and XDG precedence", t => {
  const { dir } = fixture(t);
  const home = join(dir, "home");
  const agentDir = join(home, ".pi/agent");
  mkdirSync(agentDir, { recursive: true });
  const legacy = join(home, ".pi/web-search.json");
  writeFileSync(legacy, '{}');
  assert.equal(webSearchConfigPath(agentDir, { home, env: {} }), legacy);
  const current = join(agentDir, "web-search.json");
  writeFileSync(current, '{}');
  assert.equal(webSearchConfigPath(agentDir, { home, env: {} }), current);
  const xdgHome = join(dir, "xdg");
  const xdg = join(xdgHome, "pi/web-search.json");
  assert.equal(webSearchConfigPath(agentDir, { home, env: { XDG_CONFIG_HOME: xdgHome } }), legacy);
  mkdirSync(join(xdgHome, "pi"), { recursive: true });
  writeFileSync(xdg, '{}');
  assert.equal(webSearchConfigPath(agentDir, { home, env: { XDG_CONFIG_HOME: xdgHome } }), xdg);
  assert.equal(webSearchConfigPath(agentDir, { home, env: { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: xdgHome } }), current);
});

test("web eager default is dry-run safe, private, minimal and idempotent", t => {
  const { dir, path } = fixture(t);
  assert.equal(inspectWebToolActivation(dir).status, "MISSING");
  assert.equal(ensureEagerWebTools(dir, { dryRun: true }).status, "planned");
  assert.equal(existsSync(path), false);
  ensureEagerWebTools(dir);
  assert.deepEqual(JSON.parse(readFileSync(path)), { toolActivation: "eager" });
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  const before = readFileSync(path, "utf8");
  assert.equal(ensureEagerWebTools(dir).status, "preserved");
  assert.equal(readFileSync(path, "utf8"), before);
});

test("explicit modes and all personal fields are preserved, never returned", t => {
  const { dir, path } = fixture(t);
  for (const mode of ["eager", "dynamic"]) {
    const config = { toolActivation: mode, apiKey: "synthetic-secret", toolNames: { web_search: "custom_search" }, tools: { web_search: { enabled: false } } };
    writeFileSync(path, JSON.stringify(config));
    const before = readFileSync(path, "utf8");
    const result = ensureEagerWebTools(dir);
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(JSON.stringify(result).includes(config.apiKey), false);
    assert.equal(inspectWebToolActivation(dir).status, "SYNCED");
  }
});

test("unsafe paths, malformed config and lock contention fail closed", t => {
  const { dir, path } = fixture(t);
  symlinkSync(join(dir, "missing"), path);
  assert.throws(() => ensureEagerWebTools(dir), /Unsafe/);
  rmSync(path);
  for (const content of ['{"apiKey":"synthetic-secret",bad', '[]', 'null', '{"toolActivation":"invalid"}']) {
    writeFileSync(path, content);
    assert.throws(() => ensureEagerWebTools(dir), error => /Invalid/.test(error.message) && !error.message.includes("synthetic-secret"));
    assert.equal(inspectWebToolActivation(dir).status, "DRIFTED");
  }
  writeFileSync(path, '{}');
  mkdirSync(`${path}.perfect-pi-lock`);
  assert.throws(() => ensureEagerWebTools(dir), /busy/);
  assert.equal(readFileSync(path, "utf8"), '{}');
});
