#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { platform as osPlatform } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DESTINATION = ".scratch/mockup.png";
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_BUFFER = 25 * 1024 * 1024; // 25 MB

export const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validates whether a buffer begins with the 8-byte PNG signature.
 * @param {Buffer|Uint8Array} buffer
 * @returns {boolean}
 */
export function isValidPngBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 8) {
    return false;
  }
  return buffer.subarray(0, 8).equals(PNG_HEADER);
}

/**
 * Validates whether an existing file begins with the 8-byte PNG signature.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isValidPngFile(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    if (stat.size < 8) return false;
    const fd = openSync(filePath, "r");
    try {
      const header = Buffer.alloc(8);
      const bytesRead = readSync(fd, header, 0, 8, 0);
      return bytesRead === 8 && header.equals(PNG_HEADER);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Resolves destination path safely relative to base directory.
 * @param {string} [target]
 * @param {string} [basePath=process.cwd()]
 * @returns {string}
 */
export function resolveDestination(target, basePath = process.cwd()) {
  const raw = target || DEFAULT_DESTINATION;
  if (typeof raw !== "string") {
    throw new TypeError("Destination path must be a string");
  }
  if (raw.includes("\0")) {
    throw new Error("Invalid destination path: contains null byte");
  }
  return resolve(basePath, raw);
}

export const dest = resolveDestination;
export const getDefaultDestination = (basePath = process.cwd()) =>
  resolveDestination(DEFAULT_DESTINATION, basePath);

export const MACOS_PNG_SCRIPT = `on run argv
set targetPath to (item 1 of argv)
set theFile to (POSIX file targetPath)
try
  set imgData to (the clipboard as «class PNGf»)
  set fp to open for access theFile with write permission
  try
    set eof fp to 0
    write imgData to fp
    close access fp
    return "ok_png"
  on error
    try
      close access fp
    end try
    return "fail"
  end try
on error
  return "fail"
end try
end run`;

export const MACOS_TIFF_SCRIPT = `on run argv
set targetPath to (item 1 of argv)
set theFile to (POSIX file targetPath)
try
  set imgData to (the clipboard as «class TIFF»)
  set fp to open for access theFile with write permission
  try
    set eof fp to 0
    write imgData to fp
    close access fp
    return "ok_tiff"
  on error
    try
      close access fp
    end try
    return "fail"
  end try
on error
  return "fail"
end try
end run`;

export const POWERSHELL_SCRIPT = `
$dest = $env:CLIPBOARD_DEST_PATH
if (-not $dest) {
  Write-Error "No destination path provided"
  exit 2
}
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $img.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "ok"
} else {
  Write-Output "no_image"
}
`;

function extractMacOS(tempPath, tempTiffPath, options) {
  const { runner, timeout, maxBuffer } = options;

  // 1. Direct PNG extraction
  const resPng = runner("osascript", ["-e", MACOS_PNG_SCRIPT, tempPath], {
    timeout,
    maxBuffer,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, CLIPBOARD_TARGET: tempPath },
  });

  if (resPng && !resPng.error && resPng.status === 0) {
    const out = String(resPng.stdout || "").trim();
    if (out === "ok_png" && isValidPngFile(tempPath)) {
      return { ok: true, format: "png" };
    }
  }

  // 2. TIFF extraction + conversion via native sips
  try {
    const resTiff = runner("osascript", ["-e", MACOS_TIFF_SCRIPT, tempTiffPath], {
      timeout,
      maxBuffer,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, CLIPBOARD_TARGET: tempTiffPath },
    });

    if (resTiff && !resTiff.error && resTiff.status === 0) {
      const out = String(resTiff.stdout || "").trim();
      if (out === "ok_tiff" && existsSync(tempTiffPath) && statSync(tempTiffPath).size > 0) {
        const resSips = runner(
          "sips",
          ["-s", "format", "png", tempTiffPath, "--out", tempPath],
          {
            timeout,
            maxBuffer,
            windowsHide: true,
            stdio: "ignore",
          }
        );
        if (resSips && !resSips.error && resSips.status === 0 && isValidPngFile(tempPath)) {
          return { ok: true, format: "tiff_converted_to_png" };
        }
      }
    }
  } finally {
    if (existsSync(tempTiffPath)) {
      try {
        unlinkSync(tempTiffPath);
      } catch {}
    }
  }

  return {
    ok: false,
    error: "No image found in system clipboard (expected PNG or TIFF data)",
  };
}

function extractLinux(tempPath, options) {
  const { runner, timeout, maxBuffer } = options;

  let stdoutBuffer = null;

  // Try wl-paste first (Wayland)
  const wl = runner("wl-paste", ["-t", "image/png"], {
    timeout,
    maxBuffer,
    windowsHide: true,
  });

  if (wl && !wl.error && wl.status === 0 && wl.stdout && wl.stdout.length > 0) {
    const buf = Buffer.isBuffer(wl.stdout) ? wl.stdout : Buffer.from(wl.stdout);
    if (isValidPngBuffer(buf)) {
      stdoutBuffer = buf;
    }
  }

  // Try xclip fallback (X11)
  if (!stdoutBuffer) {
    const xc = runner(
      "xclip",
      ["-selection", "clipboard", "-t", "image/png", "-o"],
      {
        timeout,
        maxBuffer,
        windowsHide: true,
      }
    );

    if (xc && !xc.error && xc.status === 0 && xc.stdout && xc.stdout.length > 0) {
      const buf = Buffer.isBuffer(xc.stdout) ? xc.stdout : Buffer.from(xc.stdout);
      if (isValidPngBuffer(buf)) {
        stdoutBuffer = buf;
      }
    }
  }

  if (!stdoutBuffer) {
    return {
      ok: false,
      error: "No image found in Linux clipboard (requires xclip or wl-paste)",
    };
  }

  // Synchronous write to temp file
  writeFileSync(tempPath, stdoutBuffer);

  if (isValidPngFile(tempPath)) {
    return { ok: true, format: "png" };
  }

  return {
    ok: false,
    error: "Extracted clipboard data is not a valid PNG image",
  };
}

function extractWindows(tempPath, options) {
  const { runner, timeout, maxBuffer } = options;

  const res = runner(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-Command",
      POWERSHELL_SCRIPT,
    ],
    {
      timeout,
      maxBuffer,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, CLIPBOARD_DEST_PATH: tempPath },
    }
  );

  if (res && !res.error && res.status === 0) {
    const out = String(res.stdout || "");
    if (out.includes("ok") && isValidPngFile(tempPath)) {
      return { ok: true, format: "png" };
    }
  }

  return {
    ok: false,
    error: "No image found in Windows clipboard",
  };
}

/**
 * Extracts clipboard image safely to the target path.
 *
 * @param {string|object} [targetOrOptions] - Target path or options object
 * @param {object} [maybeOptions] - Options if target path was supplied as first arg
 * @returns {{ ok: true, path: string, bytes: number, format: string } | { ok: false, error: string }}
 */
export function extractClipboardImage(targetOrOptions, maybeOptions) {
  let target;
  let options;
  if (typeof targetOrOptions === "object" && targetOrOptions !== null) {
    options = { ...targetOrOptions };
    target = options.dest ?? options.target;
  } else {
    target = targetOrOptions;
    options = { ...(maybeOptions ?? {}) };
  }

  let destPath;
  try {
    destPath = resolveDestination(target, options.basePath);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const currentPlatform = options.platform || osPlatform();
  const runner = options.runner || spawnSync;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

  try {
    mkdirSync(dirname(destPath), { recursive: true });
  } catch (err) {
    return { ok: false, error: `Failed to create destination directory: ${err.message}` };
  }

  const randomPart =
    typeof randomUUID === "function"
      ? randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePrefix = `.${basename(destPath)}.tmp-${process.pid}-${randomPart}`;
  const tempPath = resolve(dirname(destPath), `${filePrefix}.png`);
  const tempTiffPath = resolve(dirname(destPath), `${filePrefix}.tiff`);

  const execOptions = {
    ...options,
    runner,
    timeout,
    maxBuffer,
    platform: currentPlatform,
  };

  try {
    let outcome;
    if (currentPlatform === "darwin") {
      outcome = extractMacOS(tempPath, tempTiffPath, execOptions);
    } else if (currentPlatform === "linux") {
      outcome = extractLinux(tempPath, execOptions);
    } else if (currentPlatform === "win32") {
      outcome = extractWindows(tempPath, execOptions);
    } else {
      outcome = { ok: false, error: `Unsupported OS platform: ${currentPlatform}` };
    }

    if (!outcome.ok) {
      return outcome;
    }

    if (!isValidPngFile(tempPath)) {
      return { ok: false, error: "Extracted clipboard data is not a valid PNG image" };
    }

    // Atomic publication via rename
    renameSync(tempPath, destPath);
    const size = statSync(destPath).size;
    return {
      ok: true,
      path: destPath,
      bytes: size,
      format: outcome.format,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {}
    }
    if (existsSync(tempTiffPath)) {
      try {
        unlinkSync(tempTiffPath);
      } catch {}
    }
  }
}

/**
 * Checks whether this file is being executed directly as CLI script.
 */
export function isDirectCliExecution(metaUrl = import.meta.url, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    const scriptPath = fileURLToPath(metaUrl);
    const invokedPath = resolve(argv1);
    if (invokedPath === scriptPath) return true;
    try {
      return realpathSync(invokedPath) === realpathSync(scriptPath);
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * CLI runner function.
 * @param {string[]} [argv=process.argv]
 * @param {object} [options={}]
 * @returns {number} exit code (0 or 1)
 */
export function runCli(argv = process.argv, options = {}) {
  const target = argv[2];
  const outcome = extractClipboardImage(target, options);
  if (outcome.ok) {
    console.log(JSON.stringify(outcome, null, 2));
    return 0;
  } else {
    console.error(JSON.stringify(outcome, null, 2));
    return 1;
  }
}

if (isDirectCliExecution()) {
  const exitCode = runCli(process.argv);
  process.exit(exitCode);
}
