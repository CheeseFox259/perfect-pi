import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkStatus,
  createReconcileFixture,
  createTestGitRepo,
  diffSkill,
  getFileAtRef,
  getSkillUpstreamInfo,
  loadConfig,
  performThreeWayMerge,
  readJson,
  resolveRepoGitDir,
  threeWayTestSkill,
} from "./reconcile.mjs";

const root = dirname(fileURLToPath(import.meta.url));

test("clean independent edits merge", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-clean-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const baseContent = `# Grilling Methodology\n\nFeature A: original description\n\nFeature B: original description\n`;
  const localContent = `# Grilling Methodology\n\nFeature A: local interactive TUI enhancement\n\nFeature B: original description\n`;
  const upstreamNewContent = `# Grilling Methodology\n\nFeature A: original description\n\nFeature B: upstream improved description\n`;

  const fixture = createReconcileFixture(tempDir, {
    commits: [
      { name: "base", message: "base commit", files: { "skills/grilling/SKILL.md": baseContent } },
      { name: "target", message: "upstream update", files: { "skills/grilling/SKILL.md": upstreamNewContent } },
    ],
    localContent,
  });

  const localSkillPath = join(fixture.projectDir, "skills", "grilling", "SKILL.md");
  const originalLocalFileText = readFileSync(localSkillPath, "utf8");

  // In-process function test
  const result = await threeWayTestSkill("grilling", {
    root: fixture.projectDir,
    upstreamRef: fixture.commitShas.target,
    offline: true,
  });

  assert.equal(result.clean, true, "Merge should be marked clean");
  assert.equal(result.conflictCount, 0, "Conflict count should be 0");
  assert.match(result.mergedContent, /Feature A: local interactive TUI enhancement/, "Merged content preserves local enhancement");
  assert.match(result.mergedContent, /Feature B: upstream improved description/, "Merged content incorporates upstream change");

  // Local file must not be modified automatically
  const afterLocalFileText = readFileSync(localSkillPath, "utf8");
  assert.equal(afterLocalFileText, originalLocalFileText, "Local file on disk must NOT be modified");

  // CLI execution test
  const cli = spawnSync(process.execPath, [
    join(root, "reconcile.mjs"),
    "3way-test",
    "grilling",
    "--upstream-ref",
    fixture.commitShas.target,
    "--root",
    fixture.projectDir,
    "--offline",
  ], { encoding: "utf8" });

  assert.equal(cli.status, 0, `CLI should exit 0 on clean merge. stderr: ${cli.stderr}`);
  assert.match(cli.stdout, /3-Way merge test completed cleanly/);
});

test("conflicting edits fail and exit nonzero", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-conflict-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const baseContent = `# Grilling Methodology\n\nFrontier: base decision tree\n`;
  const localContent = `# Grilling Methodology\n\nFrontier: local interactive TUI decision tree\n`;
  const upstreamConflictContent = `# Grilling Methodology\n\nFrontier: upstream divergent decision tree\n`;

  const fixture = createReconcileFixture(tempDir, {
    commits: [
      { name: "base", message: "base commit", files: { "skills/grilling/SKILL.md": baseContent } },
      { name: "target", message: "conflicting upstream commit", files: { "skills/grilling/SKILL.md": upstreamConflictContent } },
    ],
    localContent,
  });

  const result = await threeWayTestSkill("grilling", {
    root: fixture.projectDir,
    upstreamRef: fixture.commitShas.target,
    offline: true,
  });

  assert.equal(result.clean, false, "Merge with conflicting edits must not be marked clean");
  assert.ok(result.conflictCount > 0, "Conflict count must be greater than 0");
  assert.match(result.mergedContent, /<<<<<<< local-enhancement/);
  assert.match(result.mergedContent, /=======/);
  assert.match(result.mergedContent, />>>>>>> upstream-target/);

  // CLI exit code must be nonzero on conflict
  const cli = spawnSync(process.execPath, [
    join(root, "reconcile.mjs"),
    "3way-test",
    "grilling",
    "--upstream-ref",
    fixture.commitShas.target,
    "--root",
    fixture.projectDir,
    "--offline",
  ], { encoding: "utf8" });

  assert.notEqual(cli.status, 0, "CLI must exit nonzero on merge conflicts");
  assert.match(cli.stderr, /3-Way merge test FAILED with 1 conflict/);
});

test("different installed copy in ~/.agents is ignored", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-ignore-installed-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const baseContent = `# Base Skill\nOriginal git base line\n`;
  const localContent = `# Base Skill\nEnhanced local line\n`;
  const poisonedInstalledContent = `# POISONED INSTALLED FILE\nThis installed copy in ~/.agents should never be used as baseRef!\n`;

  const fixture = createReconcileFixture(tempDir, {
    baseContent,
    localContent,
    installedContent: poisonedInstalledContent,
  });

  // Override HOME to point to fixture.homeDir where the poisoned ~/.agents file is
  const prevHome = process.env.HOME;
  process.env.HOME = fixture.homeDir;
  t.after(() => {
    process.env.HOME = prevHome;
  });

  // diffSkill must read exact baseRef from the upstream git repo, NOT ~/.agents
  const diffResult = await diffSkill("grilling", {
    root: fixture.projectDir,
    offline: true,
  });

  assert.doesNotMatch(diffResult.diff, /POISONED INSTALLED FILE/, "diff must ignore installed copy in ~/.agents");
  assert.match(diffResult.diff, /-Original git base line/, "diff must contain the true git base line");
  assert.match(diffResult.diff, /\+Enhanced local line/, "diff must contain the local enhancement");

  // CLI diff test
  const cliDiff = spawnSync(process.execPath, [
    join(root, "reconcile.mjs"),
    "diff",
    "grilling",
    "--root",
    fixture.projectDir,
    "--offline",
  ], {
    encoding: "utf8",
    env: { ...process.env, HOME: fixture.homeDir },
  });

  assert.equal(cliDiff.status, 0, "CLI diff should exit 0");
  assert.doesNotMatch(cliDiff.stdout, /POISONED INSTALLED FILE/, "CLI diff output must not contain installed copy");
  assert.match(cliDiff.stdout, /-Original git base line/);

  // Even if installed file is completely removed, diff and merge still work from upstream git
  rmSync(join(fixture.homeDir, ".agents"), { recursive: true, force: true });

  const diffWithoutInstalled = await diffSkill("grilling", {
    root: fixture.projectDir,
    offline: true,
  });
  assert.match(diffWithoutInstalled.diff, /-Original git base line/);
});

test("missing refs fail loudly and exit nonzero", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-missing-ref-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const fixture = createReconcileFixture(tempDir);
  const nonexistentRef = "0000000000000000000000000000000000000000";

  // 1. Missing upstream target ref in 3way-test
  await assert.rejects(
    async () => {
      await threeWayTestSkill("grilling", {
        root: fixture.projectDir,
        upstreamRef: nonexistentRef,
        offline: true,
      });
    },
    /Upstream ref '0000000000000000000000000000000000000000' not found/,
    "threeWayTestSkill must reject when upstreamRef does not exist"
  );

  const cliMissingTarget = spawnSync(process.execPath, [
    join(root, "reconcile.mjs"),
    "3way-test",
    "grilling",
    "--upstream-ref",
    nonexistentRef,
    "--root",
    fixture.projectDir,
    "--offline",
  ], { encoding: "utf8" });

  assert.notEqual(cliMissingTarget.status, 0, "CLI must exit nonzero when target ref is missing");
  assert.match(cliMissingTarget.stderr, /Upstream ref '0000000000000000000000000000000000000000' not found/);

  // 2. Missing baseRef in components.json
  const badComponentsPath = join(fixture.projectDir, "components.json");
  const components = JSON.parse(readFileSync(badComponentsPath, "utf8"));
  components.skills.grilling.baseRef = nonexistentRef;
  writeFileSync(badComponentsPath, JSON.stringify(components, null, 2), "utf8");

  await assert.rejects(
    async () => {
      await diffSkill("grilling", {
        root: fixture.projectDir,
        offline: true,
      });
    },
    /Upstream ref '0000000000000000000000000000000000000000' not found/,
    "diffSkill must reject when baseRef does not exist"
  );

  const cliMissingBase = spawnSync(process.execPath, [
    join(root, "reconcile.mjs"),
    "diff",
    "grilling",
    "--root",
    fixture.projectDir,
    "--offline",
  ], { encoding: "utf8" });

  assert.notEqual(cliMissingBase.status, 0, "CLI must exit nonzero when baseRef is missing");
  assert.match(cliMissingBase.stderr, /Upstream ref '0000000000000000000000000000000000000000' not found/);

  // 3. Missing upstreamRelPath in existing commit
  components.skills.grilling.baseRef = fixture.baseSha;
  components.skills.grilling.upstreamRelPath = "nonexistent/rel/path.md";
  writeFileSync(badComponentsPath, JSON.stringify(components, null, 2), "utf8");

  await assert.rejects(
    async () => {
      await diffSkill("grilling", {
        root: fixture.projectDir,
        offline: true,
      });
    },
    /Path 'nonexistent\/rel\/path\.md' not found at ref/,
    "diffSkill must reject when upstreamRelPath does not exist in commit"
  );
});

test("status --offline does not invent UP_TO_DATE and checks registry pin alignment", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-status-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const fixture = createReconcileFixture(tempDir);

  // Case A: Registry pins aligned
  const statusAligned = await checkStatus({
    root: fixture.projectDir,
    offline: true,
  });

  const upstreamInfo = statusAligned.upstreams["mattpocock/skills"];
  assert.equal(upstreamInfo.status, "UNKNOWN", "Offline status must be UNKNOWN, not UP_TO_DATE");
  assert.equal(upstreamInfo.remoteHead, null, "Offline mode must not fetch remote HEAD");
  assert.equal(upstreamInfo.pinAligned, true, "Pins are aligned between manifest and components");
  assert.equal(statusAligned.pinAlignment.aligned, true, "Top-level pin alignment is true");
  assert.equal(statusAligned.pinAlignment.mismatches.length, 0);

  // Case B: Registry pins misaligned
  const manifestPath = join(fixture.projectDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.skills[0].ref = "drifted-ref-12345678901234567890123456789012";
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const statusMisaligned = await checkStatus({
    root: fixture.projectDir,
    offline: true,
  });

  const misalignedUpstream = statusMisaligned.upstreams["mattpocock/skills"];
  assert.equal(misalignedUpstream.pinAligned, false, "Should detect pin mismatch");
  assert.equal(statusMisaligned.pinAlignment.aligned, false, "Top-level pin alignment should be false");
  assert.equal(statusMisaligned.pinAlignment.mismatches.length, 1);
  assert.equal(statusMisaligned.pinAlignment.mismatches[0].source, "mattpocock/skills");
  assert.equal(statusMisaligned.pinAlignment.mismatches[0].componentPinnedRef, fixture.baseSha);
  assert.equal(statusMisaligned.pinAlignment.mismatches[0].manifestRef, "drifted-ref-12345678901234567890123456789012");

  // CLI status output checks
  const cliStatus = spawnSync(process.execPath, [
    join(root, "reconcile.mjs"),
    "status",
    "--offline",
    "--root",
    fixture.projectDir,
  ], { encoding: "utf8" });

  assert.equal(cliStatus.status, 0);
  assert.match(cliStatus.stdout, /UNKNOWN/, "Output must show UNKNOWN status for offline upstream");
  assert.match(cliStatus.stdout, /PIN MISMATCH|Registry Pin Misalignments Detected/, "Output must highlight pin mismatch");
});

test("honors components.upstreams[source].repo and skill.upstreamRelPath, including skill-creator/web guides", async (t) => {
  // Test reading the real repository contract
  const realComponents = await readJson(join(root, "components.json"));

  // Check skill-creator
  const scInfo = getSkillUpstreamInfo(realComponents, "skill-creator");
  assert.equal(scInfo.upstream, "anthropics/skills");
  assert.equal(scInfo.repoUrl, "https://github.com/anthropics/skills.git");
  assert.equal(scInfo.upstreamRelPath, "skills/skill-creator/SKILL.md");
  assert.equal(scInfo.baseRef, "8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4");

  // Check web-design-guidelines
  const wdInfo = getSkillUpstreamInfo(realComponents, "web-design-guidelines");
  assert.equal(wdInfo.upstream, "vercel-labs/agent-skills");
  assert.equal(wdInfo.repoUrl, "https://github.com/vercel-labs/agent-skills.git");
  assert.equal(wdInfo.upstreamRelPath, "skills/web-design-guidelines/SKILL.md");
  assert.equal(wdInfo.baseRef, "063bee94c3f4df8453406c830b0a7df0f2860278");

  // Multi-upstream test fixture verifying distinct repos and distinct relPaths
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-multi-source-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const anthropicRepo = join(tempDir, "anthropic-repo");
  const vercelRepo = join(tempDir, "vercel-repo");

  const anthropicShas = createTestGitRepo(anthropicRepo, [
    {
      name: "base",
      message: "anthropic base",
      files: { "custom/rel/skill-creator.md": "# Skill Creator Base\nAnthropic reference\n" },
    },
  ]);

  const vercelShas = createTestGitRepo(vercelRepo, [
    {
      name: "base",
      message: "vercel base",
      files: { "guidelines/web.md": "# Web Guidelines Base\nVercel guidelines\n" },
    },
  ]);

  const projectDir = join(tempDir, "project");
  const testComponents = {
    upstreams: {
      "anthropics/skills": {
        repo: anthropicRepo,
        pinnedRef: anthropicShas.base,
      },
      "vercel-labs/agent-skills": {
        repo: vercelRepo,
        pinnedRef: vercelShas.base,
      },
    },
    skills: {
      "skill-creator": {
        type: "override",
        upstream: "anthropics/skills",
        baseRef: anthropicShas.base,
        localPath: "skills/skill-creator/SKILL.md",
        upstreamRelPath: "custom/rel/skill-creator.md",
      },
      "web-design-guidelines": {
        type: "override",
        upstream: "vercel-labs/agent-skills",
        baseRef: vercelShas.base,
        localPath: "skills/web-design-guidelines/SKILL.md",
        upstreamRelPath: "guidelines/web.md",
      },
    },
  };

  createReconcileFixture(tempDir, {
    components: testComponents,
  });

  // Local files for both skills
  const scLocalPath = join(projectDir, "skills", "skill-creator", "SKILL.md");
  const wdLocalPath = join(projectDir, "skills", "web-design-guidelines", "SKILL.md");
  mkdirSync(dirname(scLocalPath), { recursive: true });
  mkdirSync(dirname(wdLocalPath), { recursive: true });
  writeFileSync(scLocalPath, "# Skill Creator Base\nAnthropic reference with local Pi CLI eval\n");
  writeFileSync(wdLocalPath, "# Web Guidelines Base\nVercel guidelines with native fetch\n");

  const diffSC = await diffSkill("skill-creator", { root: projectDir, offline: true });
  assert.match(diffSC.diff, /\+Anthropic reference with local Pi CLI eval/);
  assert.match(diffSC.diff, /custom\/rel\/skill-creator\.md/);

  const diffWD = await diffSkill("web-design-guidelines", { root: projectDir, offline: true });
  assert.match(diffWD.diff, /\+Vercel guidelines with native fetch/);
  assert.match(diffWD.diff, /guidelines\/web\.md/);
});

test("default remote HEAD allowed explicit validation", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-default-head-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const baseContent = "# Skill\n\n## Section A\nInitial A\n\n## Section B\nInitial B\n";
  const upstreamHeadContent = "# Skill\n\n## Section A\nInitial A\n\n## Section B\nUpstream head update B\n";
  const localContent = "# Skill\n\n## Section A\nLocal edit A\n\n## Section B\nInitial B\n";

  const fixture = createReconcileFixture(tempDir, {
    commits: [
      { name: "base", message: "base commit", files: { "skills/grilling/SKILL.md": baseContent } },
      { name: "target", message: "latest upstream HEAD", files: { "skills/grilling/SKILL.md": upstreamHeadContent } },
    ],
    localContent,
  });

  // Call without options.upstreamRef; should resolve upstream HEAD automatically
  const result = await threeWayTestSkill("grilling", {
    root: fixture.projectDir,
  });

  assert.equal(result.clean, true);
  assert.equal(result.targetRef, fixture.commitShas.target, "Target ref should resolve to upstream HEAD");
  assert.match(result.mergedContent, /Upstream head update B/);
  assert.match(result.mergedContent, /Local edit A/);
});

test("cleanup temp resources", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-cleanup-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const fixture = createReconcileFixture(tempDir);

  const countReconcileTempDirs = () =>
    readdirSync(tmpdir()).filter((f) => f.startsWith("perfect-pi-3way-") || f.startsWith("perfect-pi-diff-")).length;

  const countBefore = countReconcileTempDirs();

  // Run diff
  await diffSkill("grilling", { root: fixture.projectDir, offline: true });
  assert.equal(countReconcileTempDirs(), countBefore, "Diff temporary directory must be removed");

  // Run 3-way test clean
  await threeWayTestSkill("grilling", { root: fixture.projectDir, upstreamRef: fixture.baseSha, offline: true });
  assert.equal(countReconcileTempDirs(), countBefore, "3-Way test temporary directory must be removed");

  // Run 3-way test failure (missing ref)
  try {
    await threeWayTestSkill("grilling", { root: fixture.projectDir, upstreamRef: "invalid0000000000000000000000000000000000", offline: true });
  } catch {
    // expected
  }
  assert.equal(countReconcileTempDirs(), countBefore, "3-Way test failure must not leave temporary directories");
});

test("shell argv safety", async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), "reconcile-test-shell-safe-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const fixture = createReconcileFixture(tempDir);

  // Attempt command injection or flags injection via ref
  const injectionRef = "; touch /tmp/pwned ;";
  await assert.rejects(
    async () => {
      await threeWayTestSkill("grilling", {
        root: fixture.projectDir,
        upstreamRef: injectionRef,
        offline: true,
      });
    },
    /Upstream ref '; touch \/tmp\/pwned ;' not found/,
    "Injection attempts must be safely passed to git argv without shell interpolation"
  );
  assert.equal(existsSync("/tmp/pwned"), false, "Arbitrary shell commands must not execute");

  const flagRef = "--upload-pack=touch /tmp/pwned2";
  await assert.rejects(
    async () => {
      await threeWayTestSkill("grilling", {
        root: fixture.projectDir,
        upstreamRef: flagRef,
        offline: true,
      });
    },
    /Invalid ref '--upload-pack=touch \/tmp\/pwned2'/,
    "Flag-shaped refs must be rejected safely"
  );
  assert.equal(existsSync("/tmp/pwned2"), false, "Flag injections must not execute");
});
