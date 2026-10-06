#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMcpSecret } from "./mcp-secrets.mjs";

export function childEnvironment(agentDir, server, envName, secret) {
  const base = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "UV_CACHE_DIR"];
  // Native Pi resolves config values before spawning this launcher; never evaluate env expressions here.
  let configured = [];
  try { configured = Object.keys(JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8")).mcpServers?.[server]?.env ?? {}); }
  catch {}
  const env = Object.fromEntries([...new Set([...base, ...configured])].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  return envName ? { ...env, [envName]: secret } : env;
}

export function launchMcp(argv, options = {}) {
  const publicServer = argv[0] === "--public";
  const [agentDir, server, envName, command, ...args] = publicServer
    ? [argv[1], argv[2], undefined, argv[3], ...argv.slice(4)] : argv;
  if (!agentDir || !server || !command) throw new Error("MCP launcher configuration is incomplete");
  const secret = publicServer ? undefined : readMcpSecret(agentDir, server, envName);
  const child = (options.spawn ?? spawn)(command, args, {
    env: childEnvironment(agentDir, server, envName, secret), stdio: ["pipe", "pipe", "pipe"], shell: false,
    detached: process.platform !== "win32",
  });
  const streams = options.streams ?? process;
  streams.stdin.pipe(child.stdin);
  const redact = value => secret ? value.split(secret).join("[REDACTED]") : value;
  const relay = (source, target) => {
    source.setEncoding("utf8"); let pending = "";
    source.on("data", chunk => {
      pending += chunk;
      if (pending.length > 8 * 1024 * 1024) { pending = ""; stop(); return; }
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        target.write(redact(pending.slice(0, end + 1))); pending = pending.slice(end + 1);
      }
    });
    source.on("end", () => { if (pending) target.write(redact(pending)); });
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
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await launchMcp(process.argv.slice(2)); }
  catch { process.stderr.write("MCP launch failed; check credentials and configuration\n"); process.exitCode = 1; }
}
