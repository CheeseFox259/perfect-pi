import assert from "node:assert/strict";
import test from "node:test";
import { checkPiCompatibility } from "./scripts/check-pi-compatibility.mjs";
import { checkPiUpdates, classifyPiUpdate } from "./scripts/check-pi-updates.mjs";

test("actual Pi public APIs, settings bridge and all extensions load", async () => {
  const report = await checkPiCompatibility();
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.ok(report.verified.includes("storage:FileSettingsStorage.withLock"));
  assert.ok(report.verified.some(value => value.endsWith("compaction-model.ts")));
});

test("Pi version drift is distinct from API compatibility", async () => {
  const report = await checkPiCompatibility({ manifest: { piVersion: "0.0.1" } });
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.versionMatchesBaseline, false);
});

test("stable update discovery classifies patches, minors and majors without changing pins", async () => {
  assert.deepEqual(classifyPiUpdate("1.0.2", "1.0.2"), { baseline: "1.0.2", latest: "1.0.2", updateAvailable: false, kind: "none" });
  assert.equal(classifyPiUpdate("1.0.2", "1.0.3").kind, "patch");
  assert.equal(classifyPiUpdate("1.0.2", "1.1.0").kind, "minor");
  assert.equal(classifyPiUpdate("1.9.9", "2.0.0").kind, "major");
  assert.equal(classifyPiUpdate("2.0.0", "1.9.9").updateAvailable, false);
  assert.throws(() => classifyPiUpdate("1.0.2", "1.1.0-beta.1"));
  const manifest = { piVersion: "1.0.2" };
  const report = await checkPiUpdates({ manifest, latest: "1.0.3" });
  assert.equal(report.updateAvailable, true); assert.equal(manifest.piVersion, "1.0.2");
});
