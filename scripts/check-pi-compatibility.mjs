#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectPiRuntime } from "./pi-runtime.mjs";

const root = resolve(import.meta.dirname, "..");
const requiredFunctions = ["compact", "SettingsManager", "SessionManager", "DefaultPackageManager",
  "createEditToolDefinition", "createWriteToolDefinition", "getAgentDir", "serializeConversation", "convertToLlm"];

export async function checkPiCompatibility(options = {}) {
  const errors = [], verified = [];
  const runtime = options.runtime ?? await detectPiRuntime(options);
  const manifest = options.manifest ?? JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (!runtime) return { ok: false, version: null, baseline: manifest.piVersion, errors: ["Pi runtime not found"], verified };
  try {
    const pi = await import(pathToFileURL(runtime.entry).href);
    for (const name of requiredFunctions) {
      if (typeof pi[name] !== "function") errors.push(`Missing Pi export: ${name}`);
      else verified.push(`export:${name}`);
    }
    for (const name of ["create", "inMemory", "fromStorage"]) {
      if (typeof pi.SettingsManager?.[name] !== "function") errors.push(`Missing SettingsManager.${name}`);
    }
    if (errors.length) throw new Error("Required public API missing");
    const storageModule = await import(pathToFileURL(join(dirname(runtime.entry), "core/settings-manager.js")).href);
    if (typeof storageModule.FileSettingsStorage?.prototype.withLock !== "function") throw new Error("Global settings storage bridge unavailable");
    verified.push("storage:FileSettingsStorage.withLock");
    const settings = pi.SettingsManager.inMemory();
    for (const name of ["getGlobalSettings", "getRetrySettings", "getCompactionSettings"]) {
      if (typeof settings[name] !== "function") throw new Error(`Missing settings API: ${name}`);
      verified.push(`settings:${name}`);
    }
    const loader = await import(pathToFileURL(join(dirname(runtime.entry), "core/extensions/loader.js")).href);
    const directory = join(options.root ?? root, "global/extensions");
    const paths = (await readdir(directory)).filter(name => name.endsWith(".ts")).map(name => join(directory, name));
    const loaded = await loader.loadExtensions(paths, options.root ?? root);
    for (const error of loaded.errors) errors.push(`Extension load failed: ${JSON.stringify(error)}`);
    for (const extension of loaded.extensions) verified.push(`extension:${extension.path}`);
    const compaction = loaded.extensions.find(extension => extension.path.endsWith("compaction-model.ts"));
    if (!compaction?.commands.has("compaction-model") || !compaction?.handlers.has("session_before_compact")) {
      errors.push("Compaction model command/hook did not register");
    }
  } catch (error) { errors.push(error.message); }
  return { ok: errors.length === 0, version: runtime.version, baseline: manifest.piVersion,
    versionMatchesBaseline: runtime.version === manifest.piVersion, verified, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkPiCompatibility();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
