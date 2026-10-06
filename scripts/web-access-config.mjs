import { existsSync, lstatSync, readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_WEB_TOOL_ACTIVATION = "eager";

// Match pi-web-access's explicit-dir/XDG/legacy path precedence; never shadow
// an existing legacy config with a new credential-less file in the agent dir.
export function webSearchConfigPath(agentDir, { env = process.env, home = homedir() } = {}) {
  if (env.PI_CODING_AGENT_DIR || agentDir !== join(home, ".pi/agent")) return join(agentDir, "web-search.json");
  const legacy = join(home, ".pi/web-search.json");
  if (env.XDG_CONFIG_HOME) {
    const xdg = join(env.XDG_CONFIG_HOME, "pi/web-search.json");
    return existsSync(xdg) ? xdg : existsSync(legacy) ? legacy : xdg;
  }
  const current = join(agentDir, "web-search.json");
  return existsSync(current) ? current : existsSync(legacy) ? legacy : current;
}

function readConfig(agentDir) {
  const path = webSearchConfigPath(agentDir);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { path, value: {} };
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Unsafe web-search configuration path");
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("Invalid web-search configuration; contents withheld"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid web-search configuration; contents withheld");
  if (value.toolActivation !== undefined && !["eager", "dynamic"].includes(value.toolActivation)) {
    throw new Error("Invalid web-search toolActivation; expected eager or dynamic");
  }
  return { path, value };
}

// This is a user default, not an override. Never return or log config contents.
export function ensureEagerWebTools(agentDir, { dryRun = false } = {}) {
  let { path, value } = readConfig(agentDir);
  if (value.toolActivation !== undefined) return { status: "preserved", path };
  if (dryRun) return { status: "planned", path };
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.perfect-pi-lock`;
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error("Web-search configuration is busy; no update made"); }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    ({ path, value } = readConfig(agentDir));
    if (value.toolActivation !== undefined) return { status: "preserved", path };
    writeFileSync(temporary, `${JSON.stringify({ ...value, toolActivation: DEFAULT_WEB_TOOL_ACTIVATION }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    return { status: "updated", path };
  } finally {
    rmSync(temporary, { force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

export function inspectWebToolActivation(agentDir) {
  try {
    const { value } = readConfig(agentDir);
    if (value.toolActivation === undefined) return { status: "MISSING", detail: "default eager activation is not configured" };
    return { status: "SYNCED", detail: value.toolActivation === "eager" ? "eager tool activation" : "dynamic activation (user preference)" };
  } catch (error) {
    return { status: "DRIFTED", detail: error.message };
  }
}
