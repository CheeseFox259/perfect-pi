import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as fs from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export const DEFAULT_ROUTE = "cpa/gemini-3.8-flash-high";
export const MIN_TOKENS_SAVED = 2000;

const activePhases = new Map();

export function keyOf(sessionId, route = DEFAULT_ROUTE) {
  return JSON.stringify([sessionId ?? "default", route ?? DEFAULT_ROUTE]);
}

function isSafeRelativePattern(pattern) {
  if (typeof pattern !== "string" || pattern.trim() === "") return false;
  if (isAbsolute(pattern)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(pattern)) return false;
  const parts = pattern.split(/[\\/]/);
  if (parts.includes("..")) return false;
  return true;
}

export function validatePhaseContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return false;
  }

  if (contract.version !== 1) {
    return false;
  }

  if (!contract.phases || typeof contract.phases !== "object" || Array.isArray(contract.phases)) {
    return false;
  }

  const validPolicies = new Set(["forbidden", "checkpoint_eligible", "strong_boundary", "fresh_context"]);
  const validBoundaryActions = new Set(["continue", "compact", "fresh_context", "clear"]);

  for (const [name, phase] of Object.entries(contract.phases)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || (phase?.skill !== undefined && phase.skill !== name)) return false;
    if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
      return false;
    }

    if (typeof phase.allowMidPhaseCompact !== "boolean") {
      return false;
    }

    if (typeof phase.allowBoundaryCompact !== "boolean") {
      return false;
    }

    if (phase.policy !== undefined && (typeof phase.policy !== "string" || !validPolicies.has(phase.policy))) {
      return false;
    }

    if (phase.recommendedBoundaryAction !== undefined && (typeof phase.recommendedBoundaryAction !== "string" || !validBoundaryActions.has(phase.recommendedBoundaryAction))) {
      return false;
    }

    if (phase.durabilityGate !== undefined) {
      if (!phase.durabilityGate || typeof phase.durabilityGate !== "object" || Array.isArray(phase.durabilityGate)) {
        return false;
      }

      const gate = phase.durabilityGate;

      if (gate.requiredArtifacts !== undefined) {
        if (!Array.isArray(gate.requiredArtifacts)) {
          return false;
        }
        for (const pat of gate.requiredArtifacts) {
          if (!isSafeRelativePattern(pat)) {
            return false;
          }
        }
      }

      if (gate.gitCleanOrCommitted !== undefined && typeof gate.gitCleanOrCommitted !== "boolean") {
        return false;
      }

      if (gate.failClosed !== undefined && typeof gate.failClosed !== "boolean") {
        return false;
      }
    }
  }

  if (contract.gates !== undefined) {
    if (!contract.gates || typeof contract.gates !== "object" || Array.isArray(contract.gates)) {
      return false;
    }
    for (const [, gateConfig] of Object.entries(contract.gates)) {
      if (!gateConfig || typeof gateConfig !== "object" || Array.isArray(gateConfig)) {
        return false;
      }
      if (gateConfig.minTokensSaved !== undefined && (typeof gateConfig.minTokensSaved !== "number" || !Number.isFinite(gateConfig.minTokensSaved) || gateConfig.minTokensSaved < 0)) {
        return false;
      }
      if (gateConfig.failClosed !== undefined && typeof gateConfig.failClosed !== "boolean") {
        return false;
      }
    }
  }

  return true;
}

export function loadPhaseContract(agentDir, cwd = process.cwd(), projectTrusted = false) {
  if (projectTrusted) {
    const projectContractPath = join(cwd, "skills", "ask-matt", "phase-contract.json");
    if (existsSync(projectContractPath)) {
      try {
        const raw = readFileSync(projectContractPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!validatePhaseContract(parsed)) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }
  }

  if (agentDir) {
    const managedPath = join(agentDir, "skills", "ask-matt", "phase-contract.json");
    if (existsSync(managedPath)) {
      try {
        const raw = readFileSync(managedPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!validatePhaseContract(parsed)) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function checkDurabilityGate(cwd = process.cwd(), gate, options = {}) {
  if (!gate) return true;
  const failClosed = gate.failClosed !== false;
  const feature = typeof options === "string" ? options : options?.feature;
  if (feature && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(feature)) return false;

  if (gate.requiredArtifacts !== undefined) {
    if (!Array.isArray(gate.requiredArtifacts) || gate.requiredArtifacts.length === 0) {
      if (failClosed) return false;
    } else {
      for (const rawPattern of gate.requiredArtifacts) {
        let pattern = rawPattern;
        if (!isSafeRelativePattern(pattern)) return false;
        if ((pattern.includes("{feature}") || pattern.startsWith(".scratch/*/")) && !feature) return false;
        if (feature) {
          if (pattern.includes("{feature}")) {
            pattern = pattern.replaceAll("{feature}", feature);
          } else if (pattern.startsWith(".scratch/*/")) {
            pattern = `.scratch/${feature}/${pattern.slice(".scratch/*/".length)}`;
          } else if (pattern === ".scratch/*") {
            pattern = `.scratch/${feature}`;
          }
        }

        let matches = [];
        try {
          matches = fs.globSync(pattern, { cwd });
        } catch {
          if (failClosed) return false;
          continue;
        }

        const fileMatches = matches.filter((relPath) => {
          try {
            const fullPath = join(cwd, relPath);
            const actualRelative = relative(fs.realpathSync(cwd), fs.realpathSync(fullPath));
            return actualRelative !== ".." && !actualRelative.startsWith(`..${sep}`) && !isAbsolute(actualRelative) && statSync(fullPath).isFile();
          } catch {
            return false;
          }
        });

        const scopedMatches = feature
          ? fileMatches.filter((relPath) => {
              const normalized = relPath.replace(/\\/g, "/");
              const parts = normalized.split("/");
              const scratchIdx = parts.indexOf(".scratch");
              if (scratchIdx !== -1 && scratchIdx + 1 < parts.length) {
                return parts[scratchIdx + 1] === feature;
              }
              return true;
            })
          : fileMatches;

        if (scopedMatches.length === 0) {
          if (failClosed) return false;
        }
      }
    }
  }

  if (gate.gitCleanOrCommitted === true) {
    try {
      const status = execFileSync("git", ["status", "--porcelain", "-uall"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
      });
      if (status.trim().length > 0) {
        if (failClosed) return false;
      }
    } catch {
      if (failClosed) return false;
    }
  }

  return true;
}

export function isPhaseBoundaryEligible(phase, context = {}) {
  if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
    return false;
  }

  if (!phase.skill || typeof phase.skill !== "string") {
    return false;
  }

  const isCompleted = phase.completed === true || phase.status === "completed" || context?.completed === true;
  if (!isCompleted) {
    return false;
  }

  if (context?.isBoundary === false || phase.isBoundary === false) {
    return false;
  }

  if (!phase.allowBoundaryCompact) {
    return false;
  }

  const cwd = context?.cwd || phase.cwd || process.cwd();
  const feature = context?.feature || phase.feature;
  if (phase.durabilityGate) {
    const satisfied = checkDurabilityGate(cwd, phase.durabilityGate, { feature });
    if (!satisfied) {
      return false;
    }
  }

  const minTokensSaved = context?.minTokensSaved ?? phase.durabilityGate?.minTokensSaved ?? phase.minTokensSaved ?? MIN_TOKENS_SAVED;
  const tokensSaved = context?.tokensSaved ?? context?.expectedTokensSaved ?? context?.tokenSavings ?? context?.archiveableTokensSaved;

  if (!Number.isFinite(tokensSaved) || !Number.isFinite(minTokensSaved) || tokensSaved < Math.max(MIN_TOKENS_SAVED, minTokensSaved)) {
    return false;
  }

  return true;
}

export function isMidPhaseCompactionAllowed(phase) {
  if (!phase || typeof phase !== "object") return false;
  return phase.allowMidPhaseCompact === true;
}

export function getActivePhase(sessionId, route = DEFAULT_ROUTE) {
  return activePhases.get(keyOf(sessionId, route)) ?? null;
}

export function beginPhase(sessionId, route = DEFAULT_ROUTE, phaseConfigOrSkill, options = {}) {
  let config;
  if (typeof phaseConfigOrSkill === "string") {
    if (options.contract?.phases?.[phaseConfigOrSkill]) {
      config = options.contract.phases[phaseConfigOrSkill];
    } else {
      config = {
        skill: phaseConfigOrSkill,
        policy: "forbidden",
        allowMidPhaseCompact: false,
        allowBoundaryCompact: false,
      };
    }
  } else if (phaseConfigOrSkill && typeof phaseConfigOrSkill === "object") {
    config = phaseConfigOrSkill;
  } else {
    throw new Error("Invalid phase configuration or skill name");
  }

  const phase = {
    skill: config.skill || "unknown",
    command: config.command,
    policy: config.policy || "forbidden",
    allowMidPhaseCompact: Boolean(config.allowMidPhaseCompact),
    allowBoundaryCompact: Boolean(config.allowBoundaryCompact),
    recommendedBoundaryAction: config.recommendedBoundaryAction || "continue",
    rationale: config.rationale,
    durabilityGate: config.durabilityGate,
    customInstructions: config.customInstructions,
    feature: options.feature || null,
    cwd: options.cwd || process.cwd(),
    sessionId,
    route,
    status: "in_progress",
    completed: false,
    startedAt: Date.now(),
  };

  activePhases.set(keyOf(sessionId, route), phase);
  return phase;
}

export function completePhase(sessionId, route = DEFAULT_ROUTE) {
  const phase = activePhases.get(keyOf(sessionId, route));
  if (!phase) return null;
  phase.completed = true;
  phase.status = "completed";
  phase.completedAt = Date.now();
  return phase;
}

export function clearPhase(sessionId, route = DEFAULT_ROUTE) {
  return activePhases.delete(keyOf(sessionId, route));
}

export function snapshotPhase(sessionId, route = DEFAULT_ROUTE) {
  const phase = activePhases.get(keyOf(sessionId, route));
  if (!phase) return null;
  return {
    sessionId,
    route,
    phase: structuredClone(phase),
  };
}

export function restorePhase(sessionId, route = DEFAULT_ROUTE, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (snapshot.sessionId !== undefined && snapshot.sessionId !== sessionId) {
    return null;
  }
  if (snapshot.route !== undefined && snapshot.route !== route) {
    return null;
  }
  const source = snapshot.phase || snapshot;
  if (!source || typeof source !== "object" || !source.skill) {
    return null;
  }

  const restored = {
    ...source,
    sessionId,
    route,
  };
  activePhases.set(keyOf(sessionId, route), restored);
  return restored;
}

export function resetPhaseState() {
  activePhases.clear();
}
