#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export function findFeatureTickets(repoRoot, feature) {
  const issuesDir = join(repoRoot, ".scratch", feature, "issues");
  if (!existsSync(issuesDir)) return [];

  const files = readdirSync(issuesDir).filter((f) => f.endsWith(".md"));
  const tickets = [];

  for (const file of files) {
    const filePath = join(issuesDir, file);
    const content = readFileSync(filePath, "utf8");
    const idMatch = file.match(/^(\d+)(?:-([^.]+))?/);
    const id = idMatch ? idMatch[1] : "00";
    const slug = idMatch && idMatch[2] ? idMatch[2] : file.replace(/\.md$/, "");

    const titleMatch = content.match(/^#+\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : slug;

    const getMeta = (key) => {
      const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
      return match ? match[1].trim() : "";
    };

    const execution = (getMeta("Execution") || "open").toLowerCase();
    const claimedBy = getMeta("Claimed by") || "none";
    const branch = getMeta("Branch") || "none";
    const verifiedCommit = getMeta("Verified commit") || "none";

    const blockedByStr = getMeta("Blocked by") || "none";
    const blockedBy = blockedByStr.toLowerCase() === "none" || !blockedByStr
      ? []
      : blockedByStr.split(",").map((s) => s.trim().padStart(2, "0")).filter(Boolean);

    tickets.push({
      id: id.padStart(2, "0"),
      slug,
      title,
      execution,
      claimedBy,
      branch,
      blockedBy,
      verifiedCommit,
      path: filePath,
    });
  }

  tickets.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return tickets;
}

export function computeFrontier(tickets) {
  const completed = new Set(
    tickets.filter((t) => t.execution === "complete" || t.verifiedCommit !== "none").map((t) => t.id)
  );

  return tickets.filter((t) => {
    if (t.execution !== "open") return false;
    return t.blockedBy.every((dep) => completed.has(dep));
  });
}

export function isTmuxAvailable() {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function hasTmuxSession(sessionName) {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function killTmuxSession(sessionName) {
  if (hasTmuxSession(sessionName)) {
    try {
      execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function dispatchFrontier({
  repoRoot = process.cwd(),
  feature = "default",
  spec = "",
  ticketIds = [],
  integrationBranch = "",
  model = "cpa/gemini-3.8-flash-high",
  thinking = "high",
  sessionName = "",
  wait = false,
  timeoutMs = 600000,
  mockExit = null,
  mockCommit = null,
} = {}) {
  if (!isTmuxAvailable()) {
    throw new Error("tmux is not installed or not in PATH. Please install tmux to use session dispatch.");
  }

  repoRoot = resolve(repoRoot);
  const repoName = basename(repoRoot);
  const specPath = spec ? resolve(repoRoot, spec) : join(repoRoot, ".scratch", feature, "spec.md");
  const sName = sessionName || `pi-spec-${feature}`;

  if (!integrationBranch) {
    try {
      integrationBranch = execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch {
      integrationBranch = "main";
    }
  }

  const allTickets = findFeatureTickets(repoRoot, feature);
  const frontier = computeFrontier(allTickets);

  let targetTickets = frontier;
  if (ticketIds.length > 0) {
    const set = new Set(ticketIds.map((id) => String(id).padStart(2, "0")));
    targetTickets = allTickets.filter((t) => set.has(t.id));
  }

  if (targetTickets.length === 0) {
    return {
      success: false,
      message: "No tickets ready on the frontier for dispatch.",
      sessionName: sName,
      tickets: [],
    };
  }

  const runId = `run-${Date.now()}`;
  const runDir = join(repoRoot, ".scratch", feature, "runs", runId);
  mkdirSync(runDir, { recursive: true });

  // Kill existing session with same name if any
  killTmuxSession(sName);

  const scriptsDir = import.meta.dirname;
  const dashboardScript = join(scriptsDir, "tmux-dashboard.mjs");
  const workerScript = join(scriptsDir, "ticket-worker.mjs");

  const dispatched = [];

  // Create worktrees and branches for each ticket
  for (const ticket of targetTickets) {
    const branchName = `${feature}/ticket-${ticket.id}`;
    const worktreePath = resolve(repoRoot, "..", `${repoName}-${ticket.id}-${ticket.slug}`);
    const ticketRunDir = join(runDir, ticket.id);
    mkdirSync(ticketRunDir, { recursive: true });

    // Initialize status.json as QUEUED
    writeFileSync(
      join(ticketRunDir, "status.json"),
      JSON.stringify(
        {
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          worktree: worktreePath,
          status: "QUEUED",
          startTime: Date.now(),
          model,
          thinking,
          runId,
          commitSha: null,
          error: null,
        },
        null,
        2
      ),
      "utf8"
    );

    // Create worktree if it does not already exist
    if (!existsSync(worktreePath)) {
      try {
        // Try creating branch from integrationBranch
        execFileSync("git", ["worktree", "add", worktreePath, "-b", branchName, integrationBranch], {
          cwd: repoRoot,
          stdio: "ignore",
        });
      } catch {
        // If branch already exists, attach to it
        try {
          execFileSync("git", ["worktree", "add", worktreePath, branchName], {
            cwd: repoRoot,
            stdio: "ignore",
          });
        } catch (err) {
          throw new Error(`Failed to create worktree at ${worktreePath}: ${err.message}`);
        }
      }
    }

    dispatched.push({
      ticket,
      branchName,
      worktreePath,
      ticketRunDir,
    });
  }

  // 1. Start tmux session with window 0: dashboard
  execFileSync("tmux", [
    "new-session", "-d", "-s", sName, "-n", "dashboard",
    "node", dashboardScript,
    "--run-dir", runDir,
    "--spec", specPath,
    "--session-name", sName,
    "--integration-branch", integrationBranch,
  ]);

  // 2. Add each ticket worker as a window
  for (let i = 0; i < dispatched.length; i++) {
    const item = dispatched[i];
    const winName = `${item.ticket.id}-${item.ticket.slug.slice(0, 15)}`;
    const workerArgs = [
      "new-window", "-t", sName, "-n", winName, "-c", item.worktreePath,
      "node", workerScript,
      "--ticket", item.ticket.path,
      "--spec", specPath,
      "--worktree", item.worktreePath,
      "--run-dir", item.ticketRunDir,
      "--model", model,
      "--thinking", thinking,
      "--run-id", runId,
    ];
    if (mockExit !== null) workerArgs.push("--mock-exit", String(mockExit));
    if (mockCommit) workerArgs.push("--mock-commit", mockCommit);
    execFileSync("tmux", workerArgs);
  }

  // Select dashboard window
  execFileSync("tmux", ["select-window", "-t", `${sName}:0`]);

  const result = {
    success: true,
    runId,
    sessionName: sName,
    runDir,
    tickets: dispatched.map((d) => ({
      id: d.ticket.id,
      title: d.ticket.title,
      branch: d.branchName,
      worktree: d.worktreePath,
    })),
    message: `Tmux session '${sName}' launched with ${dispatched.length} ticket worker windows.`,
    attachCmd: `tmux attach -t "${sName}"`,
  };

  if (wait) {
    const waitResult = await waitForRun(runDir, dispatched.map((d) => d.ticket.id), timeoutMs);
    return { ...result, ...waitResult };
  }

  return result;
}

export async function waitForRun(runDir, ticketIds, timeoutMs = 600000) {
  const start = Date.now();
  const ids = new Set(ticketIds.map((id) => String(id).padStart(2, "0")));

  while (Date.now() - start < timeoutMs) {
    let allFinished = true;
    const currentStatuses = [];

    for (const id of ids) {
      const statusFile = join(runDir, id, "status.json");
      if (!existsSync(statusFile)) {
        allFinished = false;
        continue;
      }
      try {
        const data = JSON.parse(readFileSync(statusFile, "utf8"));
        currentStatuses.push(data);
        if (data.status === "RUNNING" || data.status === "QUEUED") {
          allFinished = false;
        }
      } catch {
        allFinished = false;
      }
    }

    if (allFinished && currentStatuses.length >= ids.size) {
      const succeeded = currentStatuses.filter((s) => s.status === "SUCCEEDED");
      const failed = currentStatuses.filter((s) => s.status === "FAILED");
      return {
        finished: true,
        allSucceeded: failed.length === 0,
        succeeded: succeeded.map((s) => ({ id: s.ticketId, commitSha: s.commitSha, durationMs: s.durationMs })),
        failed: failed.map((s) => ({ id: s.ticketId, error: s.error })),
        results: currentStatuses,
      };
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    finished: false,
    timeout: true,
    message: `Timed out waiting for tickets after ${timeoutMs / 1000}s`,
  };
}

export function getRunStatus(repoRoot, feature, runId = "") {
  const baseDir = join(repoRoot, ".scratch", feature, "runs");
  if (!existsSync(baseDir)) return { exists: false, tickets: [] };

  let targetDir = "";
  if (runId) {
    targetDir = join(baseDir, runId);
  } else {
    const runs = readdirSync(baseDir).filter((d) => d.startsWith("run-")).sort().reverse();
    if (runs.length > 0) targetDir = join(baseDir, runs[0]);
  }

  if (!targetDir || !existsSync(targetDir)) return { exists: false, tickets: [] };

  const entries = readdirSync(targetDir, { withFileTypes: true });
  const tickets = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statusFile = join(targetDir, entry.name, "status.json");
    if (!existsSync(statusFile)) continue;
    try {
      tickets.push(JSON.parse(readFileSync(statusFile, "utf8")));
    } catch {}
  }

  const sName = `pi-spec-${feature}`;
  return {
    exists: true,
    runDir: targetDir,
    sessionName: sName,
    sessionAlive: hasTmuxSession(sName),
    tickets,
  };
}

async function cli() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  const getOpt = (flag, fallback = "") => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : fallback;
  };
  const hasFlag = (flag) => argv.includes(flag);

  const feature = getOpt("--feature", "default");
  const repoRoot = resolve(getOpt("--repo", process.cwd()));

  if (!command || command === "--help" || command === "help") {
    console.log(`
Perfect Pi - Tmux Ticket Supervisor

Commands:
  frontier   List tickets on the execution frontier
  dispatch   Create worktrees and dispatch frontier tickets to tmux windows
  status     Inspect active or latest run status
  wait       Wait for running tickets to complete
  kill       Terminate active tmux session
  attach     Attach to the tmux session

Options:
  --feature <slug>           Feature directory name under .scratch/ (default: default)
  --spec <path>              Path to spec file (default: .scratch/<feature>/spec.md)
  --tickets <01,02>          Comma-separated ticket IDs to force-dispatch
  --integration-branch <br>  Branch to branch from / integrate with
  --model <model>            Subagent model (default: cpa/gemini-3.8-flash-high)
  --thinking <level>         Thinking level (default: high)
  --session <name>           Custom tmux session name
  --wait                     Block until all dispatched tickets finish
  --json                     Output results in JSON format
`);
    return;
  }

  if (command === "frontier") {
    const all = findFeatureTickets(repoRoot, feature);
    const frontier = computeFrontier(all);
    if (hasFlag("--json")) {
      console.log(JSON.stringify({ all, frontier }, null, 2));
      return;
    }
    console.log(`\x1b[1;36mFeature:\x1b[0m ${feature} (Total: ${all.length} tickets)`);
    console.log(`\x1b[1;32mFrontier tickets ready for dispatch (${frontier.length}):\x1b[0m`);
    for (const t of frontier) {
      console.log(`  \x1b[1m${t.id}\x1b[0m - ${t.title} [Blocked by: ${t.blockedBy.join(",") || "none"}]`);
    }
    return;
  }

  if (command === "dispatch") {
    const ticketIds = getOpt("--tickets") ? getOpt("--tickets").split(",").map((s) => s.trim()) : [];
    const res = await dispatchFrontier({
      repoRoot,
      feature,
      spec: getOpt("--spec"),
      ticketIds,
      integrationBranch: getOpt("--integration-branch"),
      model: getOpt("--model", "cpa/gemini-3.8-flash-high"),
      thinking: getOpt("--thinking", "high"),
      sessionName: getOpt("--session"),
      wait: hasFlag("--wait"),
    });

    if (hasFlag("--json")) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (!res.success) {
      console.log(`\x1b[1;33m${res.message}\x1b[0m`);
      return;
    }

    console.log(`\x1b[1;32m✔ ${res.message}\x1b[0m`);
    console.log(`  Session: \x1b[1;33m${res.sessionName}\x1b[0m`);
    console.log(`  Attach:  \x1b[36m${res.attachCmd}\x1b[0m`);
    console.log(`\nDispatched tickets:`);
    for (const t of res.tickets) {
      console.log(`  - \x1b[1m${t.id}\x1b[0m: ${t.title}`);
      console.log(`    Worktree: ${t.worktree}`);
    }
    return;
  }

  if (command === "status") {
    const res = getRunStatus(repoRoot, feature, getOpt("--run-id"));
    if (hasFlag("--json")) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (!res.exists) {
      console.log(`No ticket runs found for feature '${feature}'.`);
      return;
    }
    console.log(`\x1b[1;36mRun directory:\x1b[0m ${res.runDir}`);
    console.log(`\x1b[1;36mSession:\x1b[0m       ${res.sessionName} (${res.sessionAlive ? "\x1b[32mACTIVE\x1b[0m" : "\x1b[90mINACTIVE\x1b[0m"})`);
    console.log(`\nTickets:`);
    for (const t of res.tickets) {
      let badge = `[${t.status}]`;
      if (t.status === "SUCCEEDED") badge = `\x1b[32m[SUCCEEDED]\x1b[0m`;
      else if (t.status === "RUNNING") badge = `\x1b[33m[RUNNING]\x1b[0m`;
      else if (t.status === "FAILED") badge = `\x1b[31m[FAILED]\x1b[0m`;
      console.log(`  ${t.ticketId} ${badge} ${(t.ticketTitle || "").padEnd(25)} Commit: ${t.commitSha || "n/a"}`);
    }
    return;
  }

  if (command === "kill") {
    const sName = getOpt("--session", `pi-spec-${feature}`);
    const killed = killTmuxSession(sName);
    if (killed) console.log(`Tmux session '${sName}' killed.`);
    else console.log(`Tmux session '${sName}' was not running.`);
    return;
  }

  if (command === "attach") {
    const sName = getOpt("--session", `pi-spec-${feature}`);
    if (!hasTmuxSession(sName)) {
      console.error(`Session '${sName}' is not running.`);
      process.exit(1);
    }
    execFileSync("tmux", ["attach", "-t", sName], { stdio: "inherit" });
    return;
  }

  console.error(`Unknown command: ${command}. Run with --help for usage.`);
  process.exit(1);
}

if (process.argv[1]?.endsWith("tmux-tickets.mjs")) {
  cli().catch((err) => {
    console.error("CLI error:", err);
    process.exit(1);
  });
}
