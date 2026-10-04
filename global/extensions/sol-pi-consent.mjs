/**
 * Session-scoped consent state for the SoL-Pi reducer.
 *
 * Consent is granted once per session via Ctrl+Shift+P palette or the first
 * interactive TUI prompt, and does NOT inherit to subagents or new sessions.
 *
 * This module is plain JS to allow imports from test files and the command
 * palette without needing the Pi TypeScript loader.
 */

/** @type {Map<string, boolean>} */
let consentMap = new Map();

/** Check whether the reducer is authorized for the given session. */
export function isReducerAuthorized(sessionId) {
  return consentMap.get(sessionId) === true;
}

/** Grant reducer authorization for the given session. */
export function authorizeReducer(sessionId) {
  consentMap.set(sessionId, true);
}

/** Reset all consent state (called on new session_start generation). */
export function resetReducerConsent() {
  consentMap = new Map();
}
