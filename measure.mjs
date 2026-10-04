#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findPiEntry } from "./scripts/pi-runtime.mjs";
import { completedMessages } from "./scripts/session-usage.mjs";

export function buildMeasurement(events, { estimateTokens, cwd, prompt, env = process.env } = {}) {
  const messages = completedMessages(events);
  const systemMessage = messages.find(message => message.role === "system");
  if (!systemMessage) throw new Error("Pi did not emit an initial system message.");
  // Use the declarations sent by the CLI itself, including prepared native tool schemas.
  // A second SDK session has a different built-in loadout and is not a valid substitute.
  const definitions = systemMessage.toolsAdded ?? [];
  const serialized = JSON.stringify(definitions);
  const sections = systemMessage.sections ?? {}, systemPrompt = Object.values(sections).join("\n");
  const skillBlock = sections.skills ?? "";
  const assistants = messages.filter(message => message.role === "assistant");
  const usage = assistants.find(message => message.usage)?.usage;
  const budget = { toolSchemaEstimate: Number(env.PI_TOOL_SCHEMA_BUDGET || 6000), initialInput: Number(env.PI_INITIAL_INPUT_BUDGET || 8000) };
  const estimated = text => estimateTokens({ role: "system", content: text });
  const warnings = [];
  if (estimated(serialized) > budget.toolSchemaEstimate) warnings.push("Tool schema estimate exceeds budget");
  if (usage && (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) > budget.initialInput) warnings.push("Initial input including cache exceeds budget");
  return {
    budget: { ...budget, warnings }, generatedAt: new Date().toISOString(), cwd, probePrompt: prompt,
    systemPrompt: { chars: systemPrompt.length, lines: systemPrompt.split("\n").length, estimatedTokens: estimated(systemPrompt),
      sections: Object.fromEntries(Object.entries(sections).map(([name, text]) => [name, { chars: text.length, estimatedTokens: estimated(text) }])) },
    skillMetadata: { chars: skillBlock.length, estimatedTokens: estimated(skillBlock), skillEntries: [...skillBlock.matchAll(/<skill>/g)].length },
    tools: { activeCount: definitions.length, activeNames: definitions.map(tool => tool.name), definitionChars: serialized.length,
      definitionEstimatedTokens: estimated(serialized), largestDefinitions: definitions.map(tool => ({ name: tool.name,
        chars: JSON.stringify(tool).length, estimatedTokens: estimated(JSON.stringify(tool)) })).sort((a, b) => b.chars - a.chars).slice(0, 8) },
    initialRequest: usage ? { inputTokens: usage.input, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, outputTokens: usage.output, cost: usage.cost?.total } : null,
    run: { assistantMessages: assistants.length, toolCalls: events.filter(event => event.type === "tool_execution_start").map(event => event.toolName) },
    note: "Schemas come from the actual CLI system toolsAdded checkpoint. Local token estimates are character-based; first-request usage is provider-reported.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entry = await findPiEntry();
  if (!entry) throw new Error("Pi runtime not found");
  const { estimateTokens } = await import(pathToFileURL(entry));
  const cwd = process.argv[2] || process.cwd();
  const prompt = process.env.PI_MEASURE_PROMPT || "Reply with exactly: ready. Do not use tools.";
  const args = process.env.PI_EVAL_MODEL ? ["--model", process.env.PI_EVAL_MODEL] : [];
  const result = spawnSync("pi", [...args, "--no-session", "--mode", "json", "--print", prompt], {
    cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Pi measurement request failed (${result.status})`);
  const events = result.stdout.split("\n").filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  console.log(JSON.stringify(buildMeasurement(events, { estimateTokens, cwd, prompt }), null, 2));
}
