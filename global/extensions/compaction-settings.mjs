export const DEFAULT_COMPACTION_MODEL = Object.freeze({ provider: "cpa", model: "gemini-3.8-flash-high" });
export const COMPACTION_SETTING = "perfectPiCompaction";

export function resolveCompactionModel(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Global settings must be a JSON object");
  }
  const value = Object.hasOwn(settings, COMPACTION_SETTING) ? settings[COMPACTION_SETTING] : DEFAULT_COMPACTION_MODEL;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.provider !== "string" || !value.provider.trim()
    || typeof value.model !== "string" || !value.model.trim()) {
    throw new Error(`${COMPACTION_SETTING} requires non-empty provider and model strings`);
  }
  return { provider: value.provider.trim(), model: value.model.trim() };
}

export function parseModelRoute(route) {
  const slash = route.indexOf("/");
  if (slash < 1 || slash === route.length - 1) throw new Error("Use provider/modelId");
  return resolveCompactionModel({ [COMPACTION_SETTING]: { provider: route.slice(0, slash), model: route.slice(slash + 1) } });
}

function parseSettingsText(text) {
  if (text === undefined || text.trim() === "") return {};
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Global settings must be a JSON object");
  return parsed;
}

export function readCompactionModel(storage) {
  let model;
  storage.withLock("global", (text) => {
    model = resolveCompactionModel(parseSettingsText(text));
    return undefined;
  });
  return model;
}

export function writeCompactionModel(storage, model) {
  const validated = resolveCompactionModel({ [COMPACTION_SETTING]: model });
  storage.withLock("global", (text) => {
    const settings = parseSettingsText(text);
    return `${JSON.stringify({ ...settings, [COMPACTION_SETTING]: validated }, null, 2)}\n`;
  });
  return validated;
}
