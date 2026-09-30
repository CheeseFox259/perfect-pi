#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import * as readline from "node:readline";

function parseArgs(argv) {
  const args = {
    ticket: "",
    spec: "",
    worktree: "",
    runDir: "",
    model: "cpa/gemini-3.8-flash-high",
    thinking: "high",
    runId: `run-${Date.now()}`,
    keepOpen: true,
    mockExit: null,
    mockCommit: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ticket" && i + 1 < argv.length) args.ticket = argv[++i];
    else if (arg === "--spec" && i + 1 < argv.length) args.spec = argv[++i];
    else if (arg === "--worktree" && i + 1 < argv.length) args.worktree = argv[++i];
    else if (arg === "--run-dir" && i + 1 < argv.length) args.runDir = argv[++i];
    else if (arg === "--model" && i + 1 < argv.length) args.model = argv[++i];
    else if (arg === "--thinking" && i + 1 < argv.length) args.thinking = argv[++i];
    else if (arg === "--run-id" && i + 1 < argv.length) args.runId = argv[++i];
    else if (arg === "--keep-open") {
      const next = argv[i + 1];
      if (next === "false" || next === "0") { args.keepOpen = false; i++; }
      else { args.keepOpen = true; }
    } else if (arg === "--mock-exit" && i + 1 < argv.length) {
      args.mockExit = parseInt(argv[++i], 10);
    } else if (arg === "--mock-commit" && i + 1 < argv.length) {
      args.mockCommit = argv[++i];
    }
  }
  return args;
}

function parseTicketInfo(ticketPath) {
  if (!existsSync(ticketPath)) {
    return { id: "unknown", title: "Unknown Ticket", body: "" };
  }
  const content = readFileSync(ticketPath, "utf8");
  const filename = ticketPath.split("/").pop() ?? "";
  const idMatch = filename.match(/^(\d+)/);
  const id = idMatch ? idMatch[1] : "00";
  const titleMatch = content.match(/^#+\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : filename.replace(/\.md$/, "");
  return { id, title, body: content };
}

function updateStatus(statusFile, data) {
  try {
    let existing = {};
    if (existsSync(statusFile)) {
      try { existing = JSON.parse(readFileSync(statusFile, "utf8")); } catch {}
    }
    const updated = { ...existing, ...data, updatedAt: Date.now() };
    writeFileSync(statusFile, JSON.stringify(updated, null, 2), "utf8");
  } catch (err) {
    console.error(`Failed to write status file ${statusFile}:`, err.message);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.ticket || !args.worktree || !args.runDir) {
    console.error("Usage: ticket-worker.mjs --ticket <path> --worktree <path> --run-dir <path> [--spec <path>] [--model <model>] [--thinking <level>]");
    process.exit(1);
  }

  const worktree = resolve(args.worktree);
  const runDir = resolve(args.runDir);
  mkdirSync(runDir, { recursive: true });

  const statusFile = join(runDir, "status.json");
  const logFile = join(runDir, "worker.log");
  const ticketInfo = parseTicketInfo(args.ticket);

  const startTime = Date.now();
  updateStatus(statusFile, {
    ticketId: ticketInfo.id,
    ticketTitle: ticketInfo.title,
    ticketPath: args.ticket,
    specPath: args.spec,
    worktree,
    status: "RUNNING",
    pid: process.pid,
    startTime,
    endTime: null,
    durationMs: null,
    model: args.model,
    thinking: args.thinking,
    runId: args.runId,
    commitSha: null,
    commitMessage: null,
    error: null,
  });

  const divider = "═".repeat(78);
  console.log(`\x1b[1;36m${divider}\x1b[0m`);
  console.log(`\x1b[1;32m[PERFECT PI TICKET WORKER]\x1b[0m`);
  console.log(`Ticket:   \x1b[1m${ticketInfo.id} - ${ticketInfo.title}\x1b[0m`);
  console.log(`Worktree: \x1b[34m${worktree}\x1b[0m`);
  console.log(`Model:    \x1b[33m${args.model}\x1b[0m (thinking: \x1b[33m${args.thinking}\x1b[0m)`);
  console.log(`Log File: \x1b[90m${logFile}\x1b[0m`);
  console.log(`\x1b[1;36m${divider}\x1b[0m\n`);

  let baseSha = "";
  try {
    baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim();
  } catch (err) {
    console.warn("Could not determine base git commit:", err.message);
  }

  let exitCode = 0;

  if (args.mockExit !== null) {
    console.log(`[MOCK] Running mock execution with exit code ${args.mockExit}`);
    writeFileSync(logFile, `Mock worker executed for ticket ${ticketInfo.id}\n`, "utf8");
    exitCode = args.mockExit;
  } else {
    // Construct worker prompt for Pi
    const prompt = [
      `You are implementing ticket ${ticketInfo.id} ("${ticketInfo.title}") in this isolated worktree: ${worktree}.`,
      args.spec ? `Spec file: ${resolve(args.spec)}` : "",
      `Ticket file: ${resolve(args.ticket)}`,
      "",
      "CRITICAL WORKER RULES:",
      "1. Stay strictly within this worktree. Do NOT modify files outside it.",
      "2. Implement the required observable behavior and acceptance criteria described in the ticket and spec.",
      "3. Run all relevant tests and checks in this worktree to verify your code.",
      "4. Commit ONLY your implementation changes to the ticket branch.",
      "5. Do NOT edit tracker state, .scratch files, or other worktrees.",
      "6. Print the verified commit SHA and test summary upon completion.",
    ].filter(Boolean).join("\n");

    const implementerRole = join(process.env.HOME || "", ".pi/agent/agents/implementer.md");
    const piArgs = [
      "-p",
      "--model", args.model,
      "--thinking", args.thinking,
    ];
    if (existsSync(implementerRole)) {
      piArgs.push("--append-system-prompt", implementerRole);
    }
    piArgs.push("--", prompt);

    console.log(`[EXEC] Starting autonomous Pi session in worktree...\n`);
    const child = spawn("pi", piArgs, {
      cwd: worktree,
      env: { ...process.env, PI_RUN_TICKET: ticketInfo.id },
      stdio: ["inherit", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      try { writeFileSync(logFile, chunk, { flag: "a" }); } catch {}
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      try { writeFileSync(logFile, chunk, { flag: "a" }); } catch {}
    });

    exitCode = await new Promise((resolvePromise) => {
      child.on("close", (code) => resolvePromise(code ?? 0));
      child.on("error", (err) => {
        console.error("Failed to spawn pi worker:", err);
        resolvePromise(1);
      });
    });
  }

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  let commitSha = args.mockCommit;
  let commitMsg = "";

  if (!commitSha) {
    try {
      const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim();
      if (headSha && headSha !== baseSha) {
        commitSha = headSha;
        commitMsg = execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: worktree, encoding: "utf8" }).trim();
      }
    } catch {}
  }

  let hasUncommittedChanges = false;
  if (!commitSha) {
    try {
      const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: worktree, encoding: "utf8" }).trim();
      hasUncommittedChanges = porcelain.length > 0;
    } catch {}
  }

  const succeeded = exitCode === 0 && (Boolean(commitSha) || args.mockExit === 0);
  const status = succeeded ? "SUCCEEDED" : "FAILED";
  const error = succeeded ? null : exitCode !== 0
    ? `Process exited with code ${exitCode}`
    : hasUncommittedChanges
      ? "No commit produced (uncommitted changes left in worktree)"
      : "No commit produced (no changes detected)";

  updateStatus(statusFile, {
    status,
    endTime,
    durationMs,
    commitSha: commitSha || null,
    commitMessage: commitMsg || null,
    error,
  });

  console.log(`\n\x1b[1;36m${divider}\x1b[0m`);
  if (succeeded) {
    console.log(`\x1b[1;32m✔ [TICKET ${ticketInfo.id} COMPLETE - SUCCEEDED]\x1b[0m`);
    if (commitSha) console.log(`  Commit:  \x1b[1;33m${commitSha}\x1b[0m ${commitMsg ? `(${commitMsg})` : ""}`);
    console.log(`  Time:    \x1b[36m${(durationMs / 1000).toFixed(1)}s\x1b[0m`);
    console.log(`  Logs:    \x1b[90m${logFile}\x1b[0m`);
  } else {
    console.log(`\x1b[1;31m✖ [TICKET ${ticketInfo.id} FAILED]\x1b[0m`);
    console.log(`  Error:   ${error}`);
    console.log(`  Logs:    \x1b[90m${logFile}\x1b[0m`);
  }
  console.log(`\x1b[1;36m${divider}\x1b[0m\n`);

  if (args.keepOpen && process.stdin.isTTY) {
    console.log("\x1b[90m[Window remains open for inspection. Press Enter or Ctrl+C to close.]\x1b[0m");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolveWait) => {
      rl.question("", () => {
        rl.close();
        resolveWait();
      });
    });
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal worker error:", err);
  process.exit(1);
});
