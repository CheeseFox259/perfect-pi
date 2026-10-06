import { lstatSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { applyMcpDefaults, updateMcpFile } from "./mcp-config.mjs";

const exposures = ["codemode", "deferred", "direct", "hidden"];
export function managedMcpConfigs(manifest, agentDir) {
  return Object.fromEntries(Object.entries(manifest.mcpServers ?? {}).map(([name, entry]) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name) || !/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+@\d+\.\d+\.\d+$/.test(entry.package)) throw new Error(`Invalid pinned MCP declaration: ${name}`);
    if (!Array.isArray(entry.tools) || !entry.tools.length || entry.tools.some(tool => !/^[a-zA-Z0-9_]+$/.test(tool))) throw new Error(`Invalid MCP tool allowlist: ${name}`);
    if (!entry.dataEnv || !/^[A-Z_]+$/.test(entry.dataEnv)) throw new Error(`Invalid MCP storage declaration: ${name}`);
    return [name, {
      command: process.execPath,
      args: [join(agentDir, "scripts/mcp-launch.mjs"), "--public", agentDir, name, "npx", "--yes", "--prefer-offline", entry.package],
      env: { [entry.dataEnv]: join(agentDir, "mcp-data", name) },
      exposure: "codemode",
      toolExposure: { ...Object.fromEntries(entry.tools.map(tool => [tool, "codemode"])), "*": "hidden" },
      description: entry.description,
    }];
  }));
}
function readConfig(agentDir) {
  const path = join(agentDir, "mcp.json");
  const file = lstatSync(path, { throwIfNoEntry: false });
  if (!file) return {};
  if (file.isSymbolicLink() || !file.isFile()) throw new Error("Unsafe MCP configuration path");
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed.mcpServers && (typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)))) throw new Error("Invalid MCP configuration");
  return parsed;
}
// Enabled state and server-level exposure are user preferences. The tool allowlist is managed.
function owned(config) {
  const { enabled, exposure, ...fields } = config ?? {};
  return fields;
}
function matches(actual, expected) {
  return actual && expected && isDeepStrictEqual(owned(actual), owned(expected)) &&
    (actual.enabled === undefined || typeof actual.enabled === "boolean") &&
    (actual.exposure === undefined || exposures.includes(actual.exposure));
}
function canAdopt(actual, declaration) {
  return actual?.command === "npx" && isDeepStrictEqual(actual.args, ["-y", declaration.package.replace(/@\d+\.\d+\.\d+$/, "")]) &&
    Object.keys(actual).every(key => ["command", "args", "description", "exposure", "enabled"].includes(key)) &&
    (actual.enabled === undefined || typeof actual.enabled === "boolean") && exposures.includes(actual.exposure);
}
function storagePaths(agentDir, name) {
  return [join(agentDir, "mcp-data"), join(agentDir, "mcp-data", name)];
}
export function planManagedMcp(manifest, agentDir, previous = {}, { adopt = false, current = readConfig(agentDir) } = {}) {
  const desired = managedMcpConfigs(manifest, agentDir);
  for (const name of Object.keys(desired)) for (const path of storagePaths(agentDir, name)) {
    const file = lstatSync(path, { throwIfNoEntry: false });
    if (file && (!file.isDirectory() || file.isSymbolicLink())) throw new Error(`Unsafe MCP storage path for ${name}`);
  }
  const servers = { ...current.mcpServers };
  const adopted = [];
  for (const [name, expected] of Object.entries(desired)) {
    const collision = Object.keys(servers).find(other => other !== name && other.replaceAll("-", "_") === name.replaceAll("-", "_"));
    if (collision) throw new Error(`MCP name collision: ${name}`);
    const actual = servers[name];
    if (actual && !matches(actual, previous[name]) && !matches(actual, expected)) {
      if (!adopt || !canAdopt(actual, manifest.mcpServers[name])) throw new Error(`Refusing to overwrite unmanaged or edited MCP server: ${name}`);
      adopted.push(name);
    }
    servers[name] = { ...expected, ...(actual?.enabled === undefined ? {} : { enabled: actual.enabled }), ...(actual?.exposure === undefined ? {} : { exposure: actual.exposure }) };
  }
  for (const [name, old] of Object.entries(previous)) {
    if (desired[name] || !servers[name]) continue;
    if (!matches(servers[name], old)) throw new Error(`Refusing to remove edited MCP server: ${name}`);
    delete servers[name];
  }
  return { next: applyMcpDefaults({ ...current, mcpServers: servers }, manifest.mcpDefaults), owned: desired, adopted };
}
export function syncManagedMcp(manifest, agentDir, previous, options = {}) {
  let plan;
  updateMcpFile(join(agentDir, "mcp.json"), current => {
    plan = planManagedMcp(manifest, agentDir, previous, { ...options, current });
    for (const name of Object.keys(plan.owned)) {
      for (const path of storagePaths(agentDir, name)) {
        const file = lstatSync(path, { throwIfNoEntry: false });
        if (file && (!file.isDirectory() || file.isSymbolicLink())) throw new Error(`Unsafe MCP storage path for ${name}`);
        if (!file) mkdirSync(path, { mode: 0o700 });
        else if (process.platform !== "win32" && (file.mode & 0o077)) chmodSync(path, 0o700);
      }
    }
    return plan.next;
  });
  return plan;
}
export function inspectManagedMcp(manifest, agentDir, previous = {}) {
  const desired = managedMcpConfigs(manifest, agentDir);
  let current;
  try { current = readConfig(agentDir); } catch { return { status: "DRIFTED", detail: "Invalid or unsafe MCP configuration; contents withheld" }; }
  const missing = Object.keys(desired).filter(name => !current.mcpServers?.[name]);
  const drifted = Object.entries(desired).filter(([name, config]) => !matches(current.mcpServers?.[name], config) || !matches(previous[name], config)).map(([name]) => name);
  const stale = Object.keys(previous).filter(name => !desired[name] && current.mcpServers?.[name]);
  const unsafeStorage = Object.keys(desired).filter(name => storagePaths(agentDir, name).some(path => {
    const file = lstatSync(path, { throwIfNoEntry: false });
    return !file || !file.isDirectory() || file.isSymbolicLink() || (process.platform !== "win32" && (file.mode & 0o077));
  }));
  return { status: missing.length ? "MISSING" : drifted.length || stale.length || unsafeStorage.length ? "DRIFTED" : "SYNCED",
    detail: `${Object.keys(desired).length} pinned servers; configuration/ownership only, not runtime health${missing.length ? `; missing: ${missing.join(", ")}` : ""}${drifted.length ? `; drifted: ${drifted.join(", ")}` : ""}${stale.length ? `; stale: ${stale.join(", ")}` : ""}${unsafeStorage.length ? `; missing or unsafe storage: ${unsafeStorage.join(", ")}` : ""}` };
}
