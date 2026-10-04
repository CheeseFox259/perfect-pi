import { createHash } from "node:crypto";

const fields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export function addUsage(total, usage) {
  for (const key of fields) total[key] += finite(usage?.[key]);
  for (const key of Object.keys(total.cost)) total.cost[key] += finite(usage?.cost?.[key]);
  return total;
}

// Prefer persisted messages and subtract equivalent event copies as a multiset.
// Identical repeated messages remain separate operations rather than being collapsed.
export function completedMessages(records) {
  const seenMessages = new Set();
  const persisted = records.filter(record => {
    if (record.type !== "message" || !record.message) return false;
    if (record.id && seenMessages.has(record.id)) return false;
    if (record.id) seenMessages.add(record.id);
    return true;
  }).map(record => record.message);
  const counts = new Map();
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  const fingerprint = message => createHash("sha256").update(JSON.stringify(canonical(message))).digest("hex");
  for (const message of persisted) { const key = fingerprint(message); counts.set(key, (counts.get(key) ?? 0) + 1); }
  const messages = [...persisted];
  for (const record of records) {
    if (record.type !== "message_end" || !record.message) continue;
    const key = fingerprint(record.message), count = counts.get(key) ?? 0;
    if (count) counts.set(key, count - 1); else messages.push(record.message);
  }
  return messages;
}

export function summarizeUsage(records) {
  const operations = completedMessages(records).filter(message => message.usage).map(message => ({
    kind: message.role === "assistant" ? "assistant" : "tool", provider: message.provider, model: message.model, usage: message.usage,
  }));
  const compactionCopies = new Map();
  const compactionKey = value => JSON.stringify([value.summary, value.firstKeptEntryId, value.tokensBefore, value.usage]);
  const seen = new Set();
  for (const record of records) {
    if (!["compaction", "branch_summary", "usage"].includes(record.type) || !record.usage) continue;
    if (record.id && seen.has(record.id)) continue;
    if (record.id) seen.add(record.id);
    if (record.type === "compaction") {
      const key = compactionKey(record); compactionCopies.set(key, (compactionCopies.get(key) ?? 0) + 1);
    }
    operations.push({ kind: record.type === "usage" ? `usage:${record.kind ?? "unknown"}` : record.type,
      provider: record.provider, model: record.model, usage: record.usage });
  }
  for (const event of records) {
    if (event.type !== "compaction_end" || event.aborted || !event.result?.usage) continue;
    const key = compactionKey(event.result), count = compactionCopies.get(key) ?? 0;
    if (count) compactionCopies.set(key, count - 1);
    else operations.push({ kind: "compaction", usage: event.result.usage });
  }
  const totals = emptyUsage(), byKind = Object.create(null), byModel = Object.create(null);
  for (const operation of operations) {
    addUsage(totals, operation.usage);
    byKind[operation.kind] ??= { operations: 0, ...emptyUsage() };
    byKind[operation.kind].operations++;
    addUsage(byKind[operation.kind], operation.usage);
    const route = operation.provider && operation.model ? `${operation.provider}/${operation.model}` : "unattributed";
    byModel[route] ??= { operations: 0, ...emptyUsage() };
    byModel[route].operations++;
    addUsage(byModel[route], operation.usage);
  }
  return { totals, byKind, byModel, operations: operations.length };
}
