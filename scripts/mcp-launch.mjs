#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMcpSecret } from "./mcp-secrets.mjs";

export function childEnvironment(agentDir, server, envName, secret) {
  const base = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "UV_CACHE_DIR"];
  let configured = [];
  try { configured = Object.keys(JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8")).mcpServers?.[server]?.env ?? {}); }
  catch {}
  const env = Object.fromEntries([...new Set([...base, ...configured])].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  return { ...env, [envName]: secret };
}

export function launchMcp(argv, options = {}) {
  const [agentDir, server, envName, command, ...args] = argv;
  if (!agentDir || !command) throw new Error("MCP launcher configuration is incomplete");
  const secret = readMcpSecret(agentDir, server, envName);
  const child = (options.spawn ?? spawn)(command, args, {
    env: childEnvironment(agentDir, server, envName, secret), stdio: ["pipe", "pipe", "pipe"], shell: false,
    detached: process.platform !== "win32",
  });
  const streams = options.streams ?? process;
  streams.stdin.pipe(child.stdin);
  const relay = (source, target) => {
    source.setEncoding("utf8"); let pending = "";
    source.on("data", chunk => {
      pending += chunk;
      if (pending.length > 8 * 1024 * 1024) { pending = ""; stop(); return; }
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        target.write(pending.slice(0, end + 1).split(secret).join("[REDACTED]")); pending = pending.slice(end + 1);
      }
    });
    source.on("end", () => { if (pending) target.write(pending.split(secret).join("[REDACTED]")); });
  };
  relay(child.stdout, streams.stdout); relay(child.stderr, streams.stderr);
  child.stdin.on("error", () => {});
  let killTimer;
  let stopping = false;
  const killGroup = signal => {
    if (process.platform !== "win32" && child.pid) {
      try { process.kill(-child.pid, signal); } catch {}
    } else child.kill(signal);
  };
  const stop = () => {
    if (stopping) return; stopping = true;
    streams.stdin.unpipe(child.stdin); child.stdin.end();
    killGroup("SIGTERM");
    killTimer = setTimeout(() => killGroup("SIGKILL"), 2000);
  };
  let shutdownTimer;
  const inputEnded = () => { shutdownTimer ??= setTimeout(stop, 1000); };
  streams.stdin.once("end", inputEnded); streams.stdin.once("close", inputEnded);
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  return new Promise(resolveResult => {
    let finished = false;
    const finish = code => {
      if (finished) return; finished = true;
      streams.stdin.unpipe(child.stdin); streams.stdin.pause();
      clearTimeout(shutdownTimer); clearTimeout(killTimer); streams.stdin.removeListener("end", inputEnded); streams.stdin.removeListener("close", inputEnded);
      process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
      resolveResult(code);
    };
    child.once("error", () => { streams.stderr.write("MCP child could not start\n"); finish(1); });
    child.once("close", code => finish(code ?? 1));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await launchMcp(process.argv.slice(2)); }
  catch { process.stderr.write("MCP launch failed; check credentials and configuration\n"); process.exitCode = 1; }
}
