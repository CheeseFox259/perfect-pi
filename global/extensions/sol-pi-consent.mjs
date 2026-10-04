/** Session and route scoped decisions. Pending prompts are cancellable and shared. */
const defaultRoute = "cpa/gemini-3.8-flash-high";
const decisions = new Map();
const prompts = new Map();
const keyOf = (sessionId, route) => JSON.stringify([sessionId, route]);

export function reducerDecision(sessionId, route = defaultRoute) {
  return decisions.get(keyOf(sessionId, route));
}

export function isReducerAuthorized(sessionId, route = defaultRoute) {
  return reducerDecision(sessionId, route) === true;
}

export function authorizeReducer(sessionId, route = defaultRoute) {
  decisions.set(keyOf(sessionId, route), true);
}

export function denyReducer(sessionId, route = defaultRoute) {
  decisions.set(keyOf(sessionId, route), false);
}

export function requestReducerConsent(sessionId, prompt, { route = defaultRoute, signal, timeout = 60_000 } = {}) {
  const key = keyOf(sessionId, route);
  if (prompts.has(key)) return prompts.get(key).promise;
  if (signal?.aborted) return Promise.resolve(undefined);
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer;
  let onAbort;
  const cancelled = new Promise((resolve) => {
    onAbort = () => resolve(undefined);
    combined.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => controller.abort(), timeout);
  });
  const pending = {
    controller,
    promise: Promise.race([cancelled, Promise.resolve().then(() => combined.aborted ? undefined : prompt(combined))])
      .finally(() => {
        clearTimeout(timer);
        combined.removeEventListener("abort", onAbort);
        if (prompts.get(key) === pending) prompts.delete(key);
      }),
  };
  prompts.set(key, pending);
  return pending.promise;
}

export function resetReducerConsent(sessionId) {
  for (const [key, pending] of prompts) {
    if (sessionId === undefined || JSON.parse(key)[0] === sessionId) {
      pending.controller.abort();
      prompts.delete(key);
    }
  }
  for (const key of decisions.keys()) {
    if (sessionId === undefined || JSON.parse(key)[0] === sessionId) decisions.delete(key);
  }
}
