#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { platform } from "node:os";

const defaultDestination = ".scratch/mockup.png";
const destPath = resolve(process.argv[2] || defaultDestination);

mkdirSync(dirname(destPath), { recursive: true });

function extractMacOS(target) {
  // 1. Try direct PNG extraction
  const scriptPng = `
set theFile to (POSIX file "${target}")
try
  set imgData to (the clipboard as «class PNGf»)
  set fp to open for access theFile with write permission
  set eof fp to 0
  write imgData to fp
  close access fp
  return "ok_png"
on error
  try
    close access (POSIX file "${target}")
  end try
  return "fail"
end try
`;
  const resPng = execFileSync("osascript", ["-e", scriptPng], { encoding: "utf8" }).trim();
  if (resPng === "ok_png" && existsSync(target) && statSync(target).size > 0) {
    return { ok: true, format: "png" };
  }

  // 2. Try TIFF extraction + conversion via native sips
  const tempTiff = `${target}.tmp.tiff`;
  const scriptTiff = `
set theFile to (POSIX file "${tempTiff}")
try
  set imgData to (the clipboard as «class TIFF»)
  set fp to open for access theFile with write permission
  set eof fp to 0
  write imgData to fp
  close access fp
  return "ok_tiff"
on error
  try
    close access (POSIX file "${tempTiff}")
  end try
  return "fail"
end try
`;
  const resTiff = execFileSync("osascript", ["-e", scriptTiff], { encoding: "utf8" }).trim();
  if (resTiff === "ok_tiff" && existsSync(tempTiff) && statSync(tempTiff).size > 0) {
    try {
      execFileSync("sips", ["-s", "format", "png", tempTiff, "--out", target], { stdio: "ignore" });
      try { unlinkSync(tempTiff); } catch {}
      if (existsSync(target) && statSync(target).size > 0) {
        return { ok: true, format: "tiff_converted_to_png" };
      }
    } catch {
      try { unlinkSync(tempTiff); } catch {}
    }
  }

  return { ok: false, error: "No image found in system clipboard (expected PNG or TIFF data)" };
}

function extractLinux(target) {
  // Try wl-paste first (Wayland), then xclip (X11)
  const wl = spawnSync("wl-paste", ["-t", "image/png"], { encoding: "buffer" });
  if (wl.status === 0 && wl.stdout && wl.stdout.length > 0) {
    import("node:fs").then(({ writeFileSync }) => writeFileSync(target, wl.stdout));
    return { ok: true, format: "png" };
  }
  const xc = spawnSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], { encoding: "buffer" });
  if (xc.status === 0 && xc.stdout && xc.stdout.length > 0) {
    import("node:fs").then(({ writeFileSync }) => writeFileSync(target, xc.stdout));
    return { ok: true, format: "png" };
  }
  return { ok: false, error: "No image found in Linux clipboard (requires xclip or wl-paste)" };
}

function extractWindows(target) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $img.Save("${target.replace(/\\/g, "\\\\")}", [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "ok"
} else {
  Write-Output "no_image"
}
`;
  const res = spawnSync("powershell", ["-Command", ps], { encoding: "utf8" });
  if (res.status === 0 && res.stdout.includes("ok") && existsSync(target)) {
    return { ok: true, format: "png" };
  }
  return { ok: false, error: "No image found in Windows clipboard" };
}

let outcome;
try {
  const osType = platform();
  if (osType === "darwin") outcome = extractMacOS(destPath);
  else if (osType === "linux") outcome = extractLinux(destPath);
  else if (osType === "win32") outcome = extractWindows(destPath);
  else outcome = { ok: false, error: `Unsupported OS platform: ${osType}` };
} catch (err) {
  outcome = { ok: false, error: err.message };
}

if (outcome.ok) {
  const size = statSync(destPath).size;
  const report = { ok: true, path: destPath, bytes: size, format: outcome.format };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} else {
  console.error(JSON.stringify(outcome, null, 2));
  process.exit(1);
}
