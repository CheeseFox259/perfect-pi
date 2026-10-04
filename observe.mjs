#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

// Resolve Pi runtime portably (same logic as check-sol-pi-contract.mjs)
function findPiEntry() {
  const candidates = [
    join(homedir(), ".pi", "agent", "@earendil-works", "pi-coding-agent"),
    // npm global root (works on Linux, macOS, Windows)
    (() => { try { return join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works", "pi-coding-agent"); } catch { return null; } })(),
  ].filter(Boolean);
  for (const dir of candidates) {
    const entry = join(dir, "dist", "index.js");
    if (existsSync(entry)) return entry;
  }
  return null;
}
const piEntry = findPiEntry();
let estimateTokens;
if (piEntry) {
  const pi = await import(piEntry);
  estimateTokens = pi.estimateTokens;
} else {
  // Fallback: rough estimate (~4 chars per token)
  estimateTokens = (msg) => Math.ceil((typeof msg === "string" ? msg.length : (msg.content?.length ?? 0)) / 4);
}

const path = process.argv[2];
if (!path) throw new Error("Usage: node observe.mjs <pi-jsonl-session-or-json-events>");
const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
const records = lines.flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const messages = records.filter((record) => record.type === "message" && record.message);
const eventMessages = records.filter((record) => record.type === "message_end" && record.message);
const system = eventMessages.find((record) => record.message.role === "system")?.message
  ?? messages.find((record) => record.message.role === "system")?.message;
const sections = system?.sections ?? {};
const systemText = Object.values(sections).join("\n");
const assistantMessages = [
  ...messages.map((record) => record.message),
  ...eventMessages.map((record) => record.message),
].filter((message) => message.role === "assistant");
const usages = assistantMessages.map((message) => message.usage).filter(Boolean);
const executionTools = records.filter((record) => record.type === "tool_execution_start");
const persistedCalls = messages.flatMap((record) => record.message.content ?? [])
  .filter((part) => part.type === "toolCall")
  .map((part) => ({ toolName: part.name }));
const persistedResults = messages
  .filter((record) => record.message.role === "toolResult")
  .map((record) => ({ toolName: record.message.toolName }));
const toolEvents = executionTools.length > 0 ? executionTools : persistedCalls;
const categories = {
  core: new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"]),
  browser: new Set(["agent_browser", "agent_browser_code", "agent_browser_tools", "agent_browser_action", "agent_browser_qa", "agent_browser_electron", "agent_browser_source", "agent_browser_network_source"]),
  agents: new Set(["subagent"]),
  research: new Set(["research", "web_search", "source_check", "fetch_content", "get_search_content", "web_enable"]),
  mcp: new Set(["mcp", "mcpScript"]),
  lsp: new Set(["lsp_diagnostics", "lsp_fix"]),
  process: new Set(["process"]),
};
const toolCounts = {};
for (const { toolName } of toolEvents) {
  if (!toolName) continue;
  const category = Object.entries(categories).find(([, names]) => names.has(toolName))?.[0] ?? "other";
  toolCounts[category] ??= {};
  toolCounts[category][toolName] = (toolCounts[category][toolName] ?? 0) + 1;
}
const firstSystem = eventMessages.find((record) => record.message.role === "system")?.message
  ?? messages.find((record) => record.message.role === "system")?.message;
const userMessages = [
  ...messages.map((record) => record.message),
  ...eventMessages.map((record) => record.message),
].filter((message) => message.role === "user");
const skillNames = [];
for (const message of userMessages) {
  const content = Array.isArray(message.content)
    ? message.content.map((part) => part.text ?? "").join("\n")
    : String(message.content ?? "");
  for (const match of content.matchAll(/<skill name="([^"]+)"/g)) skillNames.push(match[1]);
}
const report = {
  source: path,
  sessionId: records.find((record) => record.type === "session")?.id,
  initialSystem: firstSystem ? {
    chars: systemText.length,
    estimatedTokens: estimateTokens({ role: "system", content: systemText }),
    skillMetadataChars: (sections.skills ?? "").length,
    toolIndexChars: (sections.tools ?? "").length,
    tools: (firstSystem.toolsAdded ?? []).map((tool) => tool.name),
  } : null,
  requests: usages.length,
  firstRequest: usages[0] ? {
    inputTokens: usages[0].input,
    cacheReadTokens: usages[0].cacheRead,
    cacheWriteTokens: usages[0].cacheWrite,
    outputTokens: usages[0].output,
  } : null,
  totals: usages.reduce((sum, usage) => ({
    input: sum.input + usage.input,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    output: sum.output + usage.output,
  }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }),
  contextPeakTokens: usages.reduce((peak, usage) => Math.max(peak, usage.input + usage.cacheRead + usage.cacheWrite), 0),
  compactions: records.filter((record) => record.type === "compaction").length,
  skillsLoaded: [...new Set(skillNames)],
  toolCalls: { total: toolEvents.length, byCategory: toolCounts },
};

// --- SoL-Pi Telemetry & Efficiency Calculation ---
// Event names aligned with what sol-pi.ts actually emits:
//   perfect-pi-sol-action-fusion   → from registerSafeFusion
//   perfect-pi-sol-observation-recall → from obs_recall wrapper
//   perfect-pi-sol-reducer-call     → from registerAccountedReducer
//   perfect-pi-sol-reducer-receipt   → from registerAccountedReducer
//   perfect-pi-sol-reducer-fallback  → from registerAccountedReducer
// Upstream SoL-Pi ObservationPack does NOT emit custom entries for archival;
// we count archived observations by scanning for obs_XXX placeholder patterns.
const customEntries = records
  .filter((r) => r.type === "custom" && typeof r.customType === "string" && r.customType.startsWith("perfect-pi-sol-"))
  .map((r) => ({ type: r.customType, data: r.data ?? {} }));

const fusionEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-action-fusion");
let fusedCount = fusionEntries.length;
let savedTurns = fusionEntries.filter((e) => e.data.succeeded).reduce((s, e) => s + (e.data.turnsSaved ?? 1), 0);

if (fusedCount === 0) {
  for (const msg of messages) {
    if (msg.message?.role === "toolResult") {
      const txt = Array.isArray(msg.message.content)
        ? msg.message.content.map((p) => p.text ?? "").join("\n")
        : String(msg.message.content ?? "");
      if (txt.includes("[then_run:succeeded]")) {
        fusedCount += 1;
        savedTurns += 1;
      } else if (txt.includes("[then_run:failed]")) {
        fusedCount += 1;
      }
    }
  }
}

// Observation archival: scan session records for obs_XXX placeholder patterns
// since upstream ObservationPack writes to its own ledger, not session custom entries.
const obsRecallEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-observation-recall");
const seenObsIds = new Set();
let obsBytesArchived = 0;
for (const rec of records) {
  const txt = JSON.stringify(rec);
  // Match placeholder patterns: "id: obs_XXXX" or "obs_recall id=obs_XXXX"
  for (const match of txt.matchAll(/obs_([a-f0-9]{24})/g)) {
    seenObsIds.add(`obs_${match[1]}`);
  }
  // Estimate archived bytes from placeholder metadata ("original_bytes: NNN")
  for (const sizeMatch of txt.matchAll(/original_bytes:\s*(\d+)/g)) {
    obsBytesArchived += Number(sizeMatch[1]);
  }
}
const obsArchived = seenObsIds.size;
const obsRecallCount = obsRecallEntries.length + (toolCounts.other?.obs_recall ?? 0);

const reducerCallEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-call");
const reducerReceiptEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-receipt");
const reducerFallbackEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-fallback");

const reducerRequests = reducerCallEntries.length;
const reducerAccepted = reducerReceiptEntries.filter((e) => e.data.accepted !== false).length;
const reducerRejected = reducerReceiptEntries.filter((e) => e.data.accepted === false).length;
const reducerFallback = reducerFallbackEntries.length;
const reducerInputTokens = reducerCallEntries.reduce((s, e) => s + (e.data.inputTokens ?? 0), 0);
const reducerOutputTokens = reducerCallEntries.reduce((s, e) => s + (e.data.outputTokens ?? 0), 0);

// Compaction: count Pi's native compaction events (the only real compaction that runs).
// SoL-Pi online compaction is disabled by default; when enabled, upstream emits its own
// session entries ("sol-pi-online-context-compact") — count those too.
const nativeCompactions = records.filter((r) => r.type === "compaction").length;
const solCompactions = records.filter((r) => r.type === "custom" && r.customType === "sol-pi-online-context-compact").length;
const compactionTriggered = nativeCompactions + solCompactions;
const compactionSkipped = records.filter((r) => r.type === "custom" && r.customType === "sol-pi-online-context-compact-skipped").length;

report.sol = {
  action_fusion: {
    count: fusedCount,
    saved_turns: savedTurns,
  },
  observation_pack: {
    archived: obsArchived,
    bytes_archived: obsBytesArchived,
    recall_count: obsRecallCount,
  },
  reducer: {
    requests: reducerRequests,
    accepted: reducerAccepted,
    rejected: reducerRejected,
    fallback: reducerFallback,
    input_tokens: reducerInputTokens,
    output_tokens: reducerOutputTokens,
  },
  compaction: {
    triggered: compactionTriggered,
    skipped: compactionSkipped,
  },
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderSolSummary(rep) {
  const s = rep.sol;
  return [
    "Perfect-Pi SoL Efficiency Report",
    "--------------------------------",
    `Model requests                ${rep.requests}`,
    `Fused validations             ${s.action_fusion.count}`,
    `Estimated turns avoided       ${s.action_fusion.saved_turns}`,
    "",
    `Observations archived         ${s.observation_pack.archived}`,
    `Original bytes                ${formatBytes(s.observation_pack.bytes_archived)}`,
    `Recall requests               ${s.observation_pack.recall_count}`,
    "",
    `Reducer requests              ${s.reducer.requests}`,
    `Accepted receipts             ${s.reducer.accepted}`,
    `Fallbacks                     ${s.reducer.fallback}`,
    `Reducer tokens                ${(s.reducer.input_tokens + s.reducer.output_tokens).toLocaleString()}`,
    "",
    `Online compactions            ${s.compaction.triggered}`,
  ].join("\n");
}

if (process.argv.includes("--summary") || process.argv.includes("--sol")) {
  console.log(renderSolSummary(report));
} else {
  console.log(JSON.stringify(report, null, 2));
}
