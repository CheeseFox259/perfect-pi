import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  beginPhase,
  checkDurabilityGate,
  clearPhase,
  completePhase,
  DEFAULT_ROUTE,
  getActivePhase,
  isMidPhaseCompactionAllowed,
  isPhaseBoundaryEligible,
  loadPhaseContract,
  MIN_TOKENS_SAVED,
  resetPhaseState,
  restorePhase,
  snapshotPhase,
  validatePhaseContract,
} from "./global/extensions/sol-pi-phase.mjs";

async function createTempDir(prefix = "phase-test-") {
  return await mkdtemp(join(tmpdir(), prefix));
}

test("empty scratch rejects durability gate", async (t) => {
  const dir = await createTempDir();
  t.after(async () => await rm(dir, { recursive: true, force: true }));

  await mkdir(join(dir, ".scratch"), { recursive: true });

  const gate = {
    requiredArtifacts: [".scratch/*/spec.md"],
    failClosed: true,
  };

  const result = checkDurabilityGate(dir, gate);
  assert.equal(result, false, "empty scratch must reject durability gate");
});

test("wrong/unrelated feature artifacts rejects", async (t) => {
  const dir = await createTempDir();
  t.after(async () => await rm(dir, { recursive: true, force: true }));

  const wrongFeatureDir = join(dir, ".scratch", "other-feature");
  await mkdir(wrongFeatureDir, { recursive: true });
  await writeFile(join(wrongFeatureDir, "spec.md"), "# Other Feature Spec\n");

  const gate = {
    requiredArtifacts: [".scratch/*/spec.md"],
    failClosed: true,
  };

  // Checking with active feature "auth-feature" when only "other-feature" has spec.md
  const result = checkDurabilityGate(dir, gate, { feature: "auth-feature" });
  assert.equal(result, false, "unrelated feature artifacts must reject");
});

test("matched files true when actual artifact file exists", async (t) => {
  const dir = await createTempDir();
  t.after(async () => await rm(dir, { recursive: true, force: true }));

  const featureDir = join(dir, ".scratch", "auth-feature");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "spec.md"), "# Auth Spec\n");

  const gate = {
    requiredArtifacts: [".scratch/*/spec.md"],
    failClosed: true,
  };

  const result = checkDurabilityGate(dir, gate, { feature: "auth-feature" });
  assert.equal(result, true, "matched artifact file must satisfy durability gate");

  // Rejects if the artifact path is a directory, not a real file
  const dirAsArtifact = join(dir, ".scratch", "bogus-feature", "spec.md");
  await mkdir(dirAsArtifact, { recursive: true });
  const dirResult = checkDurabilityGate(dir, gate, { feature: "bogus-feature" });
  assert.equal(dirResult, false, "directory existence must not satisfy exact artifact check");
});

test("dirty git rejects", async (t) => {
  const dir = await createTempDir();
  t.after(async () => await rm(dir, { recursive: true, force: true }));

  // Initialize a clean git repository
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "agent@pi.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Pi Agent"], { cwd: dir });

  await writeFile(join(dir, "committed.txt"), "clean content\n");
  execFileSync("git", ["add", "committed.txt"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir });

  const gate = {
    gitCleanOrCommitted: true,
    failClosed: true,
  };

  // Initially clean: must pass
  const cleanResult = checkDurabilityGate(dir, gate);
  assert.equal(cleanResult, true, "clean git working tree must pass");

  // Add untracked dirty file: must reject
  await writeFile(join(dir, "dirty-untracked.txt"), "untracked content\n");
  const dirtyUntracked = checkDurabilityGate(dir, gate);
  assert.equal(dirtyUntracked, false, "untracked files must make git dirty and reject");

  // Remove untracked and modify tracked file: must reject
  await rm(join(dir, "dirty-untracked.txt"));
  await writeFile(join(dir, "committed.txt"), "modified dirty content\n");
  const dirtyTracked = checkDurabilityGate(dir, gate);
  assert.equal(dirtyTracked, false, "modified tracked file must make git dirty and reject");
});

test("trusted override invalid fail closed", async (t) => {
  const agentDir = await createTempDir("agent-dir-");
  const projectDir = await createTempDir("project-dir-");
  t.after(async () => {
    await rm(agentDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  // Valid managed contract in agentDir
  const managedSkillDir = join(agentDir, "skills", "ask-matt");
  await mkdir(managedSkillDir, { recursive: true });
  const validContract = {
    version: 1,
    phases: {
      "to-spec": {
        skill: "to-spec",
        policy: "checkpoint_eligible",
        allowMidPhaseCompact: false,
        allowBoundaryCompact: true,
      },
    },
  };
  await writeFile(join(managedSkillDir, "phase-contract.json"), JSON.stringify(validContract));

  // Invalid override in projectDir (invalid boolean / malformed)
  const projectSkillDir = join(projectDir, "skills", "ask-matt");
  await mkdir(projectSkillDir, { recursive: true });
  await writeFile(
    join(projectSkillDir, "phase-contract.json"),
    JSON.stringify({
      version: 1,
      phases: {
        "to-spec": {
          skill: "to-spec",
          allowMidPhaseCompact: "not-a-boolean",
          allowBoundaryCompact: true,
        },
      },
    }),
  );

  // When project is trusted, invalid override must fail closed (return null), NOT fall back
  const trustedLoaded = loadPhaseContract(agentDir, projectDir, true);
  assert.equal(trustedLoaded, null, "invalid trusted override must fail closed and return null");

  // Invalid with path traversal in requiredArtifacts must also fail closed
  await writeFile(
    join(projectSkillDir, "phase-contract.json"),
    JSON.stringify({
      version: 1,
      phases: {
        "to-spec": {
          skill: "to-spec",
          allowMidPhaseCompact: false,
          allowBoundaryCompact: true,
          durabilityGate: {
            requiredArtifacts: ["../../etc/passwd"],
          },
        },
      },
    }),
  );
  const traversalLoaded = loadPhaseContract(agentDir, projectDir, true);
  assert.equal(traversalLoaded, null, "path traversal override must fail closed and return null");
});

test("ignored untrusted override", async (t) => {
  const agentDir = await createTempDir("agent-dir-");
  const projectDir = await createTempDir("project-dir-");
  t.after(async () => {
    await rm(agentDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  // Valid managed contract in agentDir
  const managedSkillDir = join(agentDir, "skills", "ask-matt");
  await mkdir(managedSkillDir, { recursive: true });
  const managedContract = {
    version: 1,
    phases: {
      "to-spec": {
        skill: "to-spec",
        policy: "checkpoint_eligible",
        allowMidPhaseCompact: false,
        allowBoundaryCompact: true,
      },
    },
  };
  await writeFile(join(managedSkillDir, "phase-contract.json"), JSON.stringify(managedContract));

  // Project has custom/malicious override attempting to allow mid-phase compaction
  const projectSkillDir = join(projectDir, "skills", "ask-matt");
  await mkdir(projectSkillDir, { recursive: true });
  await writeFile(
    join(projectSkillDir, "phase-contract.json"),
    JSON.stringify({
      version: 1,
      phases: {
        "to-spec": {
          skill: "to-spec",
          policy: "forbidden",
          allowMidPhaseCompact: true,
          allowBoundaryCompact: false,
        },
      },
    }),
  );

  // Untrusted repository (projectTrusted = false, default): override MUST BE IGNORED
  const untrustedLoaded = loadPhaseContract(agentDir, projectDir, false);
  assert.notEqual(untrustedLoaded, null);
  assert.equal(
    untrustedLoaded.phases["to-spec"].allowMidPhaseCompact,
    false,
    "managed contract must be used when repo is untrusted",
  );
  assert.equal(
    untrustedLoaded.phases["to-spec"].allowBoundaryCompact,
    true,
    "untrusted override must be completely ignored",
  );
});

test("boundary versus mid flags", async (t) => {
  const dir = await createTempDir();
  t.after(async () => await rm(dir, { recursive: true, force: true }));

  const featureDir = join(dir, ".scratch", "auth");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "spec.md"), "# Spec\n");

  const phaseConfig = {
    skill: "to-spec",
    allowMidPhaseCompact: false,
    allowBoundaryCompact: true,
    durabilityGate: {
      requiredArtifacts: [".scratch/*/spec.md"],
    },
  };

  // 1. Mid-phase (status: in_progress, completed: false)
  const midPhase = {
    ...phaseConfig,
    completed: false,
    status: "in_progress",
  };
  const midResult = isPhaseBoundaryEligible(midPhase, {
    cwd: dir,
    feature: "auth",
    tokensSaved: 3000,
  });
  assert.equal(midResult, false, "mid-phase must suppress compaction");
  assert.equal(isMidPhaseCompactionAllowed(midPhase), false);

  // 2. Completed boundary (status: completed, completed: true)
  const completedPhase = {
    ...phaseConfig,
    completed: true,
    status: "completed",
  };
  const boundaryResult = isPhaseBoundaryEligible(completedPhase, {
    cwd: dir,
    feature: "auth",
    tokensSaved: 3000,
  });
  assert.equal(boundaryResult, true, "completed boundary with satisfied gates must be eligible");

  // 3. Phase that disallows boundary compact (e.g. grill-me)
  const grillingPhase = {
    skill: "grill-me",
    allowMidPhaseCompact: false,
    allowBoundaryCompact: false,
    completed: true,
    status: "completed",
  };
  const grillingResult = isPhaseBoundaryEligible(grillingPhase, {
    cwd: dir,
    tokensSaved: 5000,
  });
  assert.equal(grillingResult, false, "phase with allowBoundaryCompact: false must be rejected");
});

test("economic minimum threshold enforces 2,000 tokens", async (t) => {
  const dir = await createTempDir();
  t.after(async () => await rm(dir, { recursive: true, force: true }));

  const featureDir = join(dir, ".scratch", "auth");
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, "spec.md"), "# Spec\n");

  const completedPhase = {
    skill: "to-spec",
    allowMidPhaseCompact: false,
    allowBoundaryCompact: true,
    durabilityGate: {
      requiredArtifacts: [".scratch/*/spec.md"],
    },
    completed: true,
    status: "completed",
  };

  // Under economic minimum (< 2000)
  const belowThreshold = isPhaseBoundaryEligible(completedPhase, {
    cwd: dir,
    feature: "auth",
    tokensSaved: 1999,
  });
  assert.equal(belowThreshold, false, "savings below 2000 tokens must reject");

  // Exactly at economic minimum (2000)
  const exactThreshold = isPhaseBoundaryEligible(completedPhase, {
    cwd: dir,
    feature: "auth",
    tokensSaved: 2000,
  });
  assert.equal(exactThreshold, true, "savings of exactly 2000 tokens must pass");

  // Well above economic minimum
  const aboveThreshold = isPhaseBoundaryEligible(completedPhase, {
    cwd: dir,
    feature: "auth",
    tokensSaved: 5000,
  });
  assert.equal(aboveThreshold, true, "savings above 2000 tokens must pass");

  // Missing tokens saved
  const missingTokens = isPhaseBoundaryEligible(completedPhase, {
    cwd: dir,
    feature: "auth",
  });
  assert.equal(missingTokens, false, "missing tokensSaved must fail closed");
});

test("phase lifecycle and route/sessionId scoped restore", () => {
  resetPhaseState();
  const sessionId = "session-abc";
  const route = "cpa/gemini-3.8-flash-high";

  // Initially no active phase
  assert.equal(getActivePhase(sessionId, route), null);

  // Begin phase
  const begun = beginPhase(
    sessionId,
    route,
    {
      skill: "to-spec",
      allowMidPhaseCompact: false,
      allowBoundaryCompact: true,
    },
    { feature: "my-feature" },
  );
  assert.equal(begun.skill, "to-spec");
  assert.equal(begun.status, "in_progress");
  assert.equal(begun.completed, false);
  assert.equal(begun.feature, "my-feature");

  // Get active phase returns begun phase
  assert.equal(getActivePhase(sessionId, route)?.skill, "to-spec");

  // Complete phase
  const completed = completePhase(sessionId, route);
  assert.equal(completed?.completed, true);
  assert.equal(completed?.status, "completed");

  // Take snapshot
  const snapshot = snapshotPhase(sessionId, route);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot.sessionId, sessionId);

  // Clear phase
  assert.equal(clearPhase(sessionId, route), true);
  assert.equal(getActivePhase(sessionId, route), null);

  // Restore with matching session and route succeeds
  const restored = restorePhase(sessionId, route, snapshot);
  assert.notEqual(restored, null);
  assert.equal(getActivePhase(sessionId, route)?.skill, "to-spec");

  // Restore with mismatched session or route fails closed
  const mismatchedSession = restorePhase("different-session", route, snapshot);
  assert.equal(mismatchedSession, null, "mismatched sessionId must reject restore");

  const mismatchedRoute = restorePhase(sessionId, "different/route", snapshot);
  assert.equal(mismatchedRoute, null, "mismatched route must reject restore");
});

test("validatePhaseContract schema validation", () => {
  assert.equal(validatePhaseContract(null), false);
  assert.equal(validatePhaseContract({}), false);
  assert.equal(validatePhaseContract({ version: 0, phases: {} }), false);

  // Valid contract
  assert.equal(
    validatePhaseContract({
      version: 1,
      phases: {
        "grill-me": {
          skill: "grill-me",
          allowMidPhaseCompact: false,
          allowBoundaryCompact: false,
        },
      },
      gates: {
        gateC_economic: {
          minTokensSaved: 2000,
        },
      },
    }),
    true,
  );

  // Invalid phase booleans
  assert.equal(
    validatePhaseContract({
      version: 1,
      phases: {
        "grill-me": {
          allowMidPhaseCompact: "false", // string, not boolean
          allowBoundaryCompact: false,
        },
      },
    }),
    false,
  );

  // Negative economic gate
  assert.equal(
    validatePhaseContract({
      version: 1,
      phases: {
        "grill-me": {
          allowMidPhaseCompact: false,
          allowBoundaryCompact: false,
        },
      },
      gates: {
        gateC_economic: {
          minTokensSaved: -1,
        },
      },
    }),
    false,
  );
});
