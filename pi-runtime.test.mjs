import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPiRuntime, resolvePiRuntime, findPiEntry, piRuntimeRoots, PI_PACKAGE_NAME, runNpmReadOnly } from "./scripts/pi-runtime.mjs";

function makePkgJson(version = "1.0.0") {
  return JSON.stringify({
    name: PI_PACKAGE_NAME,
    version,
    main: "dist/index.js",
  });
}

test("npm metadata uses the Windows batch shim safely and rejects shell syntax", () => {
  const calls = [];
  const run = (...args) => { calls.push(args); return "fixture"; };
  assert.equal(runNpmReadOnly(["root", "--global"], { platform: "win32", run }), "fixture");
  assert.deepEqual(calls[0].slice(0, 2), ["cmd.exe", ["/d", "/s", "/c", "npm.cmd root --global"]]);
  runNpmReadOnly(["view", PI_PACKAGE_NAME, "version", "--json"], { platform: "darwin", run });
  assert.equal(calls[1][0], "npm");
  assert.throws(() => runNpmReadOnly(["view", "unsafe&command", "version"], { run }));
  assert.equal(calls.length, 2);
});

test("detects real installed Pi host runtime in current environment", async () => {
  const runtime = await detectPiRuntime();
  assert.ok(runtime, "Runtime should be detected in host environment");
  assert.ok(typeof runtime.version === "string" && runtime.version.length > 0);
  assert.ok(typeof runtime.root === "string" && runtime.root.includes("pi-coding-agent"));
  assert.ok(typeof runtime.entry === "string" && runtime.entry.endsWith(".js"));

  const entry = await findPiEntry();
  assert.equal(entry, runtime.entry);

  const resolved = await resolvePiRuntime();
  assert.deepEqual(resolved, runtime);
});

test("resolves runtime via PI_GLOBAL_NODE_MODULES environment variable", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-test-"));
  try {
    const pkgDir = join(tempDir, "@earendil-works", "pi-coding-agent");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), makePkgJson("9.9.1"));
    await writeFile(join(pkgDir, "dist", "index.js"), "// entry");

    const runtime = await detectPiRuntime({
      env: { PI_GLOBAL_NODE_MODULES: `/nonexistent:${tempDir}` },
      skipNpm: true,
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "9.9.1");
    assert.equal(runtime.root, pkgDir);
    assert.equal(runtime.entry, join(pkgDir, "dist", "index.js"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves runtime when PI_GLOBAL_NODE_MODULES points directly to package directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-direct-"));
  try {
    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "package.json"), makePkgJson("9.9.2"));
    await writeFile(join(tempDir, "dist", "index.js"), "// direct entry");

    const runtime = await detectPiRuntime({
      env: { PI_GLOBAL_NODE_MODULES: tempDir },
      skipNpm: true,
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "9.9.2");
    assert.equal(runtime.root, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves runtime via npm global layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-npm-"));
  try {
    const pkgDir = join(tempDir, "@earendil-works", "pi-coding-agent");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), makePkgJson("1.2.3"));
    await writeFile(join(pkgDir, "dist", "index.js"), "// npm entry");

    const runtime = await detectPiRuntime({
      npmGlobal: tempDir,
      skipNpm: false,
      env: {},
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "1.2.3");
    assert.equal(runtime.root, pkgDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves runtime via execPath prefix layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-exec-"));
  try {
    const fakeExec = join(tempDir, "bin", "node");
    const pkgDir = join(tempDir, "lib", "node_modules", "@earendil-works", "pi-coding-agent");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await mkdir(join(tempDir, "bin"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), makePkgJson("2.0.0"));
    await writeFile(join(pkgDir, "dist", "index.js"), "// exec entry");

    const runtime = await detectPiRuntime({
      execPath: fakeExec,
      env: {},
      skipNpm: true,
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "2.0.0");
    assert.equal(runtime.root, pkgDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves runtime via agent directory managed layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-agent-"));
  try {
    const pkgDir = join(tempDir, "npm", "node_modules", "@earendil-works", "pi-coding-agent");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), makePkgJson("3.1.4"));
    await writeFile(join(pkgDir, "dist", "index.js"), "// agent entry");

    const runtime = await detectPiRuntime({
      agentDir: tempDir,
      env: {},
      skipNpm: true,
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "3.1.4");
    assert.equal(runtime.root, pkgDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves runtime via Windows APPDATA layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-win-appdata-"));
  try {
    const pkgDir = join(tempDir, "npm", "node_modules", "@earendil-works", "pi-coding-agent");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), makePkgJson("4.0.0"));
    await writeFile(join(pkgDir, "dist", "index.js"), "// win entry");

    const runtime = await detectPiRuntime({
      platform: "win32",
      env: { APPDATA: tempDir },
      skipNpm: true,
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "4.0.0");
    assert.equal(runtime.root, pkgDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolves runtime via Windows ProgramFiles layout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-runtime-win-prog-"));
  try {
    const pkgDir = join(tempDir, "nodejs", "node_modules", "@earendil-works", "pi-coding-agent");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), makePkgJson("4.1.0"));
    await writeFile(join(pkgDir, "dist", "index.js"), "// win entry");

    const runtime = await detectPiRuntime({
      platform: "win32",
      env: { ProgramFiles: tempDir },
      skipNpm: true,
    });
    assert.ok(runtime);
    assert.equal(runtime.version, "4.1.0");
    assert.equal(runtime.root, pkgDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("returns null when runtime cannot be found", async () => {
  const runtime = await detectPiRuntime({
    roots: ["/nonexistent/directory/1", "/nonexistent/directory/2"],
  });
  assert.equal(runtime, null);

  const entry = await findPiEntry({
    roots: ["/nonexistent/directory/1"],
  });
  assert.equal(entry, null);
});

test("piRuntimeRoots aggregates roots and deduplicates candidates", () => {
  const roots = piRuntimeRoots({
    env: { PI_GLOBAL_NODE_MODULES: "/custom/global" },
    skipNpm: true,
    agentDir: "/custom/agent",
  });
  assert.ok(Array.isArray(roots));
  assert.ok(roots.includes("/custom/global"));
  assert.ok(roots.includes("/custom/agent"));
});
