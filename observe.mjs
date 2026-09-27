#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { estimateTokens } from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

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
console.log(JSON.stringify(report, null, 2));
