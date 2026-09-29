import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(import.meta.dirname, path), "utf8");
const setup = read("skills/setup-matt-pocock-skills/SKILL.md");
const spec = read("skills/to-spec/SKILL.md");
const tickets = read("skills/to-tickets/SKILL.md");
const implement = read("skills/implement-spec/SKILL.md");
const route = read("skills/route/SKILL.md");
const manifest = JSON.parse(read("manifest.json"));
const registry = JSON.parse(read("components.json"));

const fields = ["Triage", "Execution", "Claimed by", "Branch", "Blocked by", "Verified commit", "Last attempt"];

test("implementation ticket producers and consumer share the local contract", () => {
  for (const field of fields) {
    assert.match(setup, new RegExp(`${field}:`), `setup missing ${field}`);
    assert.match(tickets, new RegExp(`${field}:`), `to-tickets missing ${field}`);
    assert.match(implement, new RegExp(field), `implement-spec missing ${field}`);
  }
  assert.match(tickets, /Execution: open/);
  assert.match(implement, /complete.*verified|verified.*complete/is);
  assert.match(implement, /Last attempt:[^\n]*run-id/);
  assert.match(setup, /wayfinder.*Status: claimed\|resolved/);
});

test("deferred work is routed before immediate small implementation", () => {
  const deferred = route.indexOf("Direction agreed, explicitly deferred");
  const immediate = route.indexOf("Work to do now, fits one session");
  assert.ok(deferred >= 0 && immediate > deferred);
  assert.match(spec, /## Acceptance criteria/);
  assert.match(spec, /## Testing decision/);
  assert.doesNotMatch(spec, /A LONG, numbered list/);
});

test("new overrides are registered and upstream copies are hidden", () => {
  for (const name of ["to-spec", "to-tickets"]) {
    assert.equal(registry.skills[name].type, "override");
    assert.ok(manifest.skillPolicy.shadowedOverrides.includes(name));
  }
  const implementer = read("global/agents/implementer.md");
  assert.equal(registry.agents.implementer.localPath, "global/agents/implementer.md");
  assert.match(implementer, /name: implementer/);
  assert.doesNotMatch(implementer, /^model:/m);
  assert.match(implement, /managed `implementer` role/);
});
