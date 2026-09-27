#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const componentsPath = join(root, "components.json");
const manifestPath = join(root, "manifest.json");

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function getRemoteHead(repoUrl, timeoutMs = 8000) {
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

function getDiff(filePathA, filePathB, labelA = "base", labelB = "local") {
  try {
    const result = spawnSync("diff", ["-u", "-L", labelA, "-L", labelB, filePathA, filePathB], {
      encoding: "utf8",
    });
    return result.stdout || result.stderr || "";
  } catch (error) {
    return String(error);
  }
}

function performThreeWayMerge(localPath, basePath, upstreamPath) {
  // git merge-file -p -L local -L base -L upstream local base upstream
  const result = spawnSync("git", [
    "merge-file",
    "-p",
    "-L", "local-enhancement",
    "-L", "upstream-base",
    "-L", "upstream-latest",
    localPath,
    basePath,
    upstreamPath,
  ], {
    encoding: "utf8",
  });
  return {
    conflictCount: result.status, // 0 = clean merge, >0 = number of conflicts
    mergedContent: result.stdout,
    error: result.stderr,
  };
}

export async function checkStatus(options = {}) {
  const components = await readJson(componentsPath);
  const manifest = await readJson(manifestPath);

  const upstreamStatuses = {};
  for (const [name, info] of Object.entries(components.upstreams || {})) {
    const pinnedRef = info.pinnedRef;
    let remoteHead = options.skipNetwork ? null : getRemoteHead(info.repo);
    const isUpToDate = remoteHead ? remoteHead === pinnedRef : null;

    upstreamStatuses[name] = {
      repo: info.repo,
      pinnedRef,
      remoteHead,
      status: isUpToDate === null ? "UNKNOWN" : isUpToDate ? "UP_TO_DATE" : "UPDATE_AVAILABLE",
      description: info.description,
    };
  }

  const overrides = {};
  for (const [skillName, skill] of Object.entries(components.skills || {})) {
    if (skill.type !== "override") continue;

    const localFile = join(root, skill.localPath);
    const localExists = existsSync(localFile);
    const upstreamInstalledFile = join(homedir(), ".agents", "skills", skillName, "SKILL.md");
    const upstreamExists = existsSync(upstreamInstalledFile);

    const upstreamInfo = upstreamStatuses[skill.upstream];
    const hasUpstreamUpdate = upstreamInfo?.status === "UPDATE_AVAILABLE";

    overrides[skillName] = {
      upstream: skill.upstream,
      baseRef: skill.baseRef,
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
    overrides,
    customs,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "status";
  const isJson = args.includes("--json");

  if (command === "status" || command === "check") {
    const status = await checkStatus();
    if (isJson) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log("=== Perfect Pi Upstream & Overrides Status ===\n");

    console.log("📦 Upstream Repositories:");
    for (const [name, info] of Object.entries(status.upstreams)) {
      const icon = info.status === "UP_TO_DATE" ? "✅" : info.status === "UPDATE_AVAILABLE" ? "🔄" : "❓";
      console.log(`  ${icon} ${name.padEnd(26)} ${info.status}`);
      console.log(`     Pinned: ${info.pinnedRef.slice(0, 10)} | Remote: ${info.remoteHead ? info.remoteHead.slice(0, 10) : "N/A"}`);
    }

    console.log("\n🛠️ Local Override Skills (Enhanced from Upstream):");
    for (const [name, info] of Object.entries(status.overrides)) {
      const updateNotice = info.hasUpstreamUpdate ? " (Upstream update pending)" : " (Base aligned)";
      console.log(`  • ${name}${updateNotice}`);
      console.log(`    Base ref : ${info.baseRef.slice(0, 10)}`);
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
    return;
  }

  if (command === "diff") {
    const targetSkill = args[1] || "grilling";
    const components = await readJson(componentsPath);
    const skill = components.skills?.[targetSkill];

    if (!skill || skill.type !== "override") {
      console.error(`Skill '${targetSkill}' is not a registered override.`);
      process.exit(1);
    }

    const localFile = join(root, skill.localPath);
    const baseInstalledFile = join(homedir(), ".agents", "skills", targetSkill, "SKILL.md");

    if (!existsSync(localFile)) {
      console.error(`Local file not found: ${localFile}`);
      process.exit(1);
    }
    if (!existsSync(baseInstalledFile)) {
      console.error(`Base installed file not found: ${baseInstalledFile}`);
      process.exit(1);
    }

    console.log(`Diff for '${targetSkill}' (Base: ${skill.baseRef.slice(0, 10)} vs Local Override):`);
    console.log("=".repeat(70));
    const diff = getDiff(baseInstalledFile, localFile, `base@${skill.baseRef.slice(0, 7)}`, "local-override");
    console.log(diff || "No differences detected.");
    return;
  }

  if (command === "3way-test") {
    const targetSkill = args[1] || "grilling";
    const components = await readJson(componentsPath);
    const skill = components.skills?.[targetSkill];
    if (!skill) {
      console.error(`Unknown skill: ${targetSkill}`);
      process.exit(1);
    }

    const localFile = join(root, skill.localPath);
    const baseInstalledFile = join(homedir(), ".agents", "skills", targetSkill, "SKILL.md");
    // Test merging against itself (base vs local vs local)
    const result = performThreeWayMerge(localFile, baseInstalledFile, baseInstalledFile);
    console.log(`3-Way merge test completed. Conflicts: ${result.conflictCount}`);
    return;
  }

  console.log(`Usage:
  node reconcile.mjs status [--json]      Check upstream git updates and local override health
  node reconcile.mjs diff [skill]         Show colored diff between upstream base and local enhancement
  node reconcile.mjs 3way-test [skill]    Verify 3-way merge mechanism
`);
}

main().catch((err) => {
  console.error("Reconcile error:", err);
  process.exit(1);
});
