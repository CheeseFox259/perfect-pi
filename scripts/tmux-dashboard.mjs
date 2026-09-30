#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";

function parseArgs(argv) {
  const args = {
    runDir: "",
    spec: "",
    sessionName: "pi-spec-tickets",
    integrationBranch: "main",
    once: false,
    intervalMs: 1000,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && i + 1 < argv.length) args.runDir = argv[++i];
    else if (arg === "--spec" && i + 1 < argv.length) args.spec = argv[++i];
    else if (arg === "--session-name" && i + 1 < argv.length) args.sessionName = argv[++i];
    else if (arg === "--integration-branch" && i + 1 < argv.length) args.integrationBranch = argv[++i];
    else if (arg === "--once") args.once = true;
    else if (arg === "--interval" && i + 1 < argv.length) args.intervalMs = parseInt(argv[++i], 10);
  }
  return args;
}

export function readTicketStatuses(runDir) {
  if (!existsSync(runDir)) return [];
  const entries = readdirSync(runDir, { withFileTypes: true });
  const statuses = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statusPath = join(runDir, entry.name, "status.json");
    if (!existsSync(statusPath)) continue;
    try {
      const data = JSON.parse(readFileSync(statusPath, "utf8"));
      const logPath = join(runDir, entry.name, "worker.log");
      let lastLog = "";
      if (existsSync(logPath)) {
        const lines = readFileSync(logPath, "utf8").trim().split("\n");
        lastLog = lines.slice(-2).join(" | ");
      }
      statuses.push({ ...data, lastLog });
    } catch {}
  }

  statuses.sort((a, b) => String(a.ticketId).localeCompare(String(b.ticketId), undefined, { numeric: true }));
  return statuses;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function renderDashboard(args, statuses, width = 80) {
  const now = Date.now();
  let running = 0;
  let succeeded = 0;
  let failed = 0;

  for (const item of statuses) {
    if (item.status === "RUNNING") running++;
    else if (item.status === "SUCCEEDED") succeeded++;
    else if (item.status === "FAILED") failed++;
  }

  const lines = [];
  const sep = "─".repeat(Math.max(40, width - 2));

  lines.push(`\x1b[1;36m┌${sep}┐\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[0m \x1b[1;37mPERFECT PI TMUX TICKET DASHBOARD\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[0m Session: \x1b[1;33m${args.sessionName}\x1b[0m  Branch: \x1b[32m${args.integrationBranch}\x1b[0m  Spec: \x1b[90m${args.spec || "n/a"}\x1b[0m`);
  lines.push(`\x1b[1;36m├${sep}┤\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[0m Status: \x1b[1;33m${running} Running\x1b[0m | \x1b[1;32m${succeeded} Succeeded\x1b[0m | \x1b[1;31m${failed} Failed\x1b[0m | Total: \x1b[1m${statuses.length}\x1b[0m`);
  lines.push(`\x1b[1;36m├${sep}┤\x1b[0m`);

  // Table header
  lines.push(`\x1b[1;36m│\x1b[0m \x1b[4mID\x1b[0m  \x1b[4mTitle\x1b[0m${" ".repeat(21)} \x1b[4mStatus\x1b[0m      \x1b[4mElapsed\x1b[0m  \x1b[4mCommit\x1b[0m    \x1b[4mWindow\x1b[0m`);

  if (statuses.length === 0) {
    lines.push(`\x1b[1;36m│\x1b[0m   (No active ticket runs found in ${args.runDir})`);
  }

  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i];
    const elapsed = s.durationMs ? formatDuration(s.durationMs) : formatDuration(now - (s.startTime || now));
    const title = (s.ticketTitle || "Ticket").padEnd(25).slice(0, 25);
    const win = `Win ${i + 1}`;

    let statusBadge = "\x1b[90m[QUEUED]   \x1b[0m";
    if (s.status === "RUNNING") statusBadge = "\x1b[1;33m[RUNNING]  \x1b[0m";
    else if (s.status === "SUCCEEDED") statusBadge = "\x1b[1;32m[SUCCEEDED]\x1b[0m";
    else if (s.status === "FAILED") statusBadge = "\x1b[1;31m[FAILED]   \x1b[0m";

    const commit = s.commitSha ? `\x1b[33m${s.commitSha.slice(0, 7)}\x1b[0m ` : "\x1b[90m......  \x1b[0m";
    lines.push(`\x1b[1;36m│\x1b[0m ${String(s.ticketId).padEnd(3)} ${title} ${statusBadge} ${elapsed.padEnd(8)} ${commit}  ${win}`);
  }

  lines.push(`\x1b[1;36m├${sep}┤\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[0m \x1b[1mRecent Activity (Live Tail):\x1b[0m`);

  const activeWithLogs = statuses.filter((s) => s.lastLog);
  if (activeWithLogs.length === 0) {
    lines.push(`\x1b[1;36m│\x1b[0m   \x1b[90mWaiting for worker output...\x1b[0m`);
  } else {
    for (const s of activeWithLogs.slice(-3)) {
      const cleanLog = s.lastLog.replace(/\x1b\[[0-9;]*m/g, "").slice(0, Math.max(30, width - 15));
      lines.push(`\x1b[1;36m│\x1b[0m   [\x1b[1m${s.ticketId}\x1b[0m] \x1b[90m${cleanLog}\x1b[0m`);
    }
  }

  lines.push(`\x1b[1;36m├${sep}┤\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[0m \x1b[1;37mTmux Controls:\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[0m   [Ctrl-b n] Next Window  |  [Ctrl-b p] Prev Window  |  [Ctrl-b <N>] Jump to Win N`);
  lines.push(`\x1b[1;36m│\x1b[0m   [Ctrl-b d] Detach tmux  |  Press \x1b[1mq\x1b[0m here to quit dashboard`);
  lines.push(`\x1b[1;36m└${sep}┘\x1b[0m`);

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.runDir) {
    console.error("Usage: tmux-dashboard.mjs --run-dir <dir> [--spec <spec>] [--session-name <name>] [--integration-branch <branch>] [--once]");
    process.exit(1);
  }

  if (args.once) {
    const statuses = readTicketStatuses(args.runDir);
    console.log(renderDashboard(args, statuses, process.stdout.columns || 80));
    return;
  }

  // Clear screen and hide cursor
  process.stdout.write("\x1b[?25l\x1b[2J\x1b[H");

  const cleanup = () => {
    process.stdout.write("\x1b[?25h\n");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (_str, key) => {
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
      }
    });
  }

  const loop = () => {
    const statuses = readTicketStatuses(args.runDir);
    const text = renderDashboard(args, statuses, process.stdout.columns || 80);
    process.stdout.write("\x1b[H" + text + "\n");
  };

  loop();
  const timer = setInterval(loop, args.intervalMs);
  timer.unref();
}

if (process.argv[1]?.endsWith("tmux-dashboard.mjs")) {
  main().catch((err) => {
    process.stdout.write("\x1b[?25h\n");
    console.error("Dashboard error:", err);
    process.exit(1);
  });
}
