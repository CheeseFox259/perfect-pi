import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { validateSecretTarget } from "./mcp-secrets.mjs";
import { randomUUID } from "node:crypto";

export const MINIMAX_HOSTS = ["https://api.minimaxi.com", "https://api.minimax.io"];
export function minimaxConfig(agentDir, host = MINIMAX_HOSTS[0]) {
  if (!MINIMAX_HOSTS.includes(host)) throw new Error("Unsupported MiniMax API host");
  return { command: process.execPath,
    args: [join(agentDir, "scripts/mcp-launch.mjs"), agentDir, "MiniMax", "MINIMAX_API_KEY", "uvx", "minimax-coding-plan-mcp", "-y"],
    env: { MINIMAX_API_HOST: host }, exposure: "codemode",
    description: "MiniMax Coding Plan: web search and image understanding. External requests require task authorization." };
}
export function updateMcpFile(path, change) {
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())) throw new Error("Unsafe MCP configuration path");
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.perfect-pi-lock`;
  let acquired = false;
  for (let i = 0; i < 10; i++) {
    try { mkdirSync(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) { if (error.code !== "EEXIST") throw new Error("Unable to lock MCP configuration"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
  }
  if (!acquired) throw new Error("MCP configuration is busy");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const parsed = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid MCP configuration");
    const next = change(parsed);
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" }); renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); rmSync(lock, { recursive: true, force: true }); }
}
export function configureMiniMax(agentDir, host) {
  mkdirSync(agentDir, { recursive: true });
  const config = minimaxConfig(agentDir, host);
  updateMcpFile(join(agentDir, "mcp.json"), current => {
    if (current.mcpServers?.MiniMax) throw new Error("MiniMax is already configured; update its key instead");
    return { ...current, mcpServers: { ...current.mcpServers, MiniMax: config } };
  });
  return config;
}
export function configureServerKey(agentDir, server, envName) {
  validateSecretTarget(server, envName);
  updateMcpFile(join(agentDir, "mcp.json"), current => {
    const config = current.mcpServers?.[server];
    if (!config?.command || config.url) throw new Error("Private key entry currently supports stdio MCP servers; use native OAuth for HTTP");
    const launcher = join(agentDir, "scripts/mcp-launch.mjs");
    if (config.args?.[0] === launcher && config.args?.[3] !== envName) throw new Error("This server's private wrapper already uses another environment key");
    const env = { ...config.env }; delete env[envName];
    const wrapped = config.args?.[0] === launcher ? { ...config, env } : { ...config, command: process.execPath,
      args: [launcher, agentDir, server, envName, config.command, ...(config.args ?? [])], env };
    return { ...current, mcpServers: { ...current.mcpServers, [server]: wrapped } };
  });
}

export function projectMcpOverride(cwd, server, { enabled, exposure }) {
  validateSecretTarget(server, "API_KEY");
  if (typeof enabled !== "boolean" || !["codemode", "deferred", "direct", "hidden"].includes(exposure)) throw new Error("Invalid MCP project profile");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  updateMcpFile(join(cwd, ".pi/mcp.json"), current => {
    const existing = current.mcpServers?.[server];
    if (existing && (existing.command || existing.url || existing.type)) throw new Error("Project already defines this MCP server; use native /mcp to manage it");
    return { ...current, mcpServers: { ...current.mcpServers, [server]: { ...existing, enabled, exposure } } };
  });
}
