import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const validServer = name => typeof name === "string" && /^[A-Za-z0-9_-]+$/.test(name);
const validEnv = name => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
export function validateSecretTarget(server, envName) {
  const reserved = ["__proto__", "prototype", "constructor"];
  if (!validServer(server) || !validEnv(envName) || reserved.includes(server) || reserved.includes(envName)) throw new Error("Invalid MCP server or environment key name");
}
export function agentDirectory() {
  return resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"));
}
function privatePaths(agentDir, create = false) {
  const directory = join(agentDir, "mcp-private");
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())) throw new Error("Unsafe MCP private directory");
  if (create && process.platform !== "win32") chmodSync(directory, 0o700);
  return { directory, file: join(directory, "secrets.json"), lock: join(directory, ".write-lock") };
}
function readSecrets(file) {
  if (!existsSync(file)) return {};
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077))) throw new Error("Unsafe MCP credential file permissions");
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error("Invalid MCP credential store"); }
}
export function readMcpSecret(agentDir, server, envName) {
  validateSecretTarget(server, envName);
  const value = readSecrets(privatePaths(agentDir).file)[server]?.[envName];
  if (typeof value !== "string" || !value) throw new Error("MCP key is not configured");
  return value;
}
export function storeMcpSecret(agentDir, server, envName, value) {
  validateSecretTarget(server, envName);
  if (typeof value !== "string" || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid MCP key");
  const { file, directory, lock } = privatePaths(agentDir, true);
  let acquired = false;
  for (let i = 0; i < 10; i++) {
    try { mkdirSync(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) { if (error.code !== "EEXIST") throw new Error("Unable to lock MCP credentials"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
  }
  if (!acquired) throw new Error("MCP credential store is busy");
  const temporary = join(directory, `.secrets-${randomUUID()}`);
  try {
    const secrets = readSecrets(file);
    secrets[server] = { ...secrets[server], [envName]: value.trim() };
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, `${JSON.stringify(secrets)}\n`); } finally { closeSync(fd); }
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); rmSync(lock, { recursive: true, force: true }); }
}
