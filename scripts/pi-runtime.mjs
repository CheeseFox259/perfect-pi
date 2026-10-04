import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export function runNpmReadOnly(args, options = {}) {
  const { platform = process.platform, run = execFileSync, ...execOptions } = options;
  // Windows batch shims require cmd.exe. Only fixed metadata arguments are accepted;
  // no package installation or caller-provided shell syntax is allowed here.
  const allowed = [["root", "--global"], ["view", PI_PACKAGE_NAME, "version", "--json"]];
  if (!allowed.some(command => JSON.stringify(command) === JSON.stringify(args))) throw new Error("Unsupported npm metadata query");
  return platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], execOptions)
    : run("npm", args, execOptions);
}

/** Gather candidate Node package directories across supported installations. */
export function piRuntimeRoots(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const roots = [];

  // 1. Explicit PI_GLOBAL_NODE_MODULES (supports delimiter-separated paths)
  if (env.PI_GLOBAL_NODE_MODULES) {
    const delimiter = platform === "win32" ? ";" : ":";
    const explicit = env.PI_GLOBAL_NODE_MODULES.split(delimiter).filter(Boolean);
    roots.push(...explicit);
  }

  // 2. Agent directory layouts (checked early for user-installed or managed overrides)
  const agentDir = options.agentDir ?? env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  if (agentDir) {
    roots.push(
      join(agentDir, "npm", "node_modules"),
      join(agentDir, "node_modules"),
      join(agentDir, "@earendil-works", "pi-coding-agent"),
      agentDir,
    );
  }

  // 3. Windows layouts (prioritized when platform is win32)
  if (platform === "win32" || env.APPDATA || env.LOCALAPPDATA || env.ProgramFiles) {
    if (env.APPDATA) roots.push(join(env.APPDATA, "npm", "node_modules"));
    if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, "npm", "node_modules"));
    if (env.ProgramFiles) roots.push(join(env.ProgramFiles, "nodejs", "node_modules"));
  }

  // 4. npm global root
  if (options.npmGlobal) {
    roots.push(options.npmGlobal);
  } else if (!options.skipNpm) {
    try {
      const npmRoot = runNpmReadOnly(["root", "--global"], {
        platform,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: options.npmTimeoutMs ?? 3000,
      }).trim();
      if (npmRoot) roots.push(npmRoot);
    } catch {}
  }

  // 5. Node execPath prefix layouts
  const execPath = options.execPath ?? process.execPath;
  if (execPath) {
    const prefix = dirname(dirname(execPath));
    roots.push(
      join(prefix, "lib", "node_modules"),
      join(prefix, "node_modules"),
      join(dirname(execPath), "node_modules"),
    );
  }

  // 6. System lib directories (/usr/lib, /usr/local/lib, Homebrew)
  if (!options.skipSystemRoots && platform !== "win32") {
    roots.push(
      "/opt/homebrew/lib/node_modules",
      "/usr/local/lib/node_modules",
      "/usr/lib/node_modules",
      "/usr/lib",
    );
  }

  // 7. Cwd / local node_modules
  const cwd = options.cwd ?? process.cwd();
  if (cwd) {
    roots.push(join(cwd, "node_modules"));
  }

  return [...new Set(roots.filter(Boolean).map((candidate) => resolve(candidate)))];
}

/**
 * Checks whether a directory is a valid @earendil-works/pi-coding-agent package.
 */
function inspectPackageDir(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.name === PI_PACKAGE_NAME || dir.endsWith("pi-coding-agent")) {
      const entryCandidates = [
        join(dir, "dist", "index.js"),
        pkg.main ? join(dir, pkg.main) : null,
        join(dir, "index.js"),
      ].filter(Boolean);
      const entry = entryCandidates.find((e) => existsSync(e)) ?? join(dir, "dist", "index.js");
      return {
        version: pkg.version,
        root: dir,
        packageDir: dir,
        entry,
      };
    }
  } catch {}
  return null;
}

/**
 * Detect installed Pi host runtime across portable layout candidates.
 *
 * @param {object} [options]
 * @returns {Promise<{ version: string, root: string, packageDir: string, entry: string } | null>}
 */
export async function detectPiRuntime(options = {}) {
  const roots = options.roots ?? piRuntimeRoots(options);
  for (const root of roots) {
    // Check candidate as container (e.g. node_modules/@earendil-works/pi-coding-agent)
    const directCandidate = join(root, ...PI_PACKAGE_NAME.split("/"));
    const directHit = inspectPackageDir(directCandidate);
    if (directHit) return directHit;

    // Check candidate as the package directory itself
    const rootHit = inspectPackageDir(root);
    if (rootHit) return rootHit;
  }
  return null;
}

/**
 * Alias for detectPiRuntime.
 */
export const resolvePiRuntime = detectPiRuntime;

/**
 * Convenience helper to get the executable index.js entry path of Pi coding agent.
 */
export async function findPiEntry(options = {}) {
  const runtime = await detectPiRuntime(options);
  return runtime?.entry ?? null;
}
