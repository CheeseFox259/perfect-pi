#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
export function auditSkills(projectRoot = root, agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")) {
  const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));
  const components = JSON.parse(readFileSync(join(projectRoot, "components.json"), "utf8"));
  const errors = [];
  const skills = new Map();
  for (const entry of manifest.skills) {
    const names = entry.source.startsWith("local:") ? [entry.source.slice(6)] : entry.selection === "all" ? entry.requiredSkills : entry.selection;
    for (const name of names) if (!skills.has(name)) skills.set(name, { name, source: entry.source, ref: entry.ref });
  }
  for (const name of readdirSync(join(projectRoot, "skills"))) {
    if (existsSync(join(projectRoot, "skills", name, "SKILL.md")) && !components.skills[name]) errors.push(`${name}: local skill is absent from components.json`);
  }
  const results = [];
  for (const skill of skills.values()) {
    const { name } = skill;
    const component = components.skills[name];
    const local = join(projectRoot, "skills", name, "SKILL.md");
    const candidates = [local, join(agentDir, "skills", name, "SKILL.md"), join(homedir(), ".agents", "skills", name, "SKILL.md")];
    const path = candidates.find(existsSync);
    if (!path) { errors.push(`${name}: skill missing`); continue; }
    if (manifest.skillPolicy.excludeFromPi.includes(name)) errors.push(`${name}: managed skill is hidden`);
    if (existsSync(local) && !skill.source.startsWith("local:")) {
      if (component?.type !== "override") errors.push(`${name}: missing override registration`);
      if (!manifest.skillPolicy.shadowedOverrides.includes(name)) errors.push(`${name}: upstream not shadowed`);
      if (!component?.baseRef || !component?.upstreamRelPath) errors.push(`${name}: missing lineage`);
    }
    const text = readFileSync(path, "utf8");
    if (!text.startsWith("---\n") || !text.includes(`name: ${name}\n`) || !/^description: .+/m.test(text)) errors.push(`${name}: invalid frontmatter`);
    for (const line of text.split("\n")) {
      if (/do not|never|nonexistent|there is no/i.test(line)) continue;
      if (/call the Skill tool|use WebFetch|fetch_web_page|claude --bg|claude -p|AskUserQuestion|TodoWrite|EnterPlanMode|ExitPlanMode/i.test(line)) errors.push(`${name}: incompatible instruction: ${line.trim()}`);
    }
    results.push({ ...skill, status: component?.type === "override" ? "adapted" : component?.type === "custom" ? "native" : "portable", path });
  }
  for (const [source, upstream] of Object.entries(components.upstreams)) {
    if (manifest.skills.find((entry) => entry.source === source)?.ref !== upstream.pinnedRef) errors.push(`${source}: manifest/registry pins disagree`);
  }
  return { ok: errors.length === 0, counts: Object.fromEntries(["adapted", "portable", "native"].map((status) => [status, results.filter((r) => r.status === status).length])), skills: results, errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditSkills();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
