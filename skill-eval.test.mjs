import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const skillCreatorDir = join(root, "skills", "skill-creator");

function setupTestEnvironment(t) {
  const tempDir = mkdtempSync(join(tmpdir(), "skill-eval-test-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const fakeBinDir = join(tempDir, "bin");
  mkdirSync(fakeBinDir, { recursive: true });
  const fakePiPath = join(fakeBinDir, "fake-pi.mjs");
  const fakePiWrapper = join(fakeBinDir, "pi");
  const logFile = join(tempDir, "pi-invocations.jsonl");

  // Create fake pi CLI child
  const fakePiScript = `#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_PI_LOG;

let stdinData = "";
if (args.includes("--no-tools") && args.includes("--no-context-files")) {
  try {
    stdinData = fs.readFileSync(0, "utf8");
  } catch {}
}

if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify({ args, stdin: stdinData, time: Date.now() }) + "\\n");
}

// 1. Description improvement mode
if (args.includes("--no-tools") && args.includes("--no-skills") && args.includes("--no-context-files")) {
  process.stdout.write("<new_description>Improved description from fake pi</new_description>\\n");
  process.exit(0);
}

// Extract query and skillDir for evaluation mode
const skillIdx = args.indexOf("--skill");
const skillDir = skillIdx !== -1 ? args[skillIdx + 1] : "";
const query = args[args.length - 1] || "";

// Empty / malformed stream must never count as a clean negative.
if (query.includes("__EMPTY__")) process.exit(0);
if (query.includes("__GARBAGE__")) { process.stdout.write("not-json"); process.exit(0); }

// 2. Timeout case
if (query.includes("__TIMEOUT__")) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  process.exit(0);
}

// 3. Process crash / exit code error
if (query.includes("__PROCESS_ERROR__")) {
  process.stderr.write("Fatal engine crash\\n");
  process.exit(137);
}

// 4. API / provider error
if (query.includes("__API_ERROR__")) {
  const event = {
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "Rate limit exceeded on provider API"
    }
  };
  process.stdout.write(JSON.stringify(event) + "\\n");
  process.exit(0);
}

// 5. Fast exit on trigger
if (query.includes("__FAST_EXIT__")) {
  const event = {
    type: "tool_execution_start",
    toolCallId: "tc_fast",
    toolName: "read",
    args: { path: \`\${skillDir}/SKILL.md\` }
  };
  const ended = { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } };
  process.stdout.write(JSON.stringify(event) + "\\n" + JSON.stringify(ended));
  process.exit(0);
}

// 6. Final no-newline on trigger
if (query.includes("__NO_NEWLINE__")) {
  const event = {
    type: "tool_execution_start",
    toolCallId: "tc_nonewline",
    toolName: "read",
    args: { path: \`\${skillDir}/SKILL.md\` }
  };
  // Explicitly omit trailing newline, retaining a real assistant completion.
  const ended = { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } };
  process.stdout.write(JSON.stringify(ended) + "\\n" + JSON.stringify(event));
  process.exit(0);
}

// 7. Mismatch read (reading a different file, not candidate skill)
if (query.includes("__MISMATCH_READ__")) {
  const event1 = {
    type: "tool_execution_start",
    toolCallId: "tc_mismatch",
    toolName: "read",
    args: { path: "package.json" }
  };
  const event2 = {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", name: "read", arguments: { path: "package.json" } }],
      stopReason: "stop"
    }
  };
  process.stdout.write(JSON.stringify(event1) + "\\n" + JSON.stringify(event2) + "\\n");
  process.exit(0);
}

// 8. Positive trigger (reading exact candidate skill)
if (query.includes("__POSITIVE__")) {
  const event1 = {
    type: "tool_execution_start",
    toolCallId: "tc_pos",
    toolName: "read",
    args: { path: \`\${skillDir}/SKILL.md\` }
  };
  const event2 = {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", name: "read", arguments: { path: \`\${skillDir}/SKILL.md\` } }],
      stopReason: "stop"
    }
  };
  process.stdout.write(JSON.stringify(event1) + "\\n" + JSON.stringify(event2) + "\\n");
  process.exit(0);
}

// 9. Negative trigger (clean completion, no skill read)
const cleanEnd = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "Answering without skill invocation." }],
    stopReason: "stop"
  }
};
process.stdout.write(JSON.stringify(cleanEnd) + "\\n");
process.exit(0);
`;

  writeFileSync(fakePiPath, fakePiScript);
  chmodSync(fakePiPath, 0o755);

  writeFileSync(fakePiWrapper, `#!/bin/sh\nexec node "${fakePiPath}" "$@"\n`);
  chmodSync(fakePiWrapper, 0o755);

  const env = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: "1",
    PATH: `${fakeBinDir}:${process.env.PATH}`,
    PI_BIN: fakePiWrapper,
    FAKE_PI_LOG: logFile,
  };

  // Sample skill directory for testing
  const sampleSkillDir = join(tempDir, "sample-skill");
  mkdirSync(sampleSkillDir, { recursive: true });
  writeFileSync(
    join(sampleSkillDir, "SKILL.md"),
    `---\nname: sample-skill\ndescription: A test sample skill for evaluations\n---\n# Sample Skill\n`
  );

  return { tempDir, fakePiWrapper, logFile, sampleSkillDir, env };
}

function runPython(code, env) {
  const res = spawnSync("python3", ["-c", code], {
    env,
    encoding: "utf8",
    cwd: root,
  });
  if (res.status !== 0) {
    throw new Error(`Python script failed (${res.status}):\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  }
  return res.stdout.trim();
}

test("1. Final no-newline: parses complete buffered event without trailing newline", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query

res = run_single_query(
    query="__NO_NEWLINE__ test prompt",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
)
print(json.dumps(res))
`;
  const output = runPython(code, env);
  const result = JSON.parse(output);
  assert.equal(result.triggered, true, "Must detect trigger from final event without newline");
  assert.equal(result.error, null, "Must have no error");
});

test("2. Fast exit: captures buffered events on immediate process termination", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query

res = run_single_query(
    query="__FAST_EXIT__ immediate exit",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
)
print(json.dumps(res))
`;
  const output = runPython(code, env);
  const result = JSON.parse(output);
  assert.equal(result.triggered, true, "Must capture buffered event on fast exit");
  assert.equal(result.error, null, "Must have no error");
});

test("3. API error: identifies provider error and fails run_eval without rewarding negatives", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query, run_eval

single = run_single_query(
    query="__API_ERROR__ trigger failure",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
)

# Test run_eval with should_trigger=False
eval_set = [{"query": "__API_ERROR__ near miss query", "should_trigger": False}]
batch = run_eval(
    eval_set=eval_set,
    skill_name="sample-skill",
    description="sample description",
    num_workers=1,
    timeout=5,
    project_root=Path('${sampleSkillDir}'),
)
print(json.dumps({"single": single, "batch": batch}))
`;
  const output = runPython(code, env);
  const { single, batch } = JSON.parse(output);

  // In single query
  assert.equal(single.triggered, false);
  assert.equal(single.error_type, "api");
  assert.match(single.error, /Rate limit exceeded/);

  // In batch eval: must NOT reward negative
  const queryResult = batch.results[0];
  assert.equal(queryResult.should_trigger, false);
  assert.equal(queryResult.pass, false, "Errors must NOT be rewarded as negative passes");
  assert.equal(batch.summary.passed, 0);
  assert.equal(batch.summary.failed, 1);
  assert.equal(batch.summary.has_errors, true);
});

test("4. Timeout: child process killed, distinguished from negative, fails run_eval", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query, run_eval

single = run_single_query(
    query="__TIMEOUT__ hanging query",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=1,
    project_root='${sampleSkillDir}',
)

eval_set = [{"query": "__TIMEOUT__ hanging query", "should_trigger": False}]
batch = run_eval(
    eval_set=eval_set,
    skill_name="sample-skill",
    description="sample description",
    num_workers=1,
    timeout=1,
    project_root=Path('${sampleSkillDir}'),
)
print(json.dumps({"single": single, "batch": batch}))
`;
  const output = runPython(code, env);
  const { single, batch } = JSON.parse(output);

  assert.equal(single.triggered, false);
  assert.equal(single.error_type, "timeout");
  assert.match(single.error, /timed out/);

  const queryResult = batch.results[0];
  assert.equal(queryResult.should_trigger, false);
  assert.equal(queryResult.pass, false, "Timeouts must NOT be counted as passing negative triggers");
  assert.equal(batch.summary.has_errors, true);
});

test("5. Mismatch read: reading arbitrary or other file does not trigger candidate skill", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query, run_eval

single = run_single_query(
    query="__MISMATCH_READ__ package inspection",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
)

eval_set = [
    {"query": "__MISMATCH_READ__ should trigger", "should_trigger": True},
    {"query": "__MISMATCH_READ__ should not trigger", "should_trigger": False}
]
batch = run_eval(
    eval_set=eval_set,
    skill_name="sample-skill",
    description="sample description",
    num_workers=1,
    timeout=5,
    project_root=Path('${sampleSkillDir}'),
)
print(json.dumps({"single": single, "batch": batch}))
`;
  const output = runPython(code, env);
  const { single, batch } = JSON.parse(output);

  assert.equal(single.triggered, false, "Reading package.json must not trigger candidate skill");
  assert.equal(single.error, null);

  const pos = batch.results.find((r) => r.should_trigger === true);
  const neg = batch.results.find((r) => r.should_trigger === false);

  assert.equal(pos.pass, false, "Positive eval should fail when candidate skill was not read");
  assert.equal(neg.pass, true, "Negative eval passes when clean non-skill read occurred");
});

test("6. Negative trigger: clean assistant answer without skill passes negative eval", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query, run_eval

single = run_single_query(
    query="__NEGATIVE__ standard query",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
)

eval_set = [{"query": "__NEGATIVE__ clean query", "should_trigger": False}]
batch = run_eval(
    eval_set=eval_set,
    skill_name="sample-skill",
    description="sample description",
    num_workers=1,
    timeout=5,
    project_root=Path('${sampleSkillDir}'),
)
print(json.dumps({"single": single, "batch": batch}))
`;
  const output = runPython(code, env);
  const { single, batch } = JSON.parse(output);

  assert.equal(single.triggered, false);
  assert.equal(single.error, null);
  assert.equal(batch.results[0].pass, true);
  assert.equal(batch.summary.passed, 1);
  assert.equal(batch.summary.has_errors, false);
});

test("7. Positive trigger: reading candidate SKILL.md registers as triggered and passes", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query, run_eval

single = run_single_query(
    query="__POSITIVE__ target query",
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
)

eval_set = [{"query": "__POSITIVE__ target query", "should_trigger": True}]
batch = run_eval(
    eval_set=eval_set,
    skill_name="sample-skill",
    description="sample description",
    num_workers=1,
    timeout=5,
    project_root=Path('${sampleSkillDir}'),
)
print(json.dumps({"single": single, "batch": batch}))
`;
  const output = runPython(code, env);
  const { single, batch } = JSON.parse(output);

  assert.equal(single.triggered, true);
  assert.equal(single.error, null);
  assert.equal(batch.results[0].pass, true);
  assert.equal(batch.summary.passed, 1);
  assert.equal(batch.summary.has_errors, false);
});

test("8. CLI arguments: verifies --tools read, --no-skills, safe '--' separator, and model propagation", (t) => {
  const { sampleSkillDir, logFile, env } = setupTestEnvironment(t);
  const queryWithDash = "-v --custom-flag arbitrary query";

  const code = `
import sys
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.run_eval import run_single_query

run_single_query(
    query=${JSON.stringify(queryWithDash)},
    skill_name="sample-skill",
    skill_description="sample description",
    timeout=5,
    project_root='${sampleSkillDir}',
    model="test-claude-model",
)
`;
  runPython(code, env);

  const logs = readFileSync(logFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(logs.length >= 1, "Must have logged pi CLI invocation");
  const invocation = logs[logs.length - 1];
  const args = invocation.args;

  // Verify read-only tool allowlist
  const toolsIdx = args.indexOf("--tools");
  assert.notEqual(toolsIdx, -1, "Must pass --tools flag");
  assert.equal(args[toolsIdx + 1], "read", "Must restrict tools to read only (no mutating tools)");

  // Verify isolation
  assert.ok(args.includes("--no-skills"), "Must pass --no-skills to isolate competing installed skills");

  // Verify ephemeral non-interactive
  assert.ok(args.includes("-p"), "Must pass -p");
  assert.ok(args.includes("--no-session"), "Must pass --no-session");
  assert.ok(args.includes("--mode") && args[args.indexOf("--mode") + 1] === "json", "Must pass --mode json");

  // Verify model propagation
  const modelIdx = args.indexOf("--model");
  assert.notEqual(modelIdx, -1, "Must propagate model");
  assert.equal(args[modelIdx + 1], "test-claude-model");

  // Verify safe argument separator '--' before query starting with '-'
  const sepIdx = args.indexOf("--");
  assert.notEqual(sepIdx, -1, "Must use '--' argument separator before query");
  assert.equal(args[sepIdx + 1], queryWithDash, "Query must follow '--' separator");
});

test("9. Improvement script: passes --no-tools, --no-skills, --no-context-files with prompt on stdin", (t) => {
  const { sampleSkillDir, logFile, env } = setupTestEnvironment(t);
  const code = `
import sys
from pathlib import Path
sys.path.insert(0, '${skillCreatorDir}')
from scripts.improve_description import improve_description

eval_results = {
    "results": [{"query": "q1", "should_trigger": True, "pass": False, "triggers": 0, "runs": 1}],
    "summary": {"passed": 0, "total": 1, "pass_rate": 0.0}
}
new_desc = improve_description(
    skill_name="sample-skill",
    skill_content="Sample skill content",
    current_description="Old description",
    eval_results=eval_results,
    history=[],
    model="custom-opt-model",
)
print(new_desc)
`;
  const output = runPython(code, env);
  assert.equal(output, "Improved description from fake pi");

  const logs = readFileSync(logFile, "utf8").trim().split("\n").map(JSON.parse);
  const invocation = logs[logs.length - 1];
  const args = invocation.args;

  assert.ok(args.includes("--no-tools"), "Must pass --no-tools to prevent command execution from embedded prompts");
  assert.ok(args.includes("--no-skills"), "Must pass --no-skills");
  assert.ok(args.includes("--no-context-files"), "Must pass --no-context-files");

  const modelIdx = args.indexOf("--model");
  assert.notEqual(modelIdx, -1);
  assert.equal(args[modelIdx + 1], "custom-opt-model");

  assert.ok(invocation.stdin.length > 100, "Prompt must be delivered via stdin");
  assert.ok(invocation.stdin.includes("Sample skill content"));
});

test("empty or malformed event stream fails instead of passing a negative", (t) => {
  const { sampleSkillDir, env } = setupTestEnvironment(t);
  const code = `
import sys, json
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(skillCreatorDir)})
from scripts.run_eval import run_eval
result = run_eval([{"query": "__EMPTY__", "should_trigger": False}, {"query": "__GARBAGE__", "should_trigger": False}], "sample", "test", 1, 5, Path(${JSON.stringify(sampleSkillDir)}))
print(json.dumps(result))
`;
  const result = JSON.parse(runPython(code, env));
  assert.equal(result.summary.has_errors, true);
  assert.equal(result.summary.passed, 0);
});

test("active session model is inherited unless explicitly overridden", (t) => {
  const { env } = setupTestEnvironment(t);
  const code = `
import sys, json
sys.path.insert(0, ${JSON.stringify(skillCreatorDir)})
from scripts.utils import session_model
print(json.dumps([session_model(), session_model("other/selected")]))
`;
  const result = JSON.parse(runPython(code, { ...env, PI_PROVIDER: "cpa", PI_MODEL: "gemini-3.8-flash-high" }));
  assert.deepEqual(result, ["cpa/gemini-3.8-flash-high", "other/selected"]);
});

test("10. CLI execution: scripts.run_eval exits 1 on errors and produces valid JSON output", (t) => {
  const { tempDir, sampleSkillDir, env } = setupTestEnvironment(t);
  const evalSetFile = join(tempDir, "eval_set.json");
  writeFileSync(
    evalSetFile,
    JSON.stringify([
      { query: "__API_ERROR__ query", should_trigger: false },
      { query: "__POSITIVE__ query", should_trigger: true },
    ])
  );

  const res = spawnSync(
    "python3",
    [
      "-m",
      "scripts.run_eval",
      evalSetFile,
      "--skill-path",
      sampleSkillDir,
      "--timeout",
      "5",
    ],
    {
      cwd: skillCreatorDir,
      env,
      encoding: "utf8",
    }
  );

  assert.equal(res.status, 1, "Must exit with status 1 when eval has errors or failures");
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.summary.has_errors, true);
  assert.equal(parsed.results.length, 2);
});
