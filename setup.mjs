#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const root = new URL(".", import.meta.url).pathname;
const agentDir = join(homedir(), ".pi", "agent");
const dryRun = process.argv.includes("--dry-run");

const files = [
  ["global/AGENTS.md", "AGENTS.md"],
  ["global/settings.json", "settings.json"],
  ["global/prompts", "prompts"],
  ["global/extensions", "extensions"],
  ["skills/verify-product", "skills/verify-product"],
  ["skills/project-architecture", "skills/project-architecture"],
];

async function copyResource(source, target) {
  const from = join(root, source);
  const to = join(agentDir, target);
  if (dryRun) {
    console.log(`${from} -> ${to}`);
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

if (!existsSync(agentDir)) await mkdir(agentDir, { recursive: true });
for (const [source, target] of files) await copyResource(source, target);

if (!dryRun) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  await writeFile(join(root, "lock", "installed-at.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    agentDir,
    packages: manifest.packages,
  }, null, 2) + "\n");
}

console.log(dryRun ? "Dry run complete." : `Perfect Pi synced to ${agentDir}. Restart Pi or run /reload.`);
