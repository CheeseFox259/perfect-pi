import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  computeFrontier,
  dispatchFrontier,
  findFeatureTickets,
  getRunStatus,
  hasTmuxSession,
  isTmuxAvailable,
  killTmuxSession,
} from "./scripts/tmux-tickets.mjs";
import { readTicketStatuses, renderDashboard } from "./scripts/tmux-dashboard.mjs";

let piEntry;
try {
  piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
} catch {
  piEntry = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js");
}
const { loadExtensions } = await import(pathToFileURL(join(dirname(piEntry), "core/extensions/loader.js")));
const root = import.meta.dirname;

test("extension loads without errors and registers tool and command", async () => {
  const loaded = await loadExtensions([join(root, "global/extensions/tmux-supervisor.ts")], root);
  assert.deepEqual(loaded.errors, []);
  const ext = loaded.extensions[0];
  assert.ok(ext.tools.has("tmux_tickets"));
  assert.ok(ext.commands.has("tmux-tickets"));
});

test("findFeatureTickets and computeFrontier parse local ticket graph", () => {
  const tmpRepo = join(root, ".scratch-test-repo");
  try {
    const issuesDir = join(tmpRepo, ".scratch", "demo", "issues");
    mkdirSync(issuesDir, { recursive: true });

    writeFileSync(
      join(issuesDir, "01-db-schema.md"),
      `# 01: Setup database schema\n\nTriage: ready-for-agent\nExecution: complete\nBlocked by: none\nVerified commit: a1b2c3d\n`,
      "utf8"
    );

    writeFileSync(
      join(issuesDir, "02-auth-api.md"),
      `# 02: Build Auth API\n\nTriage: ready-for-agent\nExecution: open\nBlocked by: 01\nVerified commit: none\n`,
      "utf8"
    );

    writeFileSync(
      join(issuesDir, "03-ui-login.md"),
      `# 03: Login Page UI\n\nTriage: ready-for-agent\nExecution: open\nBlocked by: 02\nVerified commit: none\n`,
      "utf8"
    );

    const all = findFeatureTickets(tmpRepo, "demo");
    assert.equal(all.length, 3);
    assert.equal(all[0].id, "01");
    assert.equal(all[0].execution, "complete");
    assert.equal(all[1].id, "02");
    assert.equal(all[1].execution, "open");
    assert.deepEqual(all[1].blockedBy, ["01"]);

    const frontier = computeFrontier(all);
    assert.equal(frontier.length, 1);
    assert.equal(frontier[0].id, "02");
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test("renderDashboard generates ANSI dashboard with ticket matrix and tail logs", () => {
  const statuses = [
    {
      ticketId: "01",
      ticketTitle: "Database schema",
      status: "SUCCEEDED",
      startTime: Date.now() - 60000,
      durationMs: 45000,
      commitSha: "a1b2c3d4e5",
      lastLog: "Tests passed: 12 ok",
    },
    {
      ticketId: "02",
      ticketTitle: "Auth API routes",
      status: "RUNNING",
      startTime: Date.now() - 30000,
      durationMs: null,
      commitSha: null,
      lastLog: "Editing src/auth/route.ts",
    },
  ];

  const output = renderDashboard(
    { sessionName: "test-session", integrationBranch: "main", spec: "spec.md" },
    statuses,
    80
  );

  assert.match(output, /PERFECT PI TMUX TICKET DASHBOARD/);
  assert.match(output, /test-session/);
  assert.match(output, /1 Running/);
  assert.match(output, /1 Succeeded/);
  assert.match(output, /\[SUCCEEDED\]/);
  assert.match(output, /\[RUNNING\]/);
  assert.match(output, /a1b2c3d/);
  assert.match(output, /Recent Activity/);
  assert.match(output, /Tests passed/);
});

test("full lifecycle: dispatch mock ticket to tmux, verify status, and kill session", async (t) => {
  if (!isTmuxAvailable()) {
    t.skip("tmux not installed in test environment");
    return;
  }

  const testSession = `test-pi-tmux-${Date.now()}`;
  const issuesDir = join(root, ".scratch", "auth-test", "issues");
  try {
    mkdirSync(issuesDir, { recursive: true });

    writeFileSync(
      join(issuesDir, "01-setup.md"),
      `# 01: Setup module\n\nExecution: open\nBlocked by: none\n`,
      "utf8"
    );

    const res = await dispatchFrontier({
      repoRoot: root,
      feature: "auth-test",
      ticketIds: ["01"],
      sessionName: testSession,
      mockExit: 0,
      mockCommit: "fedcba9876",
      wait: true,
      timeoutMs: 15000,
    });

    assert.equal(res.success, true);
    assert.equal(res.finished, true);
    assert.equal(res.allSucceeded, true);
    assert.equal(res.succeeded[0].id, "01");
    assert.equal(res.succeeded[0].commitSha, "fedcba9876");

    assert.equal(hasTmuxSession(testSession), true);

    const status = getRunStatus(root, "auth-test", res.runId);
    assert.equal(status.exists, true);
    assert.equal(status.tickets[0].status, "SUCCEEDED");

    const killed = killTmuxSession(testSession);
    assert.equal(killed, true);
    assert.equal(hasTmuxSession(testSession), false);
  } finally {
    killTmuxSession(testSession);
    try { execFileSync("git", ["worktree", "remove", "--force", resolve(root, "..", "perfect-pi-01-setup")], { stdio: "ignore" }); } catch {}
    try { execFileSync("git", ["branch", "-D", "auth-test/ticket-01"], { stdio: "ignore" }); } catch {}
    rmSync(join(root, ".scratch", "auth-test"), { recursive: true, force: true });
  }
});
