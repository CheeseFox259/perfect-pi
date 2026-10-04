import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

// Use the installed Pi runtime, including its jiti aliases and real TUI components.
// No source rewriting, copied handlers, network access, or live configuration.
let piEntry;
try {
  piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  const globalRoot = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
  piEntry = join(globalRoot, "@earendil-works/pi-coding-agent/dist/index.js");
}
const { loadExtensions } = await import(pathToFileURL(join(dirname(piEntry), "core/extensions/loader.js")));
const piRequire = createRequire(piEntry);
const { CURSOR_MARKER } = await import(pathToFileURL(piRequire.resolve("@earendil-works/pi-tui")));
const root = import.meta.dirname;
const loaded = await loadExtensions(
  ["command-palette", "questionnaire", "question"].map((name) => join(root, `global/extensions/${name}.ts`)),
  root,
);
assert.deepEqual(loaded.errors, [], "extensions must load through Pi's actual loader");
const [palette, questionnaireExtension, questionExtension] = loaded.extensions;
const questionnaire = questionnaireExtension.tools.get("questionnaire").definition;
const question = questionExtension.tools.get("question").definition;

const key = { down: "\x1b[B", up: "\x1b[A", left: "\x1b[D", right: "\x1b[C", enter: "\r", esc: "\x1b", tab: "\t", backtab: "\x1b[Z" };
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };

function uiContext({ scripts = [], inputs = [], editorText = "", mode = "tui", hasUI = mode === "tui" || mode === "rpc" } = {}) {
  const messages = [];
  const notifications = [];
  let customCalls = 0;
  loaded.runtime.sendUserMessage = (text, options) => messages.push({ text, options });
  const ctx = {
    mode,
    hasUI,
    ui: {
      getEditorText: () => editorText,
      setEditorText: (value) => { editorText = value; },
      notify: (message, type) => notifications.push({ message, type }),
      async input() {
        assert.ok(inputs.length, "unexpected input dialog");
        return inputs.shift();
      },
      async custom(factory) {
        customCalls++;
        assert.ok(scripts.length, "unexpected terminal UI (or invalid input reached UI)");
        let settled = false;
        let result;
        const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
        const component = await factory(tui, theme, {}, (value) => {
          assert.equal(settled, false, "UI must only resolve once");
          settled = true;
          result = value;
        });
        component.focused = true;
        const screen = () => component.render(80).join("\n");
        const press = (...keys) => {
          for (const data of keys) {
            assert.equal(settled, false, "input after UI completion");
            component.handleInput(data);
            screen();
          }
        };
        try {
          screen();
          const script = scripts.shift();
          if (Array.isArray(script)) press(...script);
          else script({ component, screen, press, settled: () => settled });
          assert.ok(settled, "interaction left the UI unresolved");
          return result;
        } finally {
          component.dispose?.();
        }
      },
    },
  };
  return { ctx, messages, notifications, get customCalls() { return customCalls; } };
}

const choosePalette = (index) => [...Array(index).fill(key.down), key.enter];
const runPalette = (ui) => palette.commands.get("palette").handler("", ui.ctx);
const runTool = (tool, params, ui) => tool.execute("test-call", params, undefined, undefined, ui.ctx);
const options = [{ value: "small", label: "Small" }, { value: "large", label: "Large" }];
const questionParams = { question: "Choose scope", options };
const scopeQuestion = { id: "scope", prompt: "Choose scope", options };
const questionnaireParams = { questions: [scopeQuestion] };

for (const mode of ["rpc", "json", "print"]) {
  test(`palette command and shortcut avoid terminal UI in ${mode} mode`, async () => {
    const ui = uiContext({ mode });
    await runPalette(ui);
    await palette.shortcuts.values().next().value.handler(ui.ctx);
    assert.equal(ui.customCalls, 0);
    assert.deepEqual(ui.messages, []);
  });

  for (const [tool, params] of [[question, questionParams], [questionnaire, questionnaireParams]]) {
    test(`${tool.name} returns a usable fallback in ${mode} mode`, async () => {
      const ui = uiContext({ mode });
      const result = await runTool(tool, params, ui);
      assert.equal(ui.customCalls, 0);
      assert.match(result.content[0].text, /UI not available/);
      if (tool === question) assert.equal(result.details.answer, null);
      else assert.deepEqual(result.details.answers, []);
    });
  }
}

test("all three extensions handle unavailable UI even in a TUI context", async () => {
  const ui = uiContext({ hasUI: false });
  await runPalette(ui);
  for (const [tool, params] of [[question, questionParams], [questionnaire, questionnaireParams]]) {
    const result = await runTool(tool, params, ui);
    assert.match(result.content[0].text, /UI not available/);
  }
  assert.equal(ui.customCalls, 0);
});
const workflowActions = [
  { label: "Spec", index: 2, command: "/skill:to-spec" },
];

for (const action of workflowActions) {
  test(`${action.label}: cancelled input sends no message`, async () => {
    for (const cancellation of [undefined, null]) {
      const ui = uiContext({ scripts: [choosePalette(action.index)], inputs: [cancellation] });
      await runPalette(ui);
      assert.deepEqual(ui.messages, []);
    }
  });

  test(`${action.label}: empty input uses the conversation; references are trimmed`, async () => {
    for (const [input, expected] of [["", action.command], ["  ", action.command], ["  docs/spec.md  ", `${action.command} docs/spec.md`]]) {
      const ui = uiContext({ scripts: [choosePalette(action.index)], inputs: [input] });
      await runPalette(ui);
      assert.deepEqual(ui.messages, [{ text: expected, options: { expandPromptTemplates: true } }]);
    }
  });
}

// Tickets and Implement spec use SelectList-based spec discovery
const selectWorkflowActions = [
  { label: "Tickets", index: 3, command: "/skill:to-tickets" },
  { label: "Implement spec", index: 4, command: "/skill:implement-spec" },
];

for (const action of selectWorkflowActions) {
  test(`${action.label}: cancelled selection sends no message`, async () => {
    const ui = uiContext({ scripts: [choosePalette(action.index), [key.esc]] });
    await runPalette(ui);
    assert.deepEqual(ui.messages, []);
  });

  test(`${action.label}: conversation selection, custom ref, and editor bypass`, async () => {
    // Select "Use current conversation" (first item)
    let ui = uiContext({ scripts: [choosePalette(action.index), [key.enter]] });
    await runPalette(ui);
    assert.deepEqual(ui.messages, [{ text: action.command, options: { expandPromptTemplates: true } }]);

    // Select "Type a path..." (second item since no .scratch exists) then enter ref
    ui = uiContext({ scripts: [choosePalette(action.index), [key.down, key.enter]], inputs: ["  docs/spec.md  "] });
    await runPalette(ui);
    assert.deepEqual(ui.messages, [{ text: `${action.command} docs/spec.md`, options: { expandPromptTemplates: true } }]);

    // Editor text bypasses selection entirely
    ui = uiContext({ scripts: [choosePalette(action.index)], editorText: "  my-spec.md  " });
    await runPalette(ui);
    assert.deepEqual(ui.messages, [{ text: `${action.command} my-spec.md`, options: { expandPromptTemplates: true } }]);
  });
}

for (const [label, index] of [["Route", 0], ["Grill", 1]]) {
  test(`${label}: cancelled or empty input sends no message`, async () => {
    for (const input of [undefined, null, "", "   "]) {
      const ui = uiContext({ scripts: [choosePalette(index)], inputs: [input] });
      await runPalette(ui);
      assert.deepEqual(ui.messages, []);
    }
  });
}

test("palette cancellation and editor-supplied task", async () => {
  const cancelled = uiContext({ scripts: [[key.esc]] });
  await runPalette(cancelled);
  assert.deepEqual(cancelled.messages, []);
  const ui = uiContext({ scripts: [choosePalette(0)], editorText: "  fix login  " });
  await runPalette(ui);
  assert.deepEqual(ui.messages, [{ text: "/skill:route fix login", options: { expandPromptTemplates: true } }]);
  assert.equal(ui.ctx.ui.getEditorText(), "");
});

test("palette model, thinking and settings submenus can be cancelled", async () => {
  const ui = uiContext({ scripts: [choosePalette(11), [key.esc], choosePalette(12), [key.esc], choosePalette(14), [key.esc]] });
  ui.ctx.modelRegistry = { getAvailable: () => [{ provider: "test", id: "one", name: "One" }] };
  loaded.runtime.getThinkingLevel = () => "low";
  await runPalette(ui);
  await runPalette(ui);
  await runPalette(ui);
  assert.deepEqual(ui.messages, []);
});

test("palette MCP settings prepares extension commands instead of queuing them", async () => {
  for (const [index, command] of [[2, "/mcp-key"], [3, "/mcp"], [4, "/mcp-setup"]]) {
    const ui = uiContext({ scripts: [choosePalette(14), [...Array(index).fill(key.down), key.enter]] });
    await runPalette(ui);
    assert.deepEqual(ui.messages, []); assert.equal(ui.ctx.ui.getEditorText(), command);
  }
});

test("palette settings opens global compaction model command", async () => {
  const ui = uiContext({ scripts: [choosePalette(14), [key.down, key.enter]] });
  await runPalette(ui);
  assert.deepEqual(ui.messages, [{ text: "/compaction-model", options: { expandPromptTemplates: true } }]);
});

test("question selection, custom response, amendment and cancellation", async () => {
  for (const [script, answer, wasCustom] of [
    [[key.enter], "Small", false],
    [[key.down, key.down, key.enter, "C", "u", "s", "t", "o", "m", key.enter], "Custom", true],
    [["e", "!", key.enter], "Small !", true],
  ]) {
    const result = await runTool(question, questionParams, uiContext({ scripts: [script] }));
    assert.equal(result.details.answer, answer);
    assert.equal(result.details.wasCustom, wasCustom);
  }
  const cancelled = await runTool(question, questionParams, uiContext({ scripts: [[key.esc]] }));
  assert.equal(cancelled.details.answer, null);
});

test("questionnaire rejects empty questions, impossible choices and duplicate IDs before UI", async () => {
  for (const [params, error] of [
    [{ questions: [] }, /No questions/],
    [{ questions: [{ ...scopeQuestion, options: [], allowOther: false }] }, /No options/],
    [{ questions: [scopeQuestion, { ...scopeQuestion, prompt: "Again" }] }, /Duplicate.*id/i],
  ]) {
    const ui = uiContext();
    const result = await runTool(questionnaire, params, ui);
    assert.match(result.content[0].text, error);
    assert.equal(result.details.cancelled, true);
    assert.deepEqual(result.details.answers, []);
    assert.equal(ui.customCalls, 0);
  }
});

test("questionnaire supports a no-options custom answer, amendment, selection and cancellation", async () => {
  const custom = await runTool(questionnaire, { questions: [{ ...scopeQuestion, options: [] }] }, uiContext({ scripts: [[key.enter, "Y", "e", "s", key.enter]] }));
  assert.deepEqual(custom.details.answers.map(({ value, wasCustom }) => ({ value, wasCustom })), [{ value: "Yes", wasCustom: true }]);
  const noOptionsAmend = await runTool(questionnaire, { questions: [{ ...scopeQuestion, options: [] }] }, uiContext({ scripts: [["e", "N", "o", key.enter]] }));
  assert.equal(noOptionsAmend.details.answers[0].value, "No");
  assert.equal(noOptionsAmend.details.answers[0].wasCustom, true);
  const amended = await runTool(questionnaire, questionnaireParams, uiContext({ scripts: [["e", "!", key.enter]] }));
  assert.equal(amended.details.answers[0].value, "Small !");
  assert.equal(amended.details.answers[0].wasCustom, true);
  const selected = await runTool(questionnaire, questionnaireParams, uiContext({ scripts: [[key.down, key.enter]] }));
  assert.equal(selected.details.answers[0].value, "large");
  assert.equal(selected.details.answers[0].index, 2);
  const cancelled = await runTool(questionnaire, questionnaireParams, uiContext({ scripts: [[key.esc]] }));
  assert.equal(cancelled.details.cancelled, true);
});

test("questionnaire multi-question navigation, submit gate and cancellation", async () => {
  const params = { questions: [scopeQuestion, { id: "priority", prompt: "Priority?", options: [{ value: "now", label: "Now" }] }] };
  const submitted = await runTool(questionnaire, params, uiContext({ scripts: [[key.tab, key.tab, key.enter, key.left, key.enter, key.left, key.left, key.enter, key.tab, key.enter]] }));
  assert.equal(submitted.details.cancelled, false);
  assert.deepEqual(submitted.details.answers.map(({ id, value }) => ({ id, value })), [
    { id: "priority", value: "now" }, { id: "scope", value: "small" },
  ]);
  const cancelled = await runTool(questionnaire, params, uiContext({ scripts: [[key.enter, key.esc]] }));
  assert.equal(cancelled.details.cancelled, true);
  assert.equal(cancelled.details.answers.length, 1);
});

test("questionnaire and question handle undefined custom UI result as cancellation", async () => {
  const uiQ = uiContext();
  uiQ.ctx.ui.custom = async () => undefined;
  const qResult = await runTool(question, questionParams, uiQ);
  assert.equal(qResult.details.answer, null);
  assert.match(qResult.content[0].text, /cancelled/i);

  const uiQn = uiContext();
  uiQn.ctx.ui.custom = async () => undefined;
  const qnResult = await runTool(questionnaire, questionnaireParams, uiQn);
  assert.equal(qnResult.details.cancelled, true);
  assert.deepEqual(qnResult.details.answers, []);
  assert.match(qnResult.content[0].text, /cancelled/i);
});

test("all three extensions guard against missing ctx.ui.custom in TUI mode", async () => {
  const ui = uiContext({ mode: "tui", hasUI: true });
  delete ui.ctx.ui.custom;
  await runPalette(ui);
  assert.equal(ui.customCalls, 0);
  assert.deepEqual(ui.messages, []);

  for (const [tool, params] of [[question, questionParams], [questionnaire, questionnaireParams]]) {
    const result = await runTool(tool, params, ui);
    assert.match(result.content[0].text, /UI not available/);
  }
});

test("question and questionnaire propagate focus to editor and render CURSOR_MARKER while editing", async () => {
  let questionMarkerSeen = false;
  await runTool(question, questionParams, uiContext({
    scripts: [({ screen, press }) => {
      press("e");
      questionMarkerSeen = screen().includes(CURSOR_MARKER);
      press(key.enter);
    }],
  }));
  assert.equal(questionMarkerSeen, true, "question must emit CURSOR_MARKER when focused in edit mode");

  let questionnaireMarkerSeen = false;
  await runTool(questionnaire, questionnaireParams, uiContext({
    scripts: [({ screen, press }) => {
      press("e");
      questionnaireMarkerSeen = screen().includes(CURSOR_MARKER);
      press(key.enter);
    }],
  }));
  assert.equal(questionnaireMarkerSeen, true, "questionnaire must emit CURSOR_MARKER when focused in edit mode");
});
