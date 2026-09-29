#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const defaultRoot = dirname(fileURLToPath(import.meta.url));

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

export async function loadConfig(options = {}) {
  const projectRoot = options.root ? resolve(options.root) : defaultRoot;
  const componentsPath = options.componentsPath || join(projectRoot, "components.json");
  const manifestPath = options.manifestPath || join(projectRoot, "manifest.json");

  const components = options.components || (await readJson(componentsPath));
  const manifest = options.manifest || (await readJson(manifestPath));

  return { projectRoot, components, manifest, componentsPath, manifestPath };
}

export function getSkillUpstreamInfo(components, skillName) {
  const skill = components?.skills?.[skillName];
  if (!skill) {
    throw new Error(`Skill '${skillName}' is not registered in components.json.`);
  }
  if (skill.type !== "override") {
    throw new Error(`Skill '${skillName}' is not an override skill (type: ${skill.type}).`);
  }

  const upstreamKey = skill.upstream;
  const upstreamConfig = components?.upstreams?.[upstreamKey];
  const repoUrl = skill.upstreamRepo || upstreamConfig?.repo;
  if (!repoUrl) {
    throw new Error(`No upstream repo configured for skill '${skillName}' (upstream: '${upstreamKey}').`);
  }

  const baseRef = skill.baseRef || upstreamConfig?.pinnedRef;
  if (!baseRef) {
    throw new Error(`No baseRef configured for skill '${skillName}'.`);
  }

  const upstreamRelPath = skill.upstreamRelPath || skill.localPath;
  if (!upstreamRelPath) {
    throw new Error(`No upstreamRelPath configured for skill '${skillName}'.`);
  }

  if (!skill.localPath) {
    throw new Error(`No localPath configured for skill '${skillName}'.`);
  }

  return {
    skill,
    upstream: upstreamKey,
    repoUrl,
    baseRef,
    upstreamRelPath,
    localPath: skill.localPath,
    preservedFeatures: skill.preservedFeatures || [],
    description: skill.description || "",
  };
}

export function getRemoteHead(repoUrl, timeoutMs = 8000, options = {}) {
  if (options.offline || options.skipNetwork) {
    return null;
  }

  const localGitDir = options.gitDir || (options.repos && options.repos[repoUrl]);
  if (localGitDir && existsSync(localGitDir)) {
    try {
      return execFileSync("git", ["-C", localGitDir, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // fall through
    }
  }

  let localCandidate = repoUrl;
  if (repoUrl.startsWith("file://")) {
    try {
      localCandidate = fileURLToPath(repoUrl);
    } catch {
      localCandidate = repoUrl.slice("file://".length);
    }
  }

  if (existsSync(localCandidate)) {
    try {
      return execFileSync("git", ["-C", localCandidate, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // fall through
    }
  }

  try {
    const output = execFileSync("git", ["ls-remote", repoUrl, "HEAD"], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = output.match(/^([a-f0-9]{40})\s+HEAD/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function resolveRepoGitDir(repoUrl, options = {}) {
  if (options.repos && options.repos[repoUrl]) {
    return options.repos[repoUrl];
  }
  if (typeof options.repoResolver === "function") {
    const resolved = await options.repoResolver(repoUrl, options);
    if (resolved) return resolved;
  }

  let localCandidate = repoUrl;
  if (repoUrl.startsWith("file://")) {
    try {
      localCandidate = fileURLToPath(repoUrl);
    } catch {
      localCandidate = repoUrl.slice("file://".length);
    }
  }

  if (existsSync(localCandidate)) {
    try {
      execFileSync("git", ["-C", localCandidate, "rev-parse", "--git-dir"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return localCandidate;
    } catch {
      // not a git repo
    }
  }

  const cacheDir = options.cacheDir || process.env.PERFECT_PI_CACHE_DIR || join(homedir(), ".cache", "perfect-pi", "upstreams");
  const repoKey = repoUrl.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const targetDir = join(cacheDir, repoKey);

  let isRepo = false;
  if (existsSync(targetDir)) {
    try {
      execFileSync("git", ["-C", targetDir, "rev-parse", "--git-dir"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      isRepo = true;
    } catch {
      isRepo = false;
    }
  }

  if (isRepo) {
    return targetDir;
  }

  if (options.offline || options.skipNetwork) {
    throw new Error(`Cannot access upstream repository '${repoUrl}' in offline mode (cache missing: ${targetDir})`);
  }

  mkdirSync(cacheDir, { recursive: true });
  try {
    execFileSync("git", ["clone", "--bare", repoUrl, targetDir], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 30000,
    });
  } catch (err) {
    throw new Error(`Failed to clone upstream repository '${repoUrl}': ${err.message}`);
  }

  return targetDir;
}

export function getFileAtRef(gitDir, ref, relPath, options = {}) {
  if (typeof ref !== "string" || ref.trim().length === 0 || ref.startsWith("-")) {
    throw new Error(`Invalid ref '${ref}'.`);
  }
  if (typeof relPath !== "string" || relPath.trim().length === 0 || relPath.startsWith("-")) {
    throw new Error(`Invalid relPath '${relPath}'.`);
  }

  const cleanRef = ref.trim();
  const cleanPath = relPath.trim();

  try {
    return execFileSync("git", ["-C", gitDir, "show", `${cleanRef}:${cleanPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    if (!options.offline && !options.skipNetwork) {
      try {
        execFileSync("git", ["-C", gitDir, "fetch", "origin", cleanRef], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: options.timeout || 15000,
        });
        return execFileSync("git", ["-C", gitDir, "show", `${cleanRef}:${cleanPath}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 20 * 1024 * 1024,
        });
      } catch {
        // Fetch failed or ref still not found
      }
    }

    let refExists = false;
    try {
      execFileSync("git", ["-C", gitDir, "rev-parse", "--verify", `${cleanRef}^{commit}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      refExists = true;
    } catch {
      try {
        execFileSync("git", ["-C", gitDir, "rev-parse", "--verify", `${cleanRef}^{object}`], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        refExists = true;
      } catch {
        refExists = false;
      }
    }

    if (!refExists) {
      throw new Error(`Upstream ref '${cleanRef}' not found in repository (${gitDir}).`);
    } else {
      throw new Error(`Path '${cleanPath}' not found at ref '${cleanRef}' in repository (${gitDir}).`);
    }
  }
}

export function getDiff(filePathA, filePathB, labelA = "base", labelB = "local") {
  const result = spawnSync("diff", ["-u", "-L", labelA, "-L", labelB, filePathA, filePathB], { encoding: "utf8" });
  if (result.error || ![0, 1].includes(result.status)) {
    throw result.error ?? new Error(`diff failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout || "";
}

export function performThreeWayMerge(localPath, basePath, upstreamPath, options = {}) {
  const result = spawnSync("git", [
    "merge-file",
    "-p",
    "-L", options.labelLocal || "local-enhancement",
    "-L", options.labelBase || "upstream-base",
    "-L", options.labelUpstream || "upstream-latest",
    localPath,
    basePath,
    upstreamPath,
  ], {
    encoding: "utf8",
  });

  const conflictCount = result.status > 0 ? result.status : 0;
  return {
    clean: result.status === 0,
    conflictCount,
    status: result.status,
    mergedContent: result.stdout || "",
    error: result.stderr || (result.error ? String(result.error) : ""),
  };
}

export async function diffSkill(skillName, options = {}) {
  const { projectRoot, components } = await loadConfig(options);
  const skillInfo = getSkillUpstreamInfo(components, skillName);

  const localFile = resolve(projectRoot, skillInfo.localPath);
  if (!existsSync(localFile)) {
    throw new Error(`Local file not found: ${localFile}`);
  }

  const gitDir = await resolveRepoGitDir(skillInfo.repoUrl, options);
  const baseContent = getFileAtRef(gitDir, skillInfo.baseRef, skillInfo.upstreamRelPath, options);

  const tempDir = mkdtempSync(join(tmpdir(), "perfect-pi-diff-"));
  try {
    const tempBasePath = join(tempDir, "upstream-base.md");
    writeFileSync(tempBasePath, baseContent, "utf8");

    const labelBase = `upstream@${skillInfo.baseRef.slice(0, 7)}:${skillInfo.upstreamRelPath}`;
    const labelLocal = `local:${skillInfo.localPath}`;
    const diff = getDiff(tempBasePath, localFile, labelBase, labelLocal);

    return {
      skillName,
      baseRef: skillInfo.baseRef,
      upstreamRelPath: skillInfo.upstreamRelPath,
      localPath: skillInfo.localPath,
      diff,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function threeWayTestSkill(skillName, options = {}) {
  const { projectRoot, components } = await loadConfig(options);
  const skillInfo = getSkillUpstreamInfo(components, skillName);

  const localFile = resolve(projectRoot, skillInfo.localPath);
  if (!existsSync(localFile)) {
    throw new Error(`Local skill file not found: ${localFile}`);
  }
  const localContent = await readFile(localFile, "utf8");

  const gitDir = await resolveRepoGitDir(skillInfo.repoUrl, options);

  const baseContent = getFileAtRef(gitDir, skillInfo.baseRef, skillInfo.upstreamRelPath, options);

  let targetRef = options.upstreamRef;
  if (!targetRef) {
    // Query the source, not HEAD in a potentially stale bare cache.
    targetRef = getRemoteHead(skillInfo.repoUrl, options.timeout || 8000, options);
    if (!targetRef) {
      throw new Error(`Could not determine upstream target ref for repository '${skillInfo.repoUrl}'. Specify --upstream-ref <commit> explicitly.`);
    }
  }

  const upstreamContent = getFileAtRef(gitDir, targetRef, skillInfo.upstreamRelPath, options);

  const tempDir = mkdtempSync(join(tmpdir(), "perfect-pi-3way-"));
  try {
    const tempBasePath = join(tempDir, "base.md");
    const tempUpstreamPath = join(tempDir, "upstream.md");
    const tempLocalCopy = join(tempDir, "local.md");

    writeFileSync(tempBasePath, baseContent, "utf8");
    writeFileSync(tempUpstreamPath, upstreamContent, "utf8");
    writeFileSync(tempLocalCopy, localContent, "utf8");

    const labelBase = `upstream-base@${skillInfo.baseRef.slice(0, 7)}`;
    const labelUpstream = `upstream-target@${targetRef.slice(0, 7)}`;
    const labelLocal = "local-enhancement";

    const mergeResult = performThreeWayMerge(tempLocalCopy, tempBasePath, tempUpstreamPath, {
      labelLocal,
      labelBase,
      labelUpstream,
    });

    if (mergeResult.status === null || mergeResult.status < 0 || mergeResult.status > 127) {
      throw new Error(`git merge-file failed with status ${mergeResult.status}: ${mergeResult.error}`);
    }

    return {
      skillName,
      baseRef: skillInfo.baseRef,
      targetRef,
      clean: mergeResult.clean,
      conflictCount: mergeResult.conflictCount,
      mergedContent: mergeResult.mergedContent,
      error: mergeResult.error,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export const threeWayTest = threeWayTestSkill;

export async function checkStatus(options = {}) {
  const { projectRoot, components, manifest } = await loadConfig(options);

  const upstreamStatuses = {};
  const pinMismatches = [];
  const isOffline = Boolean(options.offline || options.skipNetwork);

  for (const [name, info] of Object.entries(components.upstreams || {})) {
    const pinnedRef = info.pinnedRef;
    const manifestEntry = (manifest.skills || []).find((s) => s.source === name);
    const manifestRef = manifestEntry?.ref || null;
    const pinAligned = Boolean(manifestRef && pinnedRef && manifestRef === pinnedRef);

    if (!pinAligned) {
      pinMismatches.push({
        source: name,
        componentPinnedRef: pinnedRef,
        manifestRef,
      });
    }

    let remoteHead = null;
    let isUpToDate = null;
    let status = "UNKNOWN";

    if (!isOffline) {
      remoteHead = getRemoteHead(info.repo, options.timeout || 8000, options);
      if (remoteHead) {
        isUpToDate = remoteHead === pinnedRef;
        status = isUpToDate ? "UP_TO_DATE" : "UPDATE_AVAILABLE";
      } else {
        status = "UNKNOWN";
      }
    } else {
      status = "UNKNOWN";
    }

    upstreamStatuses[name] = {
      repo: info.repo,
      pinnedRef,
      manifestRef,
      pinAligned,
      remoteHead,
      status,
      description: info.description,
    };
  }

  const overrides = {};
  for (const [skillName, skill] of Object.entries(components.skills || {})) {
    if (skill.type !== "override") continue;

    const localFile = join(projectRoot, skill.localPath);
    const localExists = existsSync(localFile);
    const upstreamInstalledFile = join(homedir(), ".agents", "skills", skillName, "SKILL.md");
    const upstreamExists = existsSync(upstreamInstalledFile);

    const upstreamInfo = upstreamStatuses[skill.upstream];
    const hasUpstreamUpdate = upstreamInfo?.status === "UPDATE_AVAILABLE";

    overrides[skillName] = {
      upstream: skill.upstream,
      baseRef: skill.baseRef,
      upstreamRelPath: skill.upstreamRelPath || skill.localPath,
      localPath: skill.localPath,
      localExists,
      upstreamExists,
      hasUpstreamUpdate,
      preservedFeatures: skill.preservedFeatures || [],
      description: skill.description,
    };
  }

  const customs = {
    skills: Object.entries(components.skills || {})
      .filter(([_, s]) => s.type === "custom")
      .map(([name, s]) => ({ name, path: s.localPath, description: s.description })),
    extensions: Object.entries(components.extensions || {})
      .filter(([_, e]) => e.type === "custom")
      .map(([name, e]) => ({ name, path: e.localPath, description: e.description })),
  };

  return {
    timestamp: new Date().toISOString(),
    upstreams: upstreamStatuses,
    pinAlignment: {
      aligned: pinMismatches.length === 0,
      mismatches: pinMismatches,
    },
    overrides,
    customs,
  };
}

export function createTestGitRepo(repoDir, commits = []) {
  mkdirSync(repoDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "ignore" });
  execFileSync("git", ["-C", repoDir, "config", "user.email", "test@reconcile.local"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoDir, "config", "user.name", "Reconcile Test"], { stdio: "ignore" });

  const commitShas = {};
  for (const commit of commits) {
    if (commit.files) {
      for (const [relPath, content] of Object.entries(commit.files)) {
        const fullPath = join(repoDir, relPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, "utf8");
      }
    }
    execFileSync("git", ["-C", repoDir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", repoDir, "commit", "-m", commit.message || "commit", "--allow-empty"], { stdio: "ignore" });
    const sha = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (commit.name) {
      commitShas[commit.name] = sha;
    }
  }
  return commitShas;
}

export function createReconcileFixture(baseDir, options = {}) {
  const upstreamDir = join(baseDir, "upstream");
  const projectDir = join(baseDir, "project");
  const homeDir = join(baseDir, "home");

  const initialBaseContent = options.baseContent ?? `# Test Skill\n\nFeature A: base\nFeature B: base\n`;
  const upstreamCommits = options.commits ?? [
    {
      name: "base",
      message: "base commit",
      files: {
        "skills/grilling/SKILL.md": initialBaseContent,
      },
    },
  ];

  const commitShas = createTestGitRepo(upstreamDir, upstreamCommits);
  const baseSha = commitShas.base || execFileSync("git", ["-C", upstreamDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  mkdirSync(projectDir, { recursive: true });
  const localContent = options.localContent ?? `# Test Skill\n\nFeature A: local-edit\nFeature B: base\n`;
  const localSkillPath = join(projectDir, "skills", "grilling", "SKILL.md");
  mkdirSync(dirname(localSkillPath), { recursive: true });
  writeFileSync(localSkillPath, localContent, "utf8");

  const components = options.components ?? {
    upstreams: {
      "mattpocock/skills": {
        repo: upstreamDir,
        pinnedRef: baseSha,
        description: "Test upstream",
      },
    },
    skills: {
      grilling: {
        type: "override",
        upstream: "mattpocock/skills",
        baseRef: baseSha,
        localPath: "skills/grilling/SKILL.md",
        upstreamRelPath: "skills/grilling/SKILL.md",
        preservedFeatures: ["Local edits"],
      },
    },
  };

  const manifest = options.manifest ?? {
    skills: [
      {
        source: "mattpocock/skills",
        ref: baseSha,
      },
    ],
  };

  writeFileSync(join(projectDir, "components.json"), JSON.stringify(components, null, 2), "utf8");
  writeFileSync(join(projectDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const installedDir = join(homeDir, ".agents", "skills", "grilling");
  mkdirSync(installedDir, { recursive: true });
  const installedContent = options.installedContent ?? "INSTALLED ~/.agents COPY THAT MUST BE IGNORED\n";
  writeFileSync(join(installedDir, "SKILL.md"), installedContent, "utf8");

  return {
    baseDir,
    upstreamDir,
    projectDir,
    homeDir,
    commitShas,
    baseSha,
  };
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    command: null,
    skill: null,
    upstreamRef: null,
    offline: false,
    json: false,
    root: null,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--offline" || arg === "--skip-network") {
      flags.offline = true;
    } else if (arg === "--upstream-ref") {
      const next = args[++i];
      if (!next || next.startsWith("-")) {
        throw new Error("Missing value for --upstream-ref");
      }
      flags.upstreamRef = next;
    } else if (arg.startsWith("--upstream-ref=")) {
      flags.upstreamRef = arg.slice("--upstream-ref=".length);
    } else if (arg === "--root") {
      const next = args[++i];
      if (!next || next.startsWith("-")) {
        throw new Error("Missing value for --root");
      }
      flags.root = next;
    } else if (arg.startsWith("--root=")) {
      flags.root = arg.slice("--root=".length);
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  const knownCommands = new Set(["status", "check", "diff", "3way-test"]);
  if (positional.length > 0 && knownCommands.has(positional[0])) {
    flags.command = positional[0];
    flags.skill = positional[1] || null;
  } else if (positional.length > 0) {
    flags.command = positional[0];
    flags.skill = positional[1] || null;
  } else {
    flags.command = "status";
  }

  return flags;
}

export async function main(argv = process.argv) {
  const flags = parseArgs(argv);
  const command = flags.command;

  if (command === "status" || command === "check") {
    const status = await checkStatus({
      root: flags.root,
      offline: flags.offline,
    });

    if (flags.json) {
      console.log(JSON.stringify(status, null, 2));
      return 0;
    }

    console.log("=== Perfect Pi Upstream & Overrides Status ===\n");

    console.log("📦 Upstream Repositories:");
    for (const [name, info] of Object.entries(status.upstreams)) {
      const icon = info.status === "UP_TO_DATE" ? "✅" : info.status === "UPDATE_AVAILABLE" ? "🔄" : "❓";
      const alignmentText = info.pinAligned ? "aligned" : "⚠️ PIN MISMATCH";
      console.log(`  ${icon} ${name.padEnd(26)} ${info.status}`);
      console.log(`     Pinned: ${info.pinnedRef?.slice(0, 10)} | Manifest: ${info.manifestRef?.slice(0, 10) || "none"} (${alignmentText}) | Remote: ${info.remoteHead ? info.remoteHead.slice(0, 10) : "N/A"}`);
    }

    if (!status.pinAlignment.aligned) {
      console.log("\n⚠️ Registry Pin Misalignments Detected:");
      for (const m of status.pinAlignment.mismatches) {
        console.log(`  • ${m.source}: components.json pinnedRef (${m.componentPinnedRef?.slice(0, 10)}) !== manifest.json ref (${m.manifestRef?.slice(0, 10)})`);
      }
    }

    console.log("\n🛠️ Local Override Skills (Enhanced from Upstream):");
    for (const [name, info] of Object.entries(status.overrides)) {
      const updateNotice = info.hasUpstreamUpdate ? " (Upstream update pending)" : " (Base aligned)";
      console.log(`  • ${name}${updateNotice}`);
      console.log(`    Base ref : ${info.baseRef?.slice(0, 10)}`);
      console.log(`    Local file: ${info.localPath}`);
      console.log(`    Preserved: ${info.preservedFeatures.join(", ")}`);
    }

    console.log("\n✨ Custom Local Skills & Extensions (Pure Perfect Pi):");
    for (const s of status.customs.skills) {
      console.log(`  [skill]     ${s.name.padEnd(20)} ${s.description}`);
    }
    for (const e of status.customs.extensions) {
      console.log(`  [extension] ${e.name.padEnd(20)} ${e.description}`);
    }
    console.log("\nRun `node reconcile.mjs diff <skill>` to inspect modifications against upstream base.");
    return 0;
  }

  if (command === "diff") {
    const targetSkill = flags.skill || "grilling";
    try {
      const result = await diffSkill(targetSkill, {
        root: flags.root,
        offline: flags.offline,
      });

      console.log(`Diff for '${targetSkill}' (Base: ${result.baseRef.slice(0, 10)} vs Local Override):`);
      console.log("=".repeat(70));
      console.log(result.diff || "No differences detected.");
      return 0;
    } catch (err) {
      console.error(`Diff error: ${err.message}`);
      process.exitCode = 1;
      return 1;
    }
  }

  if (command === "3way-test") {
    const targetSkill = flags.skill || "grilling";
    try {
      const result = await threeWayTestSkill(targetSkill, {
        root: flags.root,
        upstreamRef: flags.upstreamRef,
        offline: flags.offline,
      });

      if (!result.clean) {
        console.error(`3-Way merge test FAILED with ${result.conflictCount} conflict(s).`);
        console.error(`Base: ${result.baseRef?.slice(0, 10)} | Target: ${result.targetRef?.slice(0, 10)}`);
        process.exitCode = result.conflictCount || 1;
        return result.conflictCount || 1;
      }

      console.log(`3-Way merge test completed cleanly. Conflicts: 0`);
      console.log(`Base: ${result.baseRef?.slice(0, 10)} | Target: ${result.targetRef?.slice(0, 10)}`);
      return 0;
    } catch (err) {
      console.error(`3-Way merge test error: ${err.message}`);
      process.exitCode = 1;
      return 1;
    }
  }

  console.error(`Unknown command: ${command}\n`);
  console.log(`Usage:
  node reconcile.mjs status [--json] [--offline]   Check upstream git updates and local override health
  node reconcile.mjs diff [skill] [--offline]      Show diff between upstream git base and local enhancement
  node reconcile.mjs 3way-test [skill] [--upstream-ref <commit>] [--offline]
                                                  Verify 3-way merge against upstream target
`);
  process.exitCode = 1;
  return 1;
}

if (process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error("Reconcile error:", err.message || err);
    process.exit(1);
  });
}
