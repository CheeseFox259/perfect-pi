import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    || existsSync(join(homedir(), ".agents", "skills", name, "SKILL.md"));
}

function skillPatterns(manifest, components = null) {
  const names = manifest.skillPolicy?.excludeFromPi ?? [];
  const local = names.map((name) => `-skills/${name}/SKILL.md`);
  const shared = names
    .filter((name) => existsSync(join(homedir(), ".agents", "skills", name, "SKILL.md")))
    .map((name) => `-${join(homedir(), ".agents", "skills", name, "SKILL.md")}`);

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
    if (existsSync(upstreamPath)) {
      overrides.push(`-${upstreamPath}`);
    }
  }

  return [...new Set([...local, ...shared, ...overrides])].map(normalizePath);
}

async function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
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
  await add(join(root, "global", "prompts"), "prompts");
  await add(join(root, "global", "extensions"), "extensions");
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
    packages: [...unmanagedPackages, ...managedPackages],
    skills: [...unmanagedSkills, ...currentManagedPatterns],
  };
  return { settingsPath, live, next, managedPackages, currentManagedPatterns };
}

async function copyResources(resourceMap, dryRun) {
  for (const [targetRelative, source] of resourceMap) {
    const target = join(agentDir, targetRelative);
    if (dryRun) {
      console.log(`COPY ${source} -> ${target}`);
      continue;
    }
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

async function installedPackageMatches(source) {
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
  for (const entry of skillSources.filter((skill) => !skill.source.startsWith("local:"))) {
    const names = entry.selection === "all" ? entry.requiredSkills ?? [] : entry.selection;
    const missing = names.filter((name) => !existsSync(join(homedir(), ".agents", "skills", name, "SKILL.md")));
    const sourceChanged = Boolean(entry.ref && previousSkillRefs?.[entry.source] !== entry.ref);
    const targets = sourceChanged ? names : missing;
    if (targets.length === 0) continue;
    const selection = entry.selection === "all" ? ["*"] : targets;
    if (skipInstall) {
      console.log(`SKILLS ${sourceChanged ? "SOURCE UPDATE REQUIRED" : "MISSING"} ${entry.source}: ${targets.join(", ")}`);
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
  }
}

async function sync({ dryRun = false, skipPackageInstall = false, skipSkillInstall = false } = {}) {
  const manifest = await readJson(manifestPath);
  const components = await readJson(componentsPath, {});
  const sourceSettings = manifest.managedSettings ?? {};
  const resourceMap = await managedResourceMap();
  const previousState = await readJson(statePath, {});
  const previousResources = new Set(previousState.resources ?? []);
  const unclaimed = [];
  for (const [targetRelative, source] of resourceMap) {
    const target = join(agentDir, targetRelative);
    if (!existsSync(target) || previousResources.has(targetRelative)) continue;
    const [sourceContent, targetContent] = await Promise.all([readFile(source, "utf8"), readFile(target, "utf8")]);
    if (sourceContent !== targetContent) unclaimed.push(targetRelative);
  }
  if (unclaimed.length > 0) {
    throw new Error(`Refusing to overwrite Pi resources that differ from the repo and are not registered as managed:\n${unclaimed.map((item) => `- ${item}`).join("\n")}`);
  }
  const settings = await settingsState(manifest, sourceSettings, previousState, components);
  const nextResources = [...resourceMap.keys()].sort();
  if (!dryRun) await mkdir(agentDir, { recursive: true });
  for (const oldResource of previousResources) {
    if (resourceMap.has(oldResource)) continue;
    const target = join(agentDir, oldResource);
    if (dryRun) console.log(`REMOVE MANAGED ${target}`);
    else await rm(target, { recursive: true, force: true });
  }
  await copyResources(resourceMap, dryRun);
  await installMissingSkills(manifest.skills ?? [], {
    dryRun,
    skipInstall: skipSkillInstall,
    previousSkillRefs: previousState.skillRefs ?? {},
    installer: manifest.skillInstaller ?? "skills@1.7.0",
  });
  await installMissingPackages(settings.managedPackages, { dryRun, skipInstall: skipPackageInstall });
  if (!dryRun) {
    await writeFile(settings.settingsPath, `${JSON.stringify(settings.next, null, 2)}\n`);
    await writeFile(statePath, `${JSON.stringify({
      schemaVersion: 1,
      packages: settings.managedPackages,
      skillPatterns: settings.currentManagedPatterns,
      skillRefs: Object.fromEntries((manifest.skills ?? []).filter((skill) => skill.ref).map((skill) => [skill.source, skill.ref])),
      resources: nextResources,
    }, null, 2)}\n`);
  } else {
    console.log(`SETTINGS ${settings.settingsPath}`);
    console.log(JSON.stringify(settings.next, null, 2));
  }
  return { manifest, resourceMap, settings, skippedPackageInstall: skipPackageInstall };
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
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const mark = (name, status, detail = "") => { statuses[name] = { status, detail }; };

  if (!existsSync(join(agentDir, "AGENTS.md"))) mark("AGENTS.md", "MISSING");
  else mark("AGENTS.md", (await readFile(join(agentDir, "AGENTS.md",), "utf8")) === await readFile(join(root, "global", "AGENTS.md"), "utf8") ? "SYNCED" : "DRIFTED");

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
  const packagesMatch = desiredPackages.every((pkg, index) => observedManagedPackages[index] === pkg);
  mark("packages", packagesMatch && staleManagedPackages.length === 0 && missingPackages.length === 0 ? "SYNCED" : missingPackages.length > 0 ? "MISSING" : "DRIFTED", `${observedManagedPackages.length} live / ${desiredPackages.length} configured; ${missingPackages.length} missing on disk; ${staleManagedPackages.length} stale managed`);
  const stalePatterns = livePatterns.filter((pattern) => previousPatterns.has(pattern) && !desiredPatterns.includes(pattern));
  const patternsMatch = desiredPatterns.every((pattern) => livePatterns.includes(pattern)) && stalePatterns.length === 0;
  mark("skills policy", patternsMatch ? "SYNCED" : "DRIFTED", `${desiredPatterns.length} managed exclusions; ${stalePatterns.length} stale managed`);

  for (const kind of ["prompts", "extensions"]) {
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
  const ok = Object.values(statuses).every(({ status }) => status === "SYNCED");
  return { ok, agentDir, source: root, statuses, liveSettings, desiredPackages, desiredPatterns };
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
  });
  if (!args.has("--dry-run")) {
    console.log(`Perfect Pi synced to ${agentDir}. Restart Pi or run /reload.`);
    console.log(`Managed packages: ${result.settings.next.packages.length}`);
  } else {
    console.log("Dry run complete.");
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
