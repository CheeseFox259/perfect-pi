import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";

const root = dirname(fileURLToPath(import.meta.url));
const agentDir = process.env.PI_CODING_AGENT_DIR
  ? resolve(process.env.PI_CODING_AGENT_DIR.replace(/^~(?=\/|$)/, homedir()))
  : join(homedir(), ".pi", "agent");
const manifestPath = join(root, "manifest.json");
const componentsPath = join(root, "components.json");
const statePath = join(agentDir, ".perfect-pi-state.json");

const readJson = async (path, fallback = {}) => {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
};

const packageSources = (manifest) => manifest.packages.map((pkg) => typeof pkg === "string" ? pkg : pkg.source);
const packageDeclarations = (manifest) => manifest.packages.map((pkg) => {
  if (typeof pkg === "string") return pkg;
  const filters = Object.fromEntries(["extensions", "skills", "prompts", "themes"].filter((key) => key in pkg).map((key) => [key, pkg[key]]));
  return Object.keys(filters).length ? { source: pkg.source, ...filters } : pkg.source;
});

const piRuntimePackage = "@earendil-works/pi-coding-agent";

// The host runtime is not a managed resource, so its version is read from the
// installed package rather than from the ownership registry. PI_GLOBAL_NODE_MODULES
// lets non-standard layouts and tests point the search at explicit roots.
export function piRuntimeRoots() {
  const roots = (process.env.PI_GLOBAL_NODE_MODULES ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean);
  const prefix = dirname(dirname(process.execPath));
  roots.push(
    join(prefix, "lib", "node_modules"),
    join(prefix, "node_modules"),
    "/opt/homebrew/lib/node_modules",
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
  );
  if (process.platform === "win32" && process.env.APPDATA) roots.push(join(process.env.APPDATA, "npm", "node_modules"));
  return [...new Set(roots.map((candidate) => resolve(candidate)))];
}

export async function detectPiRuntime(roots = piRuntimeRoots()) {
  for (const root of roots) {
    const manifest = await readJson(join(root, ...piRuntimePackage.split("/"), "package.json"), null).catch(() => null);
    if (manifest?.version) return { version: manifest.version, root };
  }
  return null;
}

function expectedSkillNames(manifest) {
  const requiredMatt = manifest.skills.find((skill) => skill.source === "mattpocock/skills")?.requiredSkills ?? [];
  return (manifest.skills ?? []).flatMap((entry) => {
    if (entry.source.startsWith("local:")) return [entry.source.slice("local:".length)];
    if (entry.selection === "all") return requiredMatt;
    return entry.selection;
  });
}

function hasSkill(name) {
  return existsSync(join(agentDir, "skills", name, "SKILL.md"))
    || existsSync(join(homedir(), ".agents", "skills", name, "SKILL.md"))
    || existsSync(join(homedir(), ".pi", "agent", "skills", name, "SKILL.md"));
}

function skillPatterns(manifest, components = null) {
  const names = manifest.skillPolicy?.excludeFromPi ?? [];
  const local = names.map((name) => `-skills/${name}/SKILL.md`);
  const duplicated = expectedSkillNames(manifest).filter((name) => {
    const piPath = join(agentDir, "skills", name, "SKILL.md");
    const sharedPath = join(homedir(), ".agents", "skills", name, "SKILL.md");
    return existsSync(piPath) && existsSync(sharedPath) && realpathSync(piPath) !== realpathSync(sharedPath);
  });
  const shared = [...new Set([...names, ...duplicated])].map((name) => `-${join(homedir(), ".agents", "skills", name, "SKILL.md")}`);

  // Exclude shadowed upstream copies for local overrides so Pi loads local version without collision warnings
  const overrides = [];
  const overrideSkills = new Set([
    ...(manifest.skillPolicy?.shadowedOverrides ?? []),
    ...(components?.skills
      ? Object.entries(components.skills).filter(([_, s]) => s.type === "override").map(([k]) => k)
      : []),
  ]);
  for (const name of overrideSkills) {
    const upstreamPath = join(homedir(), ".agents", "skills", name, "SKILL.md");
    overrides.push(`-${upstreamPath}`);
  }

  return [...new Set([...local, ...shared, ...overrides])].map(normalizePath);
}

async function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(path)));
    else result.push(path);
  }
  return result;
}

async function managedResourceMap() {
  const map = new Map();
  const add = async (source, targetRoot) => {
    if (!existsSync(source)) return;
    const sourceStat = await stat(source);
    if (sourceStat.isFile()) {
      map.set(targetRoot, source);
      return;
    }
    for (const file of await walkFiles(source)) {
      map.set(join(targetRoot, relative(source, file)), file);
    }
  };
  await add(join(root, "global", "AGENTS.md"), "AGENTS.md");
  await add(join(root, "global", "sol-pi.json"), "sol-pi.json");
  await add(join(root, "docs", "sol-pi.md"), "docs/sol-pi.md");
  await add(join(root, "manifest.json"), "manifest.json");
  await add(join(root, "global", "agents"), "agents");
  await add(join(root, "global", "prompts"), "prompts");
  await add(join(root, "global", "extensions"), "extensions");
  await add(join(root, "scripts"), "scripts");
  await add(join(root, "skills"), "skills");
  return map;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

async function settingsState(manifest, sourceSettings, previousState, components = null) {
  const settingsPath = join(agentDir, "settings.json");
  const live = await readJson(settingsPath, {});
  const managedPackages = packageSources(manifest);
  const previousPackages = new Set(previousState.packages ?? []);
  const currentManagedPatterns = skillPatterns(manifest, components);
  const previousPatterns = new Set(previousState.skillPatterns ?? []);
  const existingPackages = Array.isArray(live.packages) ? live.packages : [];
  const unmanagedPackages = existingPackages.filter((pkg) => {
    const source = typeof pkg === "string" ? pkg : pkg?.source;
    return source && !previousPackages.has(source) && !managedPackages.includes(source);
  });
  const existingSkills = Array.isArray(live.skills) ? live.skills : [];
  const unmanagedSkills = existingSkills.filter((pattern) =>
    !previousPatterns.has(pattern) && !currentManagedPatterns.includes(pattern),
  );
  const next = {
    ...live,
    ...sourceSettings,
    packages: [...unmanagedPackages, ...packageDeclarations(manifest)],
    skills: [...unmanagedSkills, ...currentManagedPatterns],
  };
  return { settingsPath, live, next, managedPackages, currentManagedPatterns };
}

async function linkedParents(targetDir) {
  // Upstream skills land in ~/.agents/skills/ and are linked into ~/.pi/agent/skills/.
  const relativeDir = relative(agentDir, targetDir);
  if (relativeDir.startsWith("..") || isAbsolute(relativeDir)) return [];
  const parts = relativeDir.split(sep).filter(Boolean);
  let current = agentDir;
  const links = [];
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) links.push(current);
  }
  return links;
}

function isUpstreamSkillLink(link) {
  const parts = relative(agentDir, link).split(sep);
  if (parts.length !== 2 || parts[0] !== "skills") return false;
  const upstream = join(homedir(), ".agents", "skills", parts[1]);
  try { return existsSync(upstream) && realpathSync(link) === realpathSync(upstream); }
  catch { return false; }
}

async function materializePath(targetDir, dryRun, seen = new Set()) {
  // Swap each link for a real directory. fs.cp would follow a symlinked parent and
  // rewrite the upstream install in place, so a local override has to stand alone.
  // The upstream copy is left intact; skillPolicy exclusions keep Pi off both.
  for (const link of await linkedParents(targetDir)) {
    if (seen.has(link)) continue;
    seen.add(link);
    if (!isUpstreamSkillLink(link)) {
      throw new Error(`Refusing to replace an unmanaged symlink: ${link}`);
    }
    const resolved = realpathSync(link);
    if (dryRun) {
      console.log(`REPLACE SYMLINK ${link} -> ${resolved}`);
      continue;
    }
    const staging = await mkdtemp(join(dirname(link), ".perfect-pi-materialize-"));
    try {
      await cp(resolved, staging, { recursive: true, force: true });
      await unlink(link);
      await rename(staging, link);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    console.log(`REPLACE SYMLINK ${link} -> ${resolved}`);
  }
}

async function copyResources(resourceMap, dryRun, seen = new Set()) {
  for (const [targetRelative, source] of resourceMap) {
    const target = join(agentDir, targetRelative);
    if (dryRun) {
      console.log(`COPY ${source} -> ${target}`);
      continue;
    }
    await materializePath(dirname(target), false, seen);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
}

function packageSpec(source) {
  if (!source.startsWith("npm:")) return { name: undefined, version: undefined };
  const spec = source.slice(4);
  const match = spec.startsWith("@")
    ? spec.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/)
    : spec.match(/^([^@]+)(?:@(.+))?$/);
  return { name: match?.[1], version: match?.[2] };
}

function packageDirectory(source) {
  const { name } = packageSpec(source);
  return name ? join(agentDir, "npm", "node_modules", name) : undefined;
}

export async function installedPackageMatches(source) {
  if (source.startsWith("git:")) {
    const ref = source.match(/@([a-f0-9]{40})$/)?.[1];
    if (!ref) throw new Error(`Managed Git packages require a full commit pin: ${source}`);
    const runtime = await detectPiRuntime();
    if (!runtime) return false;
    const { DefaultPackageManager, SettingsManager } = await import(join(runtime.root, piRuntimePackage, "dist", "index.js"));
    const manager = new DefaultPackageManager({ cwd: root, agentDir, settingsManager: SettingsManager.inMemory() });
    const directory = manager.getInstalledPath(source, "user");
    if (!directory || !existsSync(join(directory, "package.json"))) return false;
    try {
      return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() === ref;
    } catch { return false; }
  }
  const directory = packageDirectory(source);
  if (!directory || !existsSync(directory)) return false;
  const { version } = packageSpec(source);
  if (!version) return true;
  const installed = await readJson(join(directory, "package.json"), {});
  return installed.version === version;
}

async function installMissingPackages(packages, { dryRun, skipInstall }) {
  const { spawnSync } = await import("node:child_process");
  for (const source of packages) {
    if (await installedPackageMatches(source)) continue;
    if (skipInstall) {
      console.log(`PACKAGE MISSING ${source}`);
      continue;
    }
    if (dryRun) {
      console.log(`INSTALL ${source}`);
      continue;
    }
    const result = spawnSync("pi", ["install", source], {
      encoding: "utf8",
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(`pi install ${source} failed with status ${result.status}`);
    }
  }
}

async function installMissingSkills(skillSources, { dryRun, skipInstall, previousSkillRefs, installer }) {
  const { spawnSync } = await import("node:child_process");
  const installedRefs = { ...previousSkillRefs };
  for (const entry of skillSources.filter((skill) => !skill.source.startsWith("local:"))) {
    const names = entry.selection === "all" ? entry.requiredSkills ?? [] : entry.selection;
    const missing = names.filter((name) => !hasSkill(name));
    const hasPrevious = Boolean(previousSkillRefs && entry.source in previousSkillRefs);
    const isSourceUpdate = Boolean(hasPrevious && entry.ref && previousSkillRefs[entry.source] !== entry.ref);
    const isMissingPin = Boolean(entry.ref && !hasPrevious);
    const sourceChanged = isSourceUpdate || isMissingPin;
    const targets = sourceChanged ? names : missing;
    if (targets.length === 0) continue;
    const selection = entry.selection === "all" ? ["*"] : targets;
    if (skipInstall) {
      console.log(`SKILLS ${isSourceUpdate ? "SOURCE UPDATE REQUIRED" : "MISSING"} ${entry.source}: ${targets.join(", ")}`);
      continue;
    }
    if (dryRun) {
      console.log(`INSTALL/UPDATE SKILLS ${entry.source}@${entry.ref ?? "latest"}: ${selection.join(", ")}`);
      continue;
    }
    const sourceRef = `${entry.source}${entry.ref ? `@${entry.ref}` : ""}`;
    const result = spawnSync("npx", ["--yes", installer, "add", sourceRef, "--global", "--agent", "pi", "--skill", ...selection, "-y"], {
      encoding: "utf8",
      env: { ...process.env, HOME: homedir(), PI_CODING_AGENT_DIR: agentDir },
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(`Could not install skills from ${entry.source}; exit status ${result.status}`);
    }
    if (entry.ref) installedRefs[entry.source] = entry.ref;
  }
  return installedRefs;
}

async function sync({ dryRun = false, skipPackageInstall = false, skipSkillInstall = false, adoptOverrides = false } = {}) {
  const manifest = await readJson(manifestPath);
  const components = await readJson(componentsPath, {});
  const sourceSettings = manifest.managedSettings ?? {};
  const resourceMap = await managedResourceMap();
  const previousState = await readJson(statePath, {});
  const previousResources = new Set(previousState.resources ?? []);
  const seenMaterialized = new Set();
  if (dryRun) {
    for (const [targetRelative] of resourceMap) {
      await materializePath(dirname(join(agentDir, targetRelative)), true, seenMaterialized);
    }
  }
  const unclaimed = [];
  for (const [targetRelative, source] of resourceMap) {
    const target = join(agentDir, targetRelative);
    if (!existsSync(target) || previousResources.has(targetRelative)) continue;
    // Only installer-owned upstream links can be replaced without treating the
    // linked file as an unclaimed user edit.
    const links = await linkedParents(dirname(target));
    const unmanagedLink = links.find((link) => !isUpstreamSkillLink(link));
    if (unmanagedLink) throw new Error(`Refusing to replace an unmanaged symlink: ${unmanagedLink}`);
    if (links.length > 0) continue;
    const [sourceContent, targetContent] = await Promise.all([readFile(source, "utf8"), readFile(target, "utf8")]);
    if (sourceContent !== targetContent) unclaimed.push(targetRelative);
  }
  const adoptable = (target) => {
    const parts = target.split(sep);
    if (!adoptOverrides) return false;
    if (parts[0] === "skills" && components.skills?.[parts[1]]?.type === "override") return true;
    if (parts[0] === "agents" && components.agents?.[parts[1]?.replace(/\.md$/, "")]?.type === "custom") return true;
    return false;
  };
  const refused = unclaimed.filter((target) => !adoptable(target));
  if (refused.length > 0) {
    throw new Error(`Refusing to overwrite Pi resources that differ from the repo and are not registered as managed:\n${refused.map((item) => `- ${item}`).join("\n")}\nFor an intentional skill migration, --adopt-overrides backs up only registered override files before claiming them.`);
  }
  if (unclaimed.length) {
    const backupRoot = join(agentDir, ".perfect-pi-backups", `${Date.now()}-${process.pid}`);
    for (const target of unclaimed) {
      const backup = join(backupRoot, target);
      console.log(`BACKUP OVERRIDE ${target} -> ${backup}`);
      if (!dryRun) {
        await mkdir(dirname(backup), { recursive: true });
        await cp(join(agentDir, target), backup);
      }
    }
  }
  let settings = await settingsState(manifest, sourceSettings, previousState, components);
  const nextResources = [...resourceMap.keys()].sort();
  if (!dryRun) await mkdir(agentDir, { recursive: true });
  for (const oldResource of previousResources) {
    if (resourceMap.has(oldResource)) continue;
    const target = join(agentDir, oldResource);
    if (dryRun) console.log(`REMOVE MANAGED ${target}`);
    else await rm(target, { recursive: true, force: true });
  }
  const installedSkillRefs = await installMissingSkills(manifest.skills ?? [], {
    dryRun,
    skipInstall: skipSkillInstall,
    previousSkillRefs: previousState.skillRefs ?? {},
    installer: manifest.skillInstaller ?? "skills@1.7.0",
  });
  await copyResources(resourceMap, dryRun);
  // Discovery depends on the resulting layout; include any physical duplicates
  // introduced by the installer or by materializing an override.
  settings = await settingsState(manifest, sourceSettings, previousState, components);
  await installMissingPackages(settings.managedPackages, { dryRun, skipInstall: skipPackageInstall });
  const manifestSources = new Set((manifest.skills ?? []).map((s) => s.source));
  const activeSkillRefs = Object.fromEntries(
    Object.entries(installedSkillRefs).filter(([source]) => manifestSources.has(source))
  );
  if (!dryRun) {
    await writeFile(settings.settingsPath, `${JSON.stringify(settings.next, null, 2)}\n`);
    await writeFile(statePath, `${JSON.stringify({
      schemaVersion: 1,
      packages: settings.managedPackages,
      skillPatterns: settings.currentManagedPatterns,
      skillRefs: activeSkillRefs,
      resources: nextResources,
    }, null, 2)}\n`);
  } else {
    console.log(`SETTINGS ${settings.settingsPath}`);
    console.log(JSON.stringify(settings.next, null, 2));
  }
  return { manifest, resourceMap, settings, skippedPackageInstall: skipPackageInstall };
}

/**
 * Resolve the manifest reference for a given upstream source name.
 * Checks manifest.skills, manifest.solPi, and manifest.packages.
 * Shared by reconcile.mjs and skill-audit.mjs to avoid duplicated logic.
 */
export function resolveManifestRef(manifest, sourceName) {
  let ref = (manifest.skills || []).find((s) => s.source === sourceName)?.ref || null;
  if (!ref && manifest.solPi && (sourceName === "NVlabs/SoL-Pi" || sourceName === "SoL-Pi")) {
    ref = manifest.solPi.pinnedRef || (manifest.solPi.source?.split("@")[1] || null);
  }
  if (!ref && manifest.packages) {
    for (const pkg of manifest.packages) {
      const src = typeof pkg === "string" ? pkg : pkg.source;
      if (src && (src.includes(sourceName) || (sourceName.includes("/") && src.includes(sourceName.split("/")[1]))) && src.includes("@")) {
        ref = src.split("@").pop();
        break;
      }
    }
  }
  return ref;
}

export async function inspect() {
  const manifest = await readJson(manifestPath);
  const components = await readJson(componentsPath, {});
  const resourceMap = await managedResourceMap();
  const liveSettingsPath = join(agentDir, "settings.json");
  const liveSettings = await readJson(liveSettingsPath, {});
  const desiredPackages = packageSources(manifest);
  const livePackages = (liveSettings.packages ?? []).map((pkg) => typeof pkg === "string" ? pkg : pkg?.source).filter(Boolean);
  const desiredPatterns = skillPatterns(manifest, components);
  const previousState = await readJson(statePath, {});
  const previousPackages = new Set(previousState.packages ?? []);
  const previousPatterns = new Set(previousState.skillPatterns ?? []);
  const livePatterns = liveSettings.skills ?? [];
  const statuses = {};
  const same = isDeepStrictEqual;
  const mark = (name, status, detail = "") => { statuses[name] = { status, detail }; };

  if (!existsSync(join(agentDir, "AGENTS.md"))) mark("AGENTS.md", "MISSING");
  else mark("AGENTS.md", (await readFile(join(agentDir, "AGENTS.md",), "utf8")) === await readFile(join(root, "global", "AGENTS.md"), "utf8") ? "SYNCED" : "DRIFTED");

  // manifest.piVersion is the contract with the host runtime; without it there is nothing to check.
  if (manifest.piVersion) {
    const runtime = await detectPiRuntime();
    mark("pi runtime", !runtime ? "MISSING" : runtime.version === manifest.piVersion ? "SYNCED" : "DRIFTED",
      runtime ? `${runtime.version} installed; manifest pins ${manifest.piVersion}` : `manifest pins ${manifest.piVersion}; no ${piRuntimePackage} found in ${piRuntimeRoots().join(", ")}`);
  }

  const managedSettings = manifest.managedSettings ?? {};
  const liveManagedSettings = Object.fromEntries(Object.keys(managedSettings).map((key) => [key, liveSettings[key]]));
  mark("settings", same(liveManagedSettings, managedSettings) ? "SYNCED" : "DRIFTED", "managed fields only");
  const packageStatus = await Promise.all(desiredPackages.map(async (source) => ({
    source,
    installed: await installedPackageMatches(source),
  })));
  const missingPackages = packageStatus.filter(({ installed }) => !installed).map(({ source }) => source);
  const observedManagedPackages = livePackages.filter((pkg) => desiredPackages.includes(pkg));
  const staleManagedPackages = livePackages.filter((pkg) => previousPackages.has(pkg) && !desiredPackages.includes(pkg));
  const packagesMatch = desiredPackages.every((pkg, index) => observedManagedPackages[index] === pkg)
    && packageDeclarations(manifest).every((expected) => liveSettings.packages?.some((actual) => same(actual, expected)));
  mark("packages", packagesMatch && staleManagedPackages.length === 0 && missingPackages.length === 0 ? "SYNCED" : missingPackages.length > 0 ? "MISSING" : "DRIFTED", `${observedManagedPackages.length} live / ${desiredPackages.length} configured; ${missingPackages.length} missing on disk; ${staleManagedPackages.length} stale managed`);
  const stalePatterns = livePatterns.filter((pattern) => previousPatterns.has(pattern) && !desiredPatterns.includes(pattern));
  const patternsMatch = desiredPatterns.every((pattern) => livePatterns.includes(pattern)) && stalePatterns.length === 0;
  mark("skills policy", patternsMatch ? "SYNCED" : "DRIFTED", `${desiredPatterns.length} managed exclusions; ${stalePatterns.length} stale managed`);

  for (const kind of ["agents", "prompts", "extensions"]) {
    const entries = [...resourceMap.entries()].filter(([target]) => target.startsWith(`${kind}/`));
    let status = "SYNCED";
    for (const [targetRelative, source] of entries) {
      const target = join(agentDir, targetRelative);
      if (!existsSync(target)) { status = "MISSING"; break; }
      const [expected, actual] = await Promise.all([readFile(source, "utf8"), readFile(target, "utf8")]);
      if (expected !== actual) { status = "DRIFTED"; break; }
    }
    mark(kind, status, `${entries.length} managed files`);
  }

  const localSkillEntries = [...resourceMap.entries()].filter(([target]) => target.startsWith("skills/"));
  let localSkillStatus = "SYNCED";
  for (const [targetRelative, source] of localSkillEntries) {
    const target = join(agentDir, targetRelative);
    if (!existsSync(target)) { localSkillStatus = "MISSING"; break; }
    const [expected, actual] = await Promise.all([readFile(source, "utf8"), readFile(target, "utf8")]);
    if (expected !== actual) { localSkillStatus = "DRIFTED"; break; }
  }
  mark("local skills", localSkillStatus, `${localSkillEntries.length} managed files`);
  const expectedRefs = Object.fromEntries((manifest.skills ?? []).filter((skill) => skill.ref).map((skill) => [skill.source, skill.ref]));
  const installedRefs = previousState.skillRefs ?? {};
  const refsMatch = Object.entries(expectedRefs).every(([source, ref]) => installedRefs[source] === ref);
  mark("skill source pins", refsMatch ? "SYNCED" : "DRIFTED", `${Object.keys(expectedRefs).length} pinned upstream sources`);
  const expectedSkills = expectedSkillNames(manifest);
  const missingSkills = expectedSkills.filter((name) => !hasSkill(name));
  mark("skills", missingSkills.length === 0 ? "SYNCED" : "MISSING", `${expectedSkills.length - missingSkills.length}/${expectedSkills.length} required upstream/local skills present${missingSkills.length ? `; missing ${missingSkills.join(", ")}` : ""}`);

  for (const oldResource of previousState.resources ?? []) {
    if (!resourceMap.has(oldResource) && existsSync(join(agentDir, oldResource))) {
      mark("resource cleanup", "DRIFTED", `${oldResource} is a stale managed resource`);
    }
  }
  mark("resource ownership", existsSync(statePath) ? "SYNCED" : "MISSING", "managed resource registry");
  const themePath = join(agentDir, "npm", "node_modules", "pi-cc-extensions", "themes", "cc-dark.json");
  mark("themes", existsSync(themePath) ? "SYNCED" : "MISSING", "provided by pi-cc-extensions");
  const browserPath = process.env.PATH?.split(process.platform === "win32" ? ";" : ":")
    .map((entry) => join(entry, process.platform === "win32" ? "agent-browser.exe" : "agent-browser"))
    .find((path) => existsSync(path));
  mark("browser runtime", browserPath ? "SYNCED" : "MISSING", browserPath ?? "Install upstream agent-browser and expose it on PATH");
  if (resourceMap.has("sol-pi.json")) {
    const target = join(agentDir, "sol-pi.json");
    const synced = existsSync(target) && await readFile(target, "utf8") === await readFile(resourceMap.get("sol-pi.json"), "utf8");
    const config = await readJson(target, null).catch(() => null);
    const projectConfig = join(process.cwd(), ".pi", "sol-pi.json");
    mark("SoL-Pi config", !existsSync(target) ? "MISSING" : synced ? "SYNCED" : "DRIFTED",
      config ? `${target}; fusion=${config.actionFusion}; observations=${config.observationPack}; reducer=${config.evidencePreservingReducer}; compact=${config.onlineContextCompact}${existsSync(projectConfig) ? `; trusted project may override via ${projectConfig}` : ""}` : "invalid or missing JSON");
  }

  let solPiReport = null;
  const solPiPkg = (manifest.packages ?? []).find((p) => {
    const s = typeof p === "string" ? p : p?.source;
    return s && s.includes("SoL-Pi");
  });
  if (solPiPkg || manifest.solPi) {
    const source = manifest.solPi?.source || (typeof solPiPkg === "string" ? solPiPkg : solPiPkg?.source);
    const pinnedRef = manifest.solPi?.pinnedRef || source?.match(/@([a-f0-9]{40})$/)?.[1] || "e1a586af0ad8956f42ae5b26bba20e48fbf30e00";
    const installed = await installedPackageMatches(source);
    const livePkg = liveSettings.packages?.find((p) => (typeof p === "string" ? p : p?.source) === source);
    const upstreamEntryDisabled = Boolean(livePkg && typeof livePkg === "object" && Array.isArray(livePkg.extensions) && livePkg.extensions.length === 0);
    const adapterPath = join(agentDir, "extensions", "sol-pi.ts");
    const adapterLoaded = existsSync(adapterPath);
    const configPath = join(agentDir, "sol-pi.json");
    const parsedConfig = existsSync(configPath) ? await readJson(configPath, null).catch(() => null) : null;
    const policy = manifest.solPi?.reducerPolicy ?? { provider: "cpa", model: "gemini-3.8-flash-high", maxRequestsPerSession: 20 };
    const authorizedRoute = `${policy.provider}/${policy.model}`;
    const configuredRoute = parsedConfig ? `${parsedConfig.evidencePreservingReducerProvider}/${parsedConfig.evidencePreservingReducerModel}` : null;
    const reducerAuthorized = parsedConfig?.evidencePreservingReducer ? (configuredRoute === authorizedRoute) : true;

    const modelsPath = join(agentDir, "models.json");
    const modelsJson = existsSync(modelsPath) ? await readJson(modelsPath, null).catch(() => null) : null;
    const enabledModels = Array.isArray(liveSettings.enabledModels) ? liveSettings.enabledModels : [];
    const modelConfigured = Boolean(
      (modelsJson?.providers?.[policy.provider]?.models?.some((m) => m.id === policy.model)) ||
      enabledModels.includes(authorizedRoute)
    );

    let contractVerified = false;
    try {
      const { checkSolPiContract } = await import("./scripts/check-sol-pi-contract.mjs");
      const contract = await checkSolPiContract({ root, agentDir });
      contractVerified = contract.ok;
    } catch {}

    solPiReport = {
      "source pin": installed ? `OK (${pinnedRef.slice(0, 12)})` : `DRIFTED (expected ${pinnedRef.slice(0, 12)})`,
      "package installed": installed ? "OK" : "MISSING",
      "upstream entry disabled": upstreamEntryDisabled ? "OK (extensions: [])" : "DRIFTED",
      "adapter loaded": adapterLoaded ? "OK" : "MISSING",
      "config parsed": parsedConfig ? "OK" : "MISSING",
      "action fusion": parsedConfig?.actionFusion ? "ENABLED" : "DISABLED",
      "observation pack": parsedConfig?.observationPack ? "ENABLED" : "DISABLED",
      "reducer route": reducerAuthorized ? `AUTHORIZED (${authorizedRoute}, max ${policy.maxRequestsPerSession}/session)` : `UNAUTHORIZED (${configuredRoute})`,
      "reducer model": modelConfigured ? "AVAILABLE" : "UNCONFIGURED",
      "online compact": parsedConfig?.onlineContextCompact ? "ENABLED" : "DISABLED",
      "Pi compatibility": contractVerified ? "VERIFIED" : "DRIFTED",
    };
  }

  const ok = Object.values(statuses).every(({ status }) => status === "SYNCED");
  return { ok, agentDir, source: root, statuses, liveSettings, desiredPackages, desiredPatterns, solPi: solPiReport };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--check")) {
    const report = await inspect();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  const result = await sync({
    dryRun: args.has("--dry-run"),
    skipPackageInstall: args.has("--skip-package-install"),
    skipSkillInstall: args.has("--skip-skill-install"),
    adoptOverrides: args.has("--adopt-overrides"),
  });
  const piStatus = (await inspect()).statuses["pi runtime"];
  if (piStatus && piStatus.status !== "SYNCED") console.log(`PI RUNTIME ${piStatus.status}: ${piStatus.detail}`);
  if (!args.has("--dry-run")) {
    console.log(`Perfect Pi synced to ${agentDir}. Restart Pi or run /reload.`);
    console.log(`Managed packages: ${result.settings.next.packages.length}`);
  } else {
    console.log("Dry run complete.");
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
