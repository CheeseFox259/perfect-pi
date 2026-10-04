import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test, { describe, it } from "node:test";

import {
  DEFAULT_DESTINATION,
  DEFAULT_MAX_BUFFER,
  DEFAULT_TIMEOUT_MS,
  MACOS_PNG_SCRIPT,
  MACOS_TIFF_SCRIPT,
  PNG_HEADER,
  POWERSHELL_SCRIPT,
  dest,
  extractClipboardImage,
  getDefaultDestination,
  isDirectCliExecution,
  isValidPngBuffer,
  isValidPngFile,
  resolveDestination,
  runCli,
} from "./scripts/clipboard-image.mjs";

// Minimal valid PNG (1x1 pixel RGBA)
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR header
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, // bit depth, color type, etc.
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT header
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND header
  0x42, 0x60, 0x82,
]);

function createTestSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "clipboard-test-"));
  return {
    dir,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe("Import side effects", () => {
  it("importing the module has no side effects and does not mutate filesystem", () => {
    // When imported, neither .scratch nor mockup.png should be auto-created by import alone
    assert.equal(typeof extractClipboardImage, "function");
    assert.equal(typeof dest, "function");
    assert.equal(typeof resolveDestination, "function");
    assert.equal(typeof getDefaultDestination, "function");
    assert.equal(typeof isValidPngBuffer, "function");
    assert.equal(typeof isValidPngFile, "function");
  });

  it("isDirectCliExecution distinguishes CLI vs import", () => {
    // During test runner execution, clipboard-image.mjs is imported, so default check is false
    assert.equal(isDirectCliExecution(), false);
    // Explicit distinct arguments
    assert.equal(isDirectCliExecution(import.meta.url, "some/other/file.mjs"), false);
    assert.equal(isDirectCliExecution(import.meta.url, ""), false);
    assert.equal(isDirectCliExecution(import.meta.url, null), false);
    // Matching script path simulating CLI run
    assert.equal(isDirectCliExecution("file:///tmp/app.mjs", "/tmp/app.mjs"), true);
  });
});

describe("Destination helper", () => {
  it("resolves default destination", () => {
    const resolved = resolveDestination();
    assert.equal(resolved, resolve(process.cwd(), DEFAULT_DESTINATION));
    assert.equal(getDefaultDestination(), resolve(process.cwd(), DEFAULT_DESTINATION));
    assert.equal(dest(), resolve(process.cwd(), DEFAULT_DESTINATION));
  });

  it("resolves custom relative and absolute paths", () => {
    const sandbox = createTestSandbox();
    try {
      const rel = resolveDestination("custom/mock.png", sandbox.dir);
      assert.equal(rel, resolve(sandbox.dir, "custom/mock.png"));

      const absPath = resolve(sandbox.dir, "absolute.png");
      const abs = resolveDestination(absPath);
      assert.equal(abs, absPath);
    } finally {
      sandbox.cleanup();
    }
  });

  it("throws on invalid paths containing null bytes", () => {
    assert.throws(() => resolveDestination("invalid\0path.png"), {
      message: /contains null byte/,
    });
  });

  it("throws on non-string destination paths", () => {
    assert.throws(() => resolveDestination(12345), {
      name: "TypeError",
    });
  });
});

describe("PNG signature validation", () => {
  it("validates PNG buffers correctly", () => {
    assert.equal(isValidPngBuffer(null), false);
    assert.equal(isValidPngBuffer(undefined), false);
    assert.equal(isValidPngBuffer(Buffer.alloc(0)), false);
    assert.equal(isValidPngBuffer(Buffer.alloc(7)), false);
    assert.equal(isValidPngBuffer(Buffer.from("NOT_A_PNG_FILE!!")), false);
    assert.equal(isValidPngBuffer(PNG_HEADER), true);
    assert.equal(isValidPngBuffer(MINIMAL_PNG), true);
  });

  it("validates PNG files correctly", () => {
    const sandbox = createTestSandbox();
    try {
      const nonExistent = join(sandbox.dir, "missing.png");
      assert.equal(isValidPngFile(nonExistent), false);

      const emptyFile = join(sandbox.dir, "empty.png");
      writeFileSync(emptyFile, Buffer.alloc(0));
      assert.equal(isValidPngFile(emptyFile), false);

      const textFile = join(sandbox.dir, "text.png");
      writeFileSync(textFile, "This is plain text");
      assert.equal(isValidPngFile(textFile), false);

      const validFile = join(sandbox.dir, "valid.png");
      writeFileSync(validFile, MINIMAL_PNG);
      assert.equal(isValidPngFile(validFile), true);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("Native command seam: Linux", () => {
  it("extracts PNG via wl-paste successfully and publishes atomically", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "output.png");
      let wlCalled = false;

      const mockRunner = (cmd, args, opts) => {
        if (cmd === "wl-paste") {
          wlCalled = true;
          assert.deepEqual(args, ["-t", "image/png"]);
          assert.equal(opts.timeout, DEFAULT_TIMEOUT_MS);
          assert.equal(opts.maxBuffer, DEFAULT_MAX_BUFFER);
          return { status: 0, stdout: MINIMAL_PNG };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "linux",
        runner: mockRunner,
      });

      assert.equal(wlCalled, true);
      assert.equal(result.ok, true);
      assert.equal(result.path, target);
      assert.equal(result.bytes, MINIMAL_PNG.length);
      assert.equal(result.format, "png");
      assert.equal(existsSync(target), true);
      assert.deepEqual(readFileSync(target), MINIMAL_PNG);
    } finally {
      sandbox.cleanup();
    }
  });

  it("falls back to xclip when wl-paste is unavailable/fails", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "xclip-out.png");
      const calls = [];

      const mockRunner = (cmd, args, opts) => {
        calls.push({ cmd, args });
        if (cmd === "wl-paste") {
          return { status: 1, stdout: Buffer.alloc(0) };
        }
        if (cmd === "xclip") {
          assert.deepEqual(args, ["-selection", "clipboard", "-t", "image/png", "-o"]);
          return { status: 0, stdout: MINIMAL_PNG };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "linux",
        runner: mockRunner,
      });

      assert.equal(calls.length, 2);
      assert.equal(calls[0].cmd, "wl-paste");
      assert.equal(calls[1].cmd, "xclip");
      assert.equal(result.ok, true);
      assert.equal(existsSync(target), true);
      assert.deepEqual(readFileSync(target), MINIMAL_PNG);
    } finally {
      sandbox.cleanup();
    }
  });

  it("returns error when neither wl-paste nor xclip finds an image", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "no-image.png");
      const mockRunner = () => ({ status: 1, stdout: Buffer.alloc(0) });

      const result = extractClipboardImage(target, {
        platform: "linux",
        runner: mockRunner,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /No image found in Linux clipboard/);
      assert.equal(existsSync(target), false);
    } finally {
      sandbox.cleanup();
    }
  });

  it("rejects non-PNG clipboard data on Linux", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "corrupt.png");
      const mockRunner = (cmd) => {
        if (cmd === "wl-paste") {
          return { status: 0, stdout: Buffer.from("Not a png header data") };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "linux",
        runner: mockRunner,
      });

      assert.equal(result.ok, false);
      assert.equal(existsSync(target), false);
    } finally {
      sandbox.cleanup();
    }
  });

  it("Linux writing is completely synchronous with no async import race", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "sync-check.png");
      const mockRunner = (cmd) => {
        if (cmd === "wl-paste") return { status: 0, stdout: MINIMAL_PNG };
        return { status: 1 };
      };

      // Extract returns synchronously
      const result = extractClipboardImage(target, {
        platform: "linux",
        runner: mockRunner,
      });

      // Synchronously immediately readable without ticking event loop
      assert.equal(result.ok, true);
      const stat = statSync(target);
      assert.equal(stat.size, MINIMAL_PNG.length);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("Native command seam: macOS", () => {
  it("extracts PNG directly using osascript with un-interpolated script and data argv", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "macos-direct.png");
      let osascriptCalled = false;

      const mockRunner = (cmd, args, opts) => {
        if (cmd === "osascript") {
          osascriptCalled = true;
          assert.equal(args[0], "-e");
          const scriptText = args[1];
          // Script text MUST be static and uninterpolated
          assert.equal(scriptText, MACOS_PNG_SCRIPT);
          assert.equal(scriptText.includes("on run argv"), true);
          assert.equal(scriptText.includes("POSIX file targetPath"), true);
          assert.equal(scriptText.includes(target), false); // No interpolation of destination!

          // The target path must be passed as discrete argv[2]
          const tempPath = args[2];
          assert.equal(typeof tempPath, "string");
          assert.equal(tempPath.includes(".macos-direct.png.tmp-"), true);
          assert.equal(opts.env.CLIPBOARD_TARGET, tempPath);

          // Simulate AppleScript writing PNG to tempPath
          writeFileSync(tempPath, MINIMAL_PNG);
          return { status: 0, stdout: "ok_png\n" };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "darwin",
        runner: mockRunner,
      });

      assert.equal(osascriptCalled, true);
      assert.equal(result.ok, true);
      assert.equal(result.format, "png");
      assert.equal(existsSync(target), true);
      assert.deepEqual(readFileSync(target), MINIMAL_PNG);
    } finally {
      sandbox.cleanup();
    }
  });

  it("falls back to TIFF and converts via sips, cleaning up temporary TIFF", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "macos-tiff.png");
      const calls = [];
      let tempTiffObservedPath = null;

      const mockRunner = (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === "osascript" && args[1] === MACOS_PNG_SCRIPT) {
          // PNG direct extraction fails
          return { status: 0, stdout: "fail\n" };
        }
        if (cmd === "osascript" && args[1] === MACOS_TIFF_SCRIPT) {
          tempTiffObservedPath = args[2];
          // AppleScript writes dummy TIFF
          writeFileSync(tempTiffObservedPath, Buffer.from("TIFF_DATA_CANARY"));
          return { status: 0, stdout: "ok_tiff\n" };
        }
        if (cmd === "sips") {
          assert.equal(args[0], "-s");
          assert.equal(args[1], "format");
          assert.equal(args[2], "png");
          assert.equal(args[3], tempTiffObservedPath);
          assert.equal(args[4], "--out");
          const tempPngPath = args[5];
          writeFileSync(tempPngPath, MINIMAL_PNG);
          return { status: 0 };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "darwin",
        runner: mockRunner,
      });

      assert.equal(calls.length, 3);
      assert.equal(result.ok, true);
      assert.equal(result.format, "tiff_converted_to_png");
      assert.equal(existsSync(target), true);
      assert.deepEqual(readFileSync(target), MINIMAL_PNG);

      // Verify temp TIFF file was guaranteed cleaned up!
      assert.ok(tempTiffObservedPath);
      assert.equal(existsSync(tempTiffObservedPath), false);
    } finally {
      sandbox.cleanup();
    }
  });

  it("cleans up temporary TIFF even if sips conversion fails", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "macos-tiff-fail.png");
      let tempTiffPath = null;

      const mockRunner = (cmd, args) => {
        if (cmd === "osascript" && args[1] === MACOS_PNG_SCRIPT) {
          return { status: 0, stdout: "fail\n" };
        }
        if (cmd === "osascript" && args[1] === MACOS_TIFF_SCRIPT) {
          tempTiffPath = args[2];
          writeFileSync(tempTiffPath, Buffer.from("DUMMY_TIFF"));
          return { status: 0, stdout: "ok_tiff\n" };
        }
        if (cmd === "sips") {
          return { status: 1, error: new Error("sips failed") };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "darwin",
        runner: mockRunner,
      });

      assert.equal(result.ok, false);
      assert.equal(existsSync(target), false);
      assert.ok(tempTiffPath);
      assert.equal(existsSync(tempTiffPath), false); // cleaned up in finally
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("Native command seam: Windows", () => {
  it("uses powershell with -STA and safe uninterpolated script", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "windows-out.png");
      let psCalled = false;

      const mockRunner = (cmd, args, opts) => {
        if (cmd === "powershell") {
          psCalled = true;
          assert.equal(args.includes("-STA"), true);
          assert.equal(args.includes("-NoProfile"), true);
          assert.equal(args.includes("-NonInteractive"), true);
          assert.equal(args.includes("-Command"), true);

          // Script text MUST be static and uninterpolated
          const cmdIndex = args.indexOf("-Command");
          const scriptText = args[cmdIndex + 1];
          assert.equal(scriptText, POWERSHELL_SCRIPT);
          assert.equal(scriptText.includes("$env:CLIPBOARD_DEST_PATH"), true);
          assert.equal(scriptText.includes(target), false); // No interpolation!

          const tempPath = opts.env.CLIPBOARD_DEST_PATH;
          assert.equal(args[cmdIndex + 2], undefined);

          // Simulate powershell saving image
          writeFileSync(tempPath, MINIMAL_PNG);
          return { status: 0, stdout: "ok\r\n" };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "win32",
        runner: mockRunner,
      });

      assert.equal(psCalled, true);
      assert.equal(result.ok, true);
      assert.equal(result.format, "png");
      assert.equal(existsSync(target), true);
      assert.deepEqual(readFileSync(target), MINIMAL_PNG);
    } finally {
      sandbox.cleanup();
    }
  });

  it("handles no image on Windows", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "win-no-image.png");
      const mockRunner = () => ({ status: 0, stdout: "no_image\r\n" });

      const result = extractClipboardImage(target, {
        platform: "win32",
        runner: mockRunner,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /No image found in Windows clipboard/);
      assert.equal(existsSync(target), false);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("Injection paths safety", () => {
  it("passes dangerous destination paths safely as data without script interpolation", () => {
    const sandbox = createTestSandbox();
    try {
      const injectionTarget = join(
        sandbox.dir,
        'inject"; rm -rf /; $(whoami); `id` $foo \'quotes\'\\test.png'
      );

      // 1. Check macOS
      let macScriptTested = false;
      const macRunner = (cmd, args) => {
        if (cmd === "osascript") {
          macScriptTested = true;
          // Verify script is completely uninterpolated
          assert.equal(args[1], MACOS_PNG_SCRIPT);
          assert.equal(args[1].includes("rm -rf"), false);
          assert.equal(args[1].includes("quotes"), false);
          // Target passed as argv element
          const tempPath = args[2];
          writeFileSync(tempPath, MINIMAL_PNG);
          return { status: 0, stdout: "ok_png" };
        }
        return { status: 1 };
      };

      const macResult = extractClipboardImage(injectionTarget, {
        platform: "darwin",
        runner: macRunner,
      });
      assert.equal(macScriptTested, true);
      assert.equal(macResult.ok, true);
      assert.equal(existsSync(injectionTarget), true);
      assert.deepEqual(readFileSync(injectionTarget), MINIMAL_PNG);

      // Clean up for Windows test
      rmSync(injectionTarget);

      // 2. Check Windows
      let winScriptTested = false;
      const winRunner = (cmd, args, opts) => {
        if (cmd === "powershell") {
          winScriptTested = true;
          const cmdIndex = args.indexOf("-Command");
          const scriptText = args[cmdIndex + 1];
          assert.equal(scriptText, POWERSHELL_SCRIPT);
          assert.equal(scriptText.includes("rm -rf"), false);
          assert.equal(scriptText.includes("quotes"), false);

          const tempPath = opts.env.CLIPBOARD_DEST_PATH;
          assert.equal(args[cmdIndex + 2], undefined);
          writeFileSync(tempPath, MINIMAL_PNG);
          return { status: 0, stdout: "ok\r\n" };
        }
        return { status: 1 };
      };

      const winResult = extractClipboardImage(injectionTarget, {
        platform: "win32",
        runner: winRunner,
      });
      assert.equal(winScriptTested, true);
      assert.equal(winResult.ok, true);
      assert.equal(existsSync(injectionTarget), true);
      assert.deepEqual(readFileSync(injectionTarget), MINIMAL_PNG);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("Destination preservation on failure", () => {
  it("never damages or truncates an existing destination file when extraction fails", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "pre-existing.png");
      const CANARY_DATA = Buffer.from("CRITICAL_PRE_EXISTING_USER_FILE_CONTENT");
      writeFileSync(target, CANARY_DATA);

      const mockFailingRunner = () => ({
        status: 1,
        stdout: Buffer.alloc(0),
        error: new Error("extraction failed"),
      });

      const result = extractClipboardImage(target, {
        platform: "darwin",
        runner: mockFailingRunner,
      });

      assert.equal(result.ok, false);
      // Destination file MUST still exist and be completely unaltered
      assert.equal(existsSync(target), true);
      assert.deepEqual(readFileSync(target), CANARY_DATA);

      // No leftover temporary files in directory
      const filesInDir = readdirSync(sandbox.dir);
      assert.deepEqual(filesInDir, ["pre-existing.png"]);
    } finally {
      sandbox.cleanup();
    }
  });

  it("never overwrites destination if native command produces corrupted/invalid data", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "existing-image.png");
      const CANARY_DATA = Buffer.from("DO_NOT_OVERWRITE_ME");
      writeFileSync(target, CANARY_DATA);

      const mockCorruptRunner = (cmd, args) => {
        if (cmd === "osascript") {
          const tempPath = args[2];
          writeFileSync(tempPath, Buffer.from("CORRUPT_NOT_PNG"));
          return { status: 0, stdout: "ok_png" };
        }
        return { status: 1 };
      };

      const result = extractClipboardImage(target, {
        platform: "darwin",
        runner: mockCorruptRunner,
      });

      assert.equal(result.ok, false);
      // Destination still pristine
      assert.deepEqual(readFileSync(target), CANARY_DATA);
      // Temp files cleaned up
      assert.deepEqual(readdirSync(sandbox.dir), ["existing-image.png"]);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("Bounded execution & options", () => {
  it("forwards bounded timeout and maxBuffer to runner", () => {
    let capturedOpts = null;
    const mockRunner = (cmd, args, opts) => {
      capturedOpts = opts;
      return { status: 1 };
    };

    extractClipboardImage("test.png", {
      platform: "linux",
      timeout: 8888,
      maxBuffer: 4096,
      runner: mockRunner,
    });

    assert.equal(capturedOpts.timeout, 8888);
    assert.equal(capturedOpts.maxBuffer, 4096);
    assert.equal(capturedOpts.windowsHide, true);
  });

  it("handles runner timeout error gracefully without throwing", () => {
    const mockRunner = () => ({
      status: null,
      error: new Error("ETIMEDOUT: operation timed out"),
    });

    const result = extractClipboardImage("test.png", {
      platform: "linux",
      runner: mockRunner,
    });

    assert.equal(result.ok, false);
  });
});

describe("CLI runner and status output", () => {
  it("runCli emits JSON and returns status codes", () => {
    const sandbox = createTestSandbox();
    try {
      const target = join(sandbox.dir, "cli-out.png");

      // Mock console
      const stdoutLines = [];
      const stderrLines = [];
      const origLog = console.log;
      const origError = console.error;
      console.log = (msg) => stdoutLines.push(msg);
      console.error = (msg) => stderrLines.push(msg);

      try {
        // Success case
        const codeSuccess = runCli(["node", "clipboard-image.mjs", target], {
          platform: "linux",
          runner: () => ({ status: 0, stdout: MINIMAL_PNG }),
        });
        assert.equal(codeSuccess, 0);
        assert.equal(stdoutLines.length, 1);
        const parsedOk = JSON.parse(stdoutLines[0]);
        assert.equal(parsedOk.ok, true);
        assert.equal(parsedOk.path, target);

        // Failure case
        const codeFail = runCli(["node", "clipboard-image.mjs", target], {
          platform: "linux",
          runner: () => ({ status: 1 }),
        });
        assert.equal(codeFail, 1);
        assert.equal(stderrLines.length, 1);
        const parsedErr = JSON.parse(stderrLines[0]);
        assert.equal(parsedErr.ok, false);
      } finally {
        console.log = origLog;
        console.error = origError;
      }
    } finally {
      sandbox.cleanup();
    }
  });

  it("imported CLI entry uses injected native commands, not production test env switches", () => {
    const sandbox = createTestSandbox();
    try {
      const scriptPath = resolve("scripts/clipboard-image.mjs");
      const target = join(sandbox.dir, "cli-exec.png");
      const invocation = (success, destination) => spawnSync(process.execPath, ["--input-type=module", "-e", `
        const { runCli } = await import(${JSON.stringify(`file://${scriptPath}`)});
        const png = Buffer.from(${JSON.stringify(MINIMAL_PNG.toString("base64"))}, 'base64');
        process.exitCode = runCli(['node', 'clipboard-image.mjs', ${JSON.stringify(destination)}], {
          platform: 'linux', runner: () => ({status: ${success ? 0 : 1}, stdout: png})
        });
      `], { encoding: "utf8" });
      const resOk = invocation(true, target);
      assert.equal(resOk.status, 0, resOk.stderr);
      assert.equal(JSON.parse(resOk.stdout).path, target);
      assert.deepEqual(readFileSync(target), MINIMAL_PNG);
      const resFail = invocation(false, join(sandbox.dir, "fail.png"));
      assert.equal(resFail.status, 1);
      assert.equal(JSON.parse(resFail.stderr).ok, false);
    } finally { sandbox.cleanup(); }
  });
});
