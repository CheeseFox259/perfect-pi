#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function detectPiRuntime() {
  const roots = [
    join(homedir(), ".pi", "agent"),
    "/opt/homebrew/lib/node_modules",
    "/usr/local/lib/node_modules",
  ];
  for (const root of roots) {
    const pkgPath = join(root, "@earendil-works", "pi-coding-agent", "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        return { version: pkg.version, root: join(root, "@earendil-works", "pi-coding-agent") };
      } catch {}
    }
  }
  return null;
}

export async function checkSolPiContract(options = {}) {
  const root = options.root ? resolve(options.root) : defaultRoot;
  const manifestPath = options.manifestPath || join(root, "manifest.json");
  const componentsPath = options.componentsPath || join(root, "components.json");

  const manifest = options.manifest || (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {});
  const components = options.components || (existsSync(componentsPath) ? JSON.parse(readFileSync(componentsPath, "utf8")) : {});

  const pinnedRef = manifest.solPi?.pinnedRef
    || components.upstreams?.["NVlabs/SoL-Pi"]?.pinnedRef
    || "e1a586af0ad8956f42ae5b26bba20e48fbf30e00";

  const agentDir = options.agentDir || process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const candidates = [
    options.packageDir,
    join(agentDir, "git", "github.com", "CheeseFox259", "SoL-Pi"),
    join(agentDir, "git", "github.com", "NVlabs", "SoL-Pi"),
  ].filter(Boolean);

  let packageDir = candidates.find((dir) => existsSync(join(dir, "package.json")));
  const errors = [];
  const verifiedModules = [];
  const verifiedExports = [];

  if (!packageDir) {
    errors.push(`SoL-Pi package directory not found. Expected in: ${candidates.join(", ")}`);
    return {
      ok: false,
      pinnedRef,
      packageDir: null,
      actualRef: null,
      verifiedModules,
      verifiedExports,
      errors,
    };
  }

  let actualRef = null;
  try {
    actualRef = execFileSync("git", ["-C", packageDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    errors.push(`Failed to verify git HEAD in ${packageDir}: ${err.message}`);
  }

  if (actualRef && actualRef !== pinnedRef) {
    errors.push(`Installed SoL-Pi git HEAD mismatch: expected ${pinnedRef}, got ${actualRef}`);
  }

  const runtime = await detectPiRuntime();
  if (!runtime) {
    errors.push("Pi coding agent host runtime not found");
    return { ok: false, pinnedRef, packageDir, actualRef, verifiedModules, verifiedExports, errors };
  }

  const piRoot = runtime.root;
  const req = createRequire(join(piRoot, "dist", "core", "extensions", "loader.js"));
  const { createJiti } = await import(join(piRoot, "dist", "core", "extensions", "jiti-loader.js"));
  const aiRoot = join(piRoot, "node_modules", "@earendil-works", "pi-ai");

  let typeboxEntry;
  try {
    typeboxEntry = req.resolve("typebox");
  } catch {
    typeboxEntry = join(piRoot, "node_modules", "typebox", "build", "index.mjs");
  }

  const aliases = {
    typebox: typeboxEntry,
    "typebox/compile": typeboxEntry.replace(/index\.[^.]+$/, "compile.mjs"),
    "typebox/value": typeboxEntry.replace(/index\.[^.]+$/, "value.mjs"),
    "@earendil-works/pi-coding-agent": join(piRoot, "dist", "index.js"),
    "@earendil-works/pi-agent-core": join(piRoot, "node_modules", "@earendil-works", "pi-agent-core", "dist", "index.js"),
    "@earendil-works/pi-ai/providers/all": join(aiRoot, "dist", "providers", "all.js"),
    "@earendil-works/pi-ai/compat": join(aiRoot, "dist", "compat.js"),
    "@earendil-works/pi-ai/oauth": join(aiRoot, "dist", "oauth.js"),
    "@earendil-works/pi-ai": join(aiRoot, "dist", "compat.js"),
    "@earendil-works/pi-tui": join(piRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js"),
  };

  const jiti = createJiti(join(piRoot, "dist", "index.js"), { alias: aliases });
  const loadModule = async (subPath) => {
    const fullPath = join(packageDir, "src", "sol-pi", subPath);
    if (!existsSync(fullPath)) {
      errors.push(`Required SoL-Pi module missing on disk: ${subPath}`);
      return null;
    }
    try {
      const mod = await jiti.import(fullPath);
      verifiedModules.push(subPath);
      return mod;
    } catch (err) {
      errors.push(`Failed to import SoL-Pi module ${subPath}: ${err.message}`);
      return null;
    }
  };

  const checkExports = (subPath, mod, expected) => {
    if (!mod) return;
    for (const [name, expectedType] of Object.entries(expected)) {
      const actualType = typeof mod[name];
      if (actualType !== expectedType) {
        errors.push(`Export '${name}' in ${subPath} is expected to be ${expectedType}, found ${actualType}`);
      } else {
        verifiedExports.push(`${subPath}:${name}`);
      }
    }
  };

  const cfg = await loadModule("config.ts");
  checkExports("config.ts", cfg, {
    loadSolPiConfig: "function",
    findConfigPath: "function",
  });

  const fq = await loadModule("extensions/action-fusion/file-queue.ts");
  checkExports("extensions/action-fusion/file-queue.ts", fq, {
    withFusedFileQueue: "function",
    resolveToolPath: "function",
  });

  const tr = await loadModule("extensions/action-fusion/then-run.ts");
  checkExports("extensions/action-fusion/then-run.ts", tr, {
    assertUnchangedBeforeCommand: "function",
  });

  const obs = await loadModule("extensions/observation-pack/index.ts");
  checkExports("extensions/observation-pack/index.ts", obs, {
    registerObservationPack: "function",
    createObservationPackExtension: "function",
  });

  const obsHelper = await loadModule("extensions/observation-pack/observation.ts");
  checkExports("extensions/observation-pack/observation.ts", obsHelper, {
    createObservation: "function",
    isObservationId: "function",
  });

  const red = await loadModule("extensions/evidence-preserving-reducer/index.ts");
  checkExports("extensions/evidence-preserving-reducer/index.ts", red, {
    registerEvidencePreservingReducer: "function",
  });

  const occ = await loadModule("extensions/online-context-compact/index.ts");
  checkExports("extensions/online-context-compact/index.ts", occ, {
    registerOnlineContextCompact: "function",
    buildCompactionInstructions: "function",
  });

  // Test functional sanity on exported helpers
  if (fq?.resolveToolPath) {
    try {
      const resolved = fq.resolveToolPath(root, "sample.txt");
      if (typeof resolved !== "string" || !resolved.endsWith("sample.txt")) {
        errors.push(`resolveToolPath failed sanity check: ${resolved}`);
      }
    } catch (err) {
      errors.push(`resolveToolPath threw during sanity check: ${err.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    packageDir,
    pinnedRef,
    actualRef,
    piVersion: runtime.version,
    verifiedModules,
    verifiedExports,
    errors,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const report = await checkSolPiContract();
  if (args.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`SoL-Pi Compatibility Contract: ${report.ok ? "VERIFIED" : "FAILED"}`);
    console.log(`  Package directory: ${report.packageDir ?? "none"}`);
    console.log(`  Pinned git commit: ${report.pinnedRef}`);
    console.log(`  Actual git commit: ${report.actualRef ?? "unknown"}`);
    console.log(`  Modules verified:  ${report.verifiedModules.length}`);
    console.log(`  Exports verified:  ${report.verifiedExports.length}`);
    if (report.errors.length > 0) {
      console.log("\nErrors:");
      for (const err of report.errors) console.log(`  - ${err}`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
