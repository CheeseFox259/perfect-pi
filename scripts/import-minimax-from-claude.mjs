#!/usr/bin/env node
import { readFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { storeMcpSecret } from "./mcp-secrets.mjs";
import { configureMiniMax, MINIMAX_HOSTS } from "./mcp-config.mjs";

try {
  const scripts = dirname(fileURLToPath(import.meta.url));
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
  const claude = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
  const entry = claude.mcpServers?.MiniMax;
  if (entry?.command !== "uvx" || entry.args?.[0] !== "minimax-coding-plan-mcp") throw new Error();
  const key = entry.env?.MINIMAX_API_KEY;
  const host = entry.env?.MINIMAX_API_HOST ?? MINIMAX_HOSTS[0];
  if (typeof key !== "string" || !key || !MINIMAX_HOSTS.includes(host)) throw new Error();
  const configFile = join(agentDir, "mcp.json");
  const existing = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  if (existing.mcpServers?.MiniMax) throw new Error();
  mkdirSync(join(agentDir, "scripts"), { recursive: true });
  for (const name of ["mcp-launch.mjs", "mcp-secrets.mjs"]) copyFileSync(join(scripts, name), join(agentDir, "scripts", name));
  storeMcpSecret(agentDir, "MiniMax", "MINIMAX_API_KEY", key);
  configureMiniMax(agentDir, host);
  console.log(JSON.stringify({ ok: true, server: "MiniMax", credentialStoredPrivately: true,
    claudeModified: false, keyInConfigOrArgs: false, globalConfigPrepared: true }));
} catch { console.error("MiniMax import was not completed; no secret output. Check server configuration or existing Pi entry."); process.exitCode = 1; }
