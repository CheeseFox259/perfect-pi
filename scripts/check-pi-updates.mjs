#!/usr/bin/env node
import { runNpmReadOnly, PI_PACKAGE_NAME } from "./pi-runtime.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function classifyPiUpdate(baseline, latest) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : null;
  const current = parse(baseline), candidate = parse(latest);
  if (!current || !candidate) throw new Error("Expected stable semantic Pi versions");
  const newer = candidate.some((value, index) => value > current[index] && candidate.slice(0, index).every((v, i) => v === current[i]));
  return { baseline, latest, updateAvailable: newer,
    kind: !newer ? "none" : candidate[0] !== current[0] ? "major" : candidate[1] !== current[1] ? "minor" : "patch" };
}

export async function checkPiUpdates(options = {}) {
  const manifest = options.manifest ?? JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const latest = options.latest ?? JSON.parse(runNpmReadOnly(["view", PI_PACKAGE_NAME, "version", "--json"],
    { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] })).trim();
  return classifyPiUpdate(manifest.piVersion, latest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkPiUpdates(), null, 2));
}
