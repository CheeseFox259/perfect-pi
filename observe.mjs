#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findPiEntry } from "./scripts/pi-runtime.mjs";
import { completedMessages, summarizeUsage } from "./scripts/session-usage.mjs";

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function renderSolSummary(rep) {
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

export async function buildReport(sourceOrRecords, options = {}) {
  let records = [];
  let source = "memory";

  if (Array.isArray(sourceOrRecords)) {
    records = sourceOrRecords;
    source = options.source ?? options.path ?? "memory";
  } else if (typeof sourceOrRecords === "string") {
    source = sourceOrRecords;
    if (existsSync(sourceOrRecords)) {
      const content = await readFile(sourceOrRecords, "utf8");
      records = content.split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } else if (sourceOrRecords.trimStart().startsWith("{")) {
      records = sourceOrRecords.split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } else {
      throw new Error(`Session file not found: ${sourceOrRecords}`);
    }
  }

  let estimateTokens = options.estimateTokens;
  if (!estimateTokens) {
    try {
      const entry = await findPiEntry(options);
      if (entry && existsSync(entry)) {
        const pi = await import(pathToFileURL(entry).href);
        estimateTokens = pi.estimateTokens;
      }
    } catch {}
  }
  if (!estimateTokens) {
    estimateTokens = (msg) => Math.ceil((typeof msg === "string" ? msg.length : (msg.content?.length ?? 0)) / 4);
  }

  const messages = records.filter((record) => record.type === "message" && record.message);
  const eventMessages = records.filter((record) => record.type === "message_end" && record.message);
  const system = eventMessages.find((record) => record.message.role === "system")?.message
    ?? messages.find((record) => record.message.role === "system")?.message;
  const sections = system?.sections ?? {};
  const systemText = Object.values(sections).join("\n");
  const assistantMessages = completedMessages(records).filter((message) => message.role === "assistant");
  const usages = assistantMessages.map((message) => message.usage).filter(Boolean);
  const accountedUsage = summarizeUsage(records);
  const executionTools = records.filter((record) => record.type === "tool_execution_start");
  const persistedCalls = messages.flatMap((record) => record.message.content ?? [])
    .filter((part) => part.type === "toolCall")
    .map((part) => ({ toolName: part.name }));
  const toolEvents = executionTools.length > 0 ? executionTools : persistedCalls;
  const categories = {
    core: new Set(["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"]),
    browser: new Set(["agent_browser", "agent_browser_code", "agent_browser_tools", "agent_browser_action", "agent_browser_qa", "agent_browser_electron", "agent_browser_source", "agent_browser_network_source"]),
    agents: new Set(["subagent"]),
    research: new Set(["research", "web_search", "source_check", "fetch_content", "get_search_content", "web_enable"]),
    mcp: new Set(["tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]),
    code: new Set(["codemode"]),
    lsp: new Set(["lsp_diagnostics", "lsp_fix"]),
    process: new Set(["process"]),
  };
  const toolCounts = {};
  for (const { toolName } of toolEvents) {
    if (!toolName) continue;
    const category = toolName.startsWith("mcp__") ? "mcp" : Object.entries(categories).find(([, names]) => names.has(toolName))?.[0] ?? "other";
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

  // --- SoL-Pi Telemetry & Efficiency Calculation ---
  const customEntries = records
    .filter((r) => r.type === "custom" && typeof r.customType === "string")
    .map((r) => ({ type: r.customType, data: r.data ?? {} }));

  // 1. Action Fusion
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

  // 2. Observation Pack Archival & Recall
  // Use observation-pack ledger.jsonl at session-dir/sol-pi/session-id/observation-pack/ledger.jsonl
  // Deduplicate observation IDs and do not regex arbitrary text.
  const sessionId = options.sessionId ?? records.find((record) => record.type === "session")?.id;
  const sessionDir = options.sessionDir ?? (typeof source === "string" && source !== "memory" && existsSync(source) ? dirname(resolve(source)) : null);

  let ledgerEntries = options.ledgerEntries ?? null;
  if (!ledgerEntries) {
    const ledgerPath = options.ledgerPath ?? (sessionDir && sessionId ? join(sessionDir, "sol-pi", sessionId, "observation-pack", "ledger.jsonl") : null);
    if (ledgerPath && existsSync(ledgerPath)) {
      try {
        const ledgerContent = await readFile(ledgerPath, "utf8");
        ledgerEntries = ledgerContent.split("\n").filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
      } catch {}
    }
  }

  let obsArchived = 0;
  let obsBytesArchived = 0;
  if (Array.isArray(ledgerEntries)) {
    const uniqueArchived = new Map();
    for (const entry of ledgerEntries) {
      if (!entry || !entry.id) continue;
      if (entry.event === "full" || entry.event === "placeholder" || entry.originalBytes != null) {
        const bytes = Number(entry.originalBytes) || 0;
        if (!uniqueArchived.has(entry.id)) {
          uniqueArchived.set(entry.id, bytes);
        } else if (bytes > 0 && !uniqueArchived.get(entry.id)) {
          uniqueArchived.set(entry.id, bytes);
        }
      }
    }
    obsArchived = uniqueArchived.size;
    obsBytesArchived = Array.from(uniqueArchived.values()).reduce((sum, b) => sum + b, 0);
  }

  // Recall count: one authoritative custom event source or fallback tool-call count (never sum)
  const obsRecallCustomEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-observation-recall");
  const obsRecallToolCalls = toolEvents.filter((e) => e.toolName === "obs_recall").length;
  const obsRecallCount = obsRecallCustomEntries.length > 0 ? obsRecallCustomEntries.length : obsRecallToolCalls;

  // 3. Evidence-Preserving Reducer Telemetry
  // Upstream journal outcomes from sol-pi-evidence-preserving-reducer-v1:
  const upstreamJournalEntries = records
    .filter((r) => r.type === "custom" && r.customType === "sol-pi-evidence-preserving-reducer-v1")
    .map((r) => r.data ?? {});

  const upstreamApplied = upstreamJournalEntries.filter((d) => d.kind === "applied");
  const upstreamFallbacks = upstreamJournalEntries.filter((d) => d.kind === "fallback");
  const upstreamResponses = upstreamJournalEntries.filter((d) => d.kind === "provider_response");

  const postResponseFallbackReasons = new Set([
    "model-response-error",
    "schema-validation-failed",
    "quote-not-found",
    "receipt-not-smaller",
  ]);
  const upstreamRejected = upstreamFallbacks.filter((d) =>
    postResponseFallbackReasons.has(d.reason) || (d.usage != null && !["model-call-timeout", "reducer-model-unavailable", "model-call-exception", "provider-request-failed"].includes(d.reason))
  );

  // Parent custom entries:
  const attemptEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-attempt");
  const callEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-call");
  const callFailedEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-call-failed");
  const receiptEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-receipt");
  const parentFallbackEntries = customEntries.filter((e) => e.type === "perfect-pi-sol-reducer-fallback");

  // Requests: report from attempts (fallback legacy calls), include failed and rejected responses
  let reducerRequests = 0;
  if (attemptEntries.length > 0) {
    reducerRequests = new Set(attemptEntries.map((entry, index) => entry.data.attemptId ?? `legacy-attempt-${index}`)).size
      + callEntries.filter(entry => !entry.data.attemptId).length;
  } else if (callEntries.length > 0 || callFailedEntries.length > 0) {
    reducerRequests = callEntries.length + callFailedEntries.length;
  } else if (upstreamResponses.length > 0 || upstreamFallbacks.length > 0) {
    const upstreamNetworkFailures = upstreamFallbacks.filter((d) =>
      ["model-call-timeout", "reducer-model-unavailable", "model-call-exception", "provider-request-failed"].includes(d.reason)
    );
    reducerRequests = upstreamResponses.length + upstreamNetworkFailures.length;
  }

  // Accepted: count upstream applied outcomes, fallback to parent receipts
  let reducerAccepted = 0;
  if (upstreamApplied.length > 0) {
    reducerAccepted = upstreamApplied.length;
  } else {
    reducerAccepted = receiptEntries.filter((e) => e.data.accepted !== false).length;
  }

  // Fallback: count upstream fallback outcomes, fallback to parent fallbacks
  let reducerFallback = 0;
  if (upstreamFallbacks.length > 0) {
    reducerFallback = upstreamFallbacks.length;
  } else {
    reducerFallback = parentFallbackEntries.length;
  }

  // Rejected: include rejected responses (schema validation, receipt not smaller, etc.)
  let reducerRejected = 0;
  const parentExplicitRejected = receiptEntries.filter((e) => e.data.accepted === false).length;
  if (upstreamRejected.length > 0) {
    reducerRejected = Math.max(upstreamRejected.length, parentExplicitRejected);
  } else if (parentExplicitRejected > 0) {
    reducerRejected = parentExplicitRejected;
  } else if (callEntries.length > reducerAccepted) {
    reducerRejected = callEntries.length - reducerAccepted;
  }

  // Provider usage: count completed model responses without duplicate aggregation
  let reducerInputTokens = 0;
  let reducerOutputTokens = 0;
  if (callEntries.length > 0) {
    reducerInputTokens = callEntries.reduce((s, e) => s + (e.data.inputTokens ?? 0), 0);
    reducerOutputTokens = callEntries.reduce((s, e) => s + (e.data.outputTokens ?? 0), 0);
  } else if (upstreamResponses.length > 0) {
    for (const resp of upstreamResponses) {
      const u = resp.usage;
      reducerInputTokens += (u?.input ?? u?.inputTokens ?? u?.prompt_tokens ?? 0);
      reducerOutputTokens += (u?.output ?? u?.outputTokens ?? u?.completion_tokens ?? 0);
    }
  } else if (upstreamApplied.length > 0 || upstreamRejected.length > 0) {
    for (const entry of [...upstreamApplied, ...upstreamRejected]) {
      const u = entry.usage;
      reducerInputTokens += (u?.input ?? u?.inputTokens ?? u?.prompt_tokens ?? 0);
      reducerOutputTokens += (u?.output ?? u?.outputTokens ?? u?.completion_tokens ?? 0);
    }
  } else if (receiptEntries.length > 0) {
    reducerInputTokens = receiptEntries.reduce((s, e) => s + (e.data.inputTokens ?? 0), 0);
    reducerOutputTokens = receiptEntries.reduce((s, e) => s + (e.data.outputTokens ?? 0), 0);
  }

  // 4. Compactions
  // Count Pi's native compaction events. Avoid summing native compaction with upstream
  // state snapshots (sol-pi-online-context-state-v1) as if extra compactions.
  const nativeCompactions = records.filter((r) => r.type === "compaction").length;
  const parentCompactionCount = records.filter((r) => r.type === "custom" && r.customType === "perfect-pi-sol-compaction").length;
  const compactionTriggered = nativeCompactions > 0 ? nativeCompactions : parentCompactionCount;
  const compactionSkipped = records.filter((r) => r.type === "custom" && r.customType === "sol-pi-online-context-compact-skipped").length;

  const report = {
    source,
    sessionId: sessionId ?? null,
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
    totals: accountedUsage.totals,
    usage: { operations: accountedUsage.operations, byKind: accountedUsage.byKind, byModel: accountedUsage.byModel },
    contextPeakTokens: usages.reduce((peak, usage) => Math.max(peak, (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)), 0),
    compactions: nativeCompactions,
    skillsLoaded: [...new Set(skillNames)],
    toolCalls: { total: toolEvents.length, byCategory: toolCounts },
    nestedToolCalls: completedMessages(records).filter(message => message.role === "toolResult")
      .flatMap(message => message.nestedCalls?.calls ?? []),
    sol: {
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
    },
  };

  return report;
}

async function runCli() {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    throw new Error("Usage: node observe.mjs <pi-jsonl-session-or-json-events>");
  }
  const report = await buildReport(path);
  if (args.includes("--summary") || args.includes("--sol")) {
    console.log(renderSolSummary(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
