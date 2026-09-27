#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createAgentSession, SessionManager, estimateTokens } from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const cwd = process.argv[2] || process.cwd();
const prompt = process.env.PI_MEASURE_PROMPT || "Reply with exactly: ready. Do not use tools.";
const result = spawnSync("pi", ["--no-session", "--mode", "json", "--print", prompt], {
  cwd,
  encoding: "utf8",
  timeout: 120_000,
  maxBuffer: 20 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Pi measurement request failed (${result.status}): ${result.stderr}`);

const events = result.stdout.split("\n").filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const systemMessage = events.find((event) => event.type === "message_end" && event.message?.role === "system")?.message;
if (!systemMessage) throw new Error("Pi did not emit an initial system message.");
const assistantMessages = events
  .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
  .map((event) => event.message);
const toolCalls = events.filter((event) => event.type === "tool_execution_start");
const promptSections = systemMessage.sections ?? {};
const systemPrompt = Object.values(promptSections).join("\n");
const activeToolNames = (systemMessage.toolsAdded ?? []).map((tool) => tool.name);
const { session } = await createAgentSession({ cwd, sessionManager: SessionManager.inMemory(cwd) });
try {
  const toolDefinitions = session.getAllTools().filter((tool) => activeToolNames.includes(tool.name));
  const serializedToolDefinitions = JSON.stringify(toolDefinitions);
  const skillBlock = promptSections.skills ?? "";
  const usages = assistantMessages.map((message) => message.usage).filter(Boolean);
  const firstUsage = usages[0];
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    cwd,
    probePrompt: prompt,
    systemPrompt: {
      chars: systemPrompt.length,
      lines: systemPrompt.split("\n").length,
      estimatedTokens: estimateTokens({ role: "system", content: systemPrompt }),
      sections: Object.fromEntries(Object.entries(promptSections).map(([name, text]) => [name, {
        chars: text.length,
        estimatedTokens: estimateTokens({ role: "system", content: text }),
      }])),
    },
    skillMetadata: {
      chars: skillBlock.length,
      estimatedTokens: estimateTokens({ role: "system", content: skillBlock }),
      skillEntries: [...skillBlock.matchAll(/<skill>/g)].length,
    },
    tools: {
      activeCount: activeToolNames.length,
      activeNames: activeToolNames,
      definitionChars: serializedToolDefinitions.length,
      definitionEstimatedTokens: estimateTokens({ role: "system", content: serializedToolDefinitions }),
      largestDefinitions: toolDefinitions
        .map((tool) => ({
          name: tool.name,
          chars: JSON.stringify(tool).length,
          estimatedTokens: estimateTokens({ role: "system", content: JSON.stringify(tool) }),
        }))
        .sort((left, right) => right.chars - left.chars)
        .slice(0, 8),
    },
    initialRequest: firstUsage ? {
      inputTokens: firstUsage.input,
      cacheReadTokens: firstUsage.cacheRead,
      cacheWriteTokens: firstUsage.cacheWrite,
      outputTokens: firstUsage.output,
      cost: firstUsage.cost?.total,
    } : null,
    run: {
      assistantMessages: assistantMessages.length,
      toolCalls: toolCalls.map((event) => event.toolName),
      stderr: result.stderr.trim(),
    },
    note: "System prompt/tool schema sizes are local character-based Pi estimateTokens calculations. Initial request usage is reported by the selected provider.",
  }, null, 2));
} finally {
  session.dispose();
}
