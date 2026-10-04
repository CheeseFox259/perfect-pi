import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { detectPiRuntime } = await import("./setup.mjs");

const root = dirname(fileURLToPath(import.meta.url));

// Exercise the CLI in a self-contained repository; PATH cannot reach a real installer.
function installFixture(t) {
  const home = mkdtempSync(join(tmpdir(), "perfect-pi-install-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, "repo");
  const agentDir = join(home, ".pi", "agent");
  const shared = join(home, ".agents", "skills");
  const bin = join(home, "bin");
  const put = (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const json = (path, value) => put(path, `${JSON.stringify(value, null, 2)}\n`);
  mkdirSync(repo);
  mkdirSync(bin);
  for (const file of ["setup.mjs", "doctor.mjs"]) copyFileSync(join(root, file), join(repo, file));
  mkdirSync(join(repo, "scripts"));
  copyFileSync(join(root, "scripts/pi-runtime.mjs"), join(repo, "scripts/pi-runtime.mjs"));
  mkdirSync(join(repo, "global/extensions"), { recursive: true });
  copyFileSync(join(root, "global/extensions/compaction-settings.mjs"), join(repo, "global/extensions/compaction-settings.mjs"));
  const manifest = {
    packages: [],
    skillInstaller: "fixture-skills@1.0.0",
    skills: [{ source: "fixture/skills", ref: "new-pin", selection: ["adapted", "required"] }],
    skillPolicy: { excludeFromPi: ["hidden"], shadowedOverrides: ["adapted", "policy-only"] },
  };
  json(join(repo, "manifest.json"), manifest);
  json(join(repo, "components.json"), {
    skills: { adapted: { type: "override" }, "registry-only": { type: "override" } },
  });
  put(join(repo, "global", "AGENTS.md"), "fixture instructions\n");
  put(join(repo, "skills", "adapted", "SKILL.md"), "local adapted skill\n");
  symlinkSync(process.execPath, join(bin, "node"));
  put(join(bin, "npx"), `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
appendFileSync(join(process.env.HOME, "installer-calls.jsonl"), JSON.stringify(args) + "\\n");
if (existsSync(join(process.env.HOME, "fail-install"))) process.exit(23);
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const source = args[args.indexOf("add") + 1];
const entry = manifest.skills.find(entry => source === entry.source + (entry.ref ? "@" + entry.ref : ""));
if (!entry || args[1] !== "fixture-skills@1.0.0") process.exit(24);
const selected = args.slice(args.indexOf("--skill") + 1, -1);
const names = selected.includes("*") ? entry.requiredSkills : selected;
for (const name of names) {
  const upstream = join(process.env.HOME, ".agents", "skills", name);
  mkdirSync(join(upstream, "references"), { recursive: true });
  writeFileSync(join(upstream, "SKILL.md"), "upstream " + name + "@" + entry.ref + "\\n");
  writeFileSync(join(upstream, "references", "guide.md"), "upstream companion\\n");
  const local = join(process.env.PI_CODING_AGENT_DIR, "skills", name);
  mkdirSync(join(process.env.PI_CODING_AGENT_DIR, "skills"), { recursive: true });
  if (!existsSync(local)) symlinkSync(upstream, local);
}
`);
  chmodSync(join(bin, "npx"), 0o755);
  const runFile = (file, args, extraEnv = {}) => spawnSync(process.execPath, [join(repo, file), ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { HOME: home, PI_CODING_AGENT_DIR: agentDir, PATH: bin, ...extraEnv },
  });
  const run = (...args) => runFile("setup.mjs", ["--skip-package-install", ...args]);
  const statePath = join(agentDir, ".perfect-pi-state.json");
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const doctor = (extraEnv) => {
    const result = runFile("doctor.mjs", ["--json"], extraEnv);
    assert.ok(result.stdout, result.stderr);
    return JSON.parse(result.stdout);
  };
  const calls = () => existsSync(join(home, "installer-calls.jsonl"))
    ? readFileSync(join(home, "installer-calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    : [];
  return { home, repo, agentDir, shared, manifest, put, json, run, runFile, statePath, state, doctor, calls };
}

test("setup initializes user compaction defaults without overwriting later choices", (t) => {
  const f = installFixture(t);
  f.manifest.defaultSettings = { perfectPiCompaction: { provider: "cpa", model: "gemini-3.8-flash-high" } };
  f.json(join(f.repo, "manifest.json"), f.manifest);
  assert.equal(f.run("--skip-skill-install").status, 0);
  const path = join(f.agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(settings.perfectPiCompaction, f.manifest.defaultSettings.perfectPiCompaction);
  settings.perfectPiCompaction = { provider: "custom", model: "vendor/custom-model" };
  f.json(path, settings);
  assert.equal(f.run("--skip-skill-install").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).perfectPiCompaction, settings.perfectPiCompaction);
});

test("setup global settings writes use Pi storage and retain a concurrent picker preference", (t) => {
  const f = installFixture(t);
  const modules = join(f.home, "fake-global/node_modules");
  const pkg = join(modules, "@earendil-works/pi-coding-agent");
  f.json(join(pkg, "package.json"), { name: "@earendil-works/pi-coding-agent", version: "1.0.2", type: "module" });
  f.put(join(pkg, "dist/index.js"), "export {};\n");
  f.put(join(pkg, "dist/core/settings-manager.js"), `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export class FileSettingsStorage {
  constructor(_cwd, agentDir) { this.path = join(agentDir, "settings.json"); }
  withLock(scope, callback) {
    if (scope !== "global") throw new Error("unexpected scope");
    const settings = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {};
    settings.perfectPiCompaction = { provider: "concurrent", model: "new-choice" };
    writeFileSync(this.path, callback(JSON.stringify(settings)));
    writeFileSync(join(process.env.HOME, "lock-used"), "yes");
  }
}\n`);
  const result = f.runFile("setup.mjs", ["--skip-package-install", "--skip-skill-install"], { PI_GLOBAL_NODE_MODULES: modules });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.home, "lock-used"), "utf8"), "yes");
  assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).perfectPiCompaction,
    { provider: "concurrent", model: "new-choice" });
});

test("the pinned Pi runtime is compared with the installed runtime", async (t) => {
  const f = installFixture(t);
  const modules = join(f.home, "fake-global", "node_modules");
  const piDir = join(modules, "@earendil-works", "pi-coding-agent");
  f.put(join(piDir, "package.json"), `${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.99.1" })}\n`);
  assert.deepEqual(await detectPiRuntime([modules]), { version: "0.99.1", root: modules });
  assert.equal(await detectPiRuntime([]), null);
  f.put(join(piDir, "package.json"), `${JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.0.0" })}\n`);
  const env = { PI_GLOBAL_NODE_MODULES: modules };
  assert.equal("pi runtime" in f.doctor(env).statuses, false, "an unpinned manifest has no runtime contract to check");
  f.manifest.piVersion = "1.0.0";
  f.json(join(f.repo, "manifest.json"), f.manifest);
  assert.equal(f.doctor(env).statuses["pi runtime"].status, "SYNCED");
  f.manifest.piVersion = "0.99.1";
  f.json(join(f.repo, "manifest.json"), f.manifest);
  assert.equal(f.doctor(env).statuses["pi runtime"].status, "DRIFTED");
  const synced = f.runFile("setup.mjs", ["--skip-package-install"], env);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /PI RUNTIME DRIFTED: 1\.0\.0 installed; manifest pins 0\.99\.1/);
});

test("Git packages retain filters, verify actual HEAD, and sync idempotently", (t) => {
  const f = installFixture(t);
  const checkout = join(f.agentDir, "git", "github.com", "fixture", "sol-pi");
  f.json(join(checkout, "package.json"), { name: "fixture-sol-pi", version: "0.1.0" });
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", "package.json");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture");
  const ref = git("rev-parse", "HEAD");
  const pkg = { source: `git:github.com/fixture/sol-pi@${ref}`, extensions: [] };
  f.manifest.packages = [pkg];
  f.manifest.skills = [];
  f.json(join(f.repo, "manifest.json"), f.manifest);
  f.json(join(f.repo, "global", "sol-pi.json"), { version: 1, observationPack: true });
  const env = { PATH: process.env.PATH };
  for (let n = 0; n < 2; n++) {
    const synced = f.runFile("setup.mjs", ["--skip-package-install", "--skip-skill-install"], env);
    assert.equal(synced.status, 0, synced.stderr);
    assert.doesNotMatch(synced.stdout, /PACKAGE MISSING/);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, [pkg]);
  assert.equal(f.doctor(env).statuses.packages.status, "SYNCED");
  assert.equal(f.doctor(env).statuses["SoL-Pi config"].status, "SYNCED");
  f.put(join(checkout, "changed.txt"), "changed HEAD\n");
  git("add", "changed.txt");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "drift");
  assert.equal(f.doctor(env).statuses.packages.status, "MISSING");
  rmSync(checkout, { recursive: true, force: true });
  assert.equal(f.doctor(env).statuses.packages.status, "MISSING");
});

test("skipping a source update retains the installed pin and a normal dry-run retries it", (t) => {
  const f = installFixture(t);
  f.json(f.statePath, { skillRefs: { "fixture/skills": "old-pin" } });
  for (const name of ["adapted", "required"]) f.put(join(f.shared, name, "SKILL.md"), "installed old pin\n");
  const skipped = f.run("--skip-skill-install");
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /SOURCE UPDATE REQUIRED fixture\/skills/);
  assert.deepEqual(f.state().skillRefs, { "fixture/skills": "old-pin" });
  assert.equal(f.doctor().statuses["skill source pins"].status, "DRIFTED");
  const before = readFileSync(f.statePath, "utf8");
  const retry = f.run("--dry-run");
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /INSTALL\/UPDATE SKILLS fixture\/skills@new-pin: adapted, required/);
  assert.equal(readFileSync(f.statePath, "utf8"), before);
  assert.deepEqual(f.calls(), []);
  const applied = f.run();
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(f.state().skillRefs, { "fixture/skills": "new-pin" });
  assert.equal(f.doctor().statuses["skill source pins"].status, "SYNCED");
  assert.equal(f.calls().length, 1);
});

test("skipping first skill install leaves the pin unrecorded", (t) => {
  const f = installFixture(t);
  const skipped = f.run("--skip-skill-install");
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.deepEqual(f.state().skillRefs, {});
  assert.equal(f.doctor().statuses["skill source pins"].status, "DRIFTED");
  assert.deepEqual(f.calls(), []);
  const retry = f.run("--dry-run");
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /INSTALL\/UPDATE SKILLS fixture\/skills@new-pin/);
  const applied = f.run();
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(f.state().skillRefs, { "fixture/skills": "new-pin" });
  assert.equal(f.doctor().statuses["skill source pins"].status, "SYNCED");
  assert.equal(f.calls().length, 1);
});

test("a physically installed Pi skill satisfies source presence without shared copy", (t) => {
  const f = installFixture(t);
  f.manifest.skills[0].selection = ["required"];
  f.json(join(f.repo, "manifest.json"), f.manifest);
  f.json(f.statePath, { skillRefs: { "fixture/skills": "new-pin" } });
  f.put(join(f.agentDir, "skills", "required", "SKILL.md"), "physical upstream skill\n");
  const result = f.run("--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /INSTALL\/UPDATE SKILLS/);
  assert.deepEqual(f.calls(), []);
});

test("fallback skills under ~/.pi/agent/skills satisfy source presence when not in ~/.agents", (t) => {
  const f = installFixture(t);
  const isolatedAgentDir = join(f.home, "custom-agent");
  f.manifest.skills[0].selection = ["required"];
  f.json(join(f.repo, "manifest.json"), f.manifest);
  f.json(join(isolatedAgentDir, ".perfect-pi-state.json"), { skillRefs: { "fixture/skills": "new-pin" } });
  f.put(join(f.home, ".pi", "agent", "skills", "required", "SKILL.md"), "fallback skill\n");
  const result = spawnSync(process.execPath, [join(f.repo, "setup.mjs"), "--skip-package-install", "--dry-run"], {
    cwd: f.repo,
    encoding: "utf8",
    env: { HOME: f.home, PI_CODING_AGENT_DIR: isolatedAgentDir, PATH: join(f.home, "bin") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /INSTALL\/UPDATE SKILLS/);
  assert.deepEqual(f.calls(), []);
});

function fixture(name, linkTarget) {
  const home = mkdtempSync(join(tmpdir(), `perfect-pi-${name}-`));
  const agentDir = join(home, ".pi", "agent");
  const skillDir = join(agentDir, "skills");
  const upstream = join(home, ".agents", "skills", "implement-spec");
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(upstream, { recursive: true });
  writeFileSync(join(upstream, "SKILL.md"), "upstream skill\n");
  symlinkSync(linkTarget ?? upstream, join(skillDir, "implement-spec"));
  const run = (...args) => spawnSync(process.execPath, [join(root, "setup.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir },
  });
  return { home, agentDir, upstream, run };
}

test("first install records deterministic exclusions and preserves override companions", (t) => {
  const f = installFixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.skills, [
    "-skills/hidden/SKILL.md",
    `-${join(f.home, ".agents", "skills", "hidden", "SKILL.md")}`,
    `-${join(f.home, ".agents", "skills", "adapted", "SKILL.md")}`,
    `-${join(f.home, ".agents", "skills", "policy-only", "SKILL.md")}`,
    `-${join(f.home, ".agents", "skills", "registry-only", "SKILL.md")}`,
  ].map(value => value.replaceAll("\\\\", "/")));
  assert.equal(f.state().skillRefs["fixture/skills"], "new-pin");
  assert.equal(readFileSync(join(f.agentDir, "skills", "adapted", "references", "guide.md"), "utf8"), "upstream companion\n");
  assert.equal(readFileSync(join(f.shared, "adapted", "references", "guide.md"), "utf8"), "upstream companion\n");
  const again = f.run("--skip-skill-install");
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).skills, settings.skills);
  assert.deepEqual(f.state().skillPatterns, settings.skills);
});

test("a successful ref is retained when a later source install fails", (t) => {
  const f = installFixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(f.state().skillRefs["fixture/skills"], "new-pin");

  f.manifest.skills[0].ref = "next-pin";
  f.json(join(f.repo, "manifest.json"), f.manifest);
  f.put(join(f.home, "fail-install"), "fail\n");
  const failed = f.run();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Could not install skills from fixture\/skills/);
  assert.equal(f.state().skillRefs["fixture/skills"], "new-pin");
  assert.equal(f.doctor().statuses["skill source pins"].status, "DRIFTED");

  rmSync(join(f.home, "fail-install"));
  const recovered = f.run();
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(f.state().skillRefs["fixture/skills"], "next-pin");
  assert.equal(f.doctor().statuses["skill source pins"].status, "SYNCED");
});

test("a new local override refuses an edited existing real skill directory", (t) => {
  const f = installFixture(t);
  f.put(join(f.agentDir, "skills", "adapted", "SKILL.md"), "user edit\n");
  const result = f.run("--skip-skill-install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to overwrite Pi resources.*skills\/adapted\/SKILL.md/s);
  assert.equal(readFileSync(join(f.agentDir, "skills", "adapted", "SKILL.md"), "utf8"), "user edit\n");
});
test("explicit override adoption backs up files and leaves unrelated resources protected", (t) => {
  const f = installFixture(t);
  const target = join(f.agentDir, "skills", "adapted", "SKILL.md");
  f.put(target, "original physical skill\n");
  const dry = f.run("--skip-skill-install", "--adopt-overrides", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /BACKUP OVERRIDE/);
  assert.equal(readFileSync(target, "utf8"), "original physical skill\n");
  assert.equal(existsSync(join(f.agentDir, ".perfect-pi-backups")), false);
  const result = f.run("--skip-skill-install", "--adopt-overrides");
  assert.equal(result.status, 0, result.stderr);
  const backup = result.stdout.match(/BACKUP OVERRIDE skills\/adapted\/SKILL.md -> (.+)/)[1];
  assert.equal(readFileSync(backup, "utf8"), "original physical skill\n");
  assert.equal(readFileSync(target, "utf8"), "local adapted skill\n");
  assert.ok(f.state().resources.includes("skills/adapted/SKILL.md"));

  f.json(f.statePath, { ...f.state(), resources: [] });
  f.put(join(f.agentDir, "AGENTS.md"), "user instructions\n");
  const refused = f.run("--skip-skill-install", "--adopt-overrides");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Refusing to overwrite.*AGENTS.md/s);
  assert.equal(readFileSync(join(f.agentDir, "AGENTS.md"), "utf8"), "user instructions\n");
});

test("setup materializes an upstream skill symlink without mutating upstream", (t) => {
  const { home, agentDir, upstream, run } = fixture("upstream");
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dry = run("--dry-run", "--skip-skill-install", "--skip-package-install");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /REPLACE SYMLINK/);
  assert.equal(lstatSync(join(agentDir, "skills", "implement-spec")).isSymbolicLink(), true);

  const result = run("--skip-skill-install", "--skip-package-install");
  assert.equal(result.status, 0, result.stderr);
  const local = join(agentDir, "skills", "implement-spec", "SKILL.md");
  assert.equal(lstatSync(dirname(local)).isDirectory(), true);
  assert.equal(readFileSync(local, "utf8"), readFileSync(join(root, "skills", "implement-spec", "SKILL.md"), "utf8"));
  for (const name of ["implement-spec", "to-spec", "to-tickets", "implementer"]) {
    const local = name === "implementer"
      ? join(agentDir, "agents", "implementer.md")
      : join(agentDir, "skills", name, "SKILL.md");
    const source = name === "implementer"
      ? join(root, "global", "agents", "implementer.md")
      : join(root, "skills", name, "SKILL.md");
    assert.equal(readFileSync(local, "utf8"), readFileSync(source, "utf8"));
  }
  assert.equal(readFileSync(join(upstream, "SKILL.md"), "utf8"), "upstream skill\n");
  assert.notEqual(realpathSync(dirname(local)), realpathSync(upstream));
});

test("setup refuses to replace a user-owned skill link", (t) => {
  const home = mkdtempSync(join(tmpdir(), "perfect-pi-user-link-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const other = join(home, "user-skill");
  mkdirSync(other);
  writeFileSync(join(other, "SKILL.md"), "user skill\n");
  const { agentDir, run } = fixture("unmanaged", other);
  const fixtureHome = dirname(dirname(agentDir));
  t.after(() => rmSync(fixtureHome, { recursive: true, force: true }));
  const result = run("--skip-skill-install", "--skip-package-install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to replace an unmanaged symlink/);
  assert.equal(lstatSync(join(agentDir, "skills", "implement-spec")).isSymbolicLink(), true);
  assert.equal(readFileSync(join(other, "SKILL.md"), "utf8"), "user skill\n");
});
