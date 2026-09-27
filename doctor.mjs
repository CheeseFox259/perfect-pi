#!/usr/bin/env node
import { inspect } from "./setup.mjs";

const report = await inspect();
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Perfect Pi doctor: ${report.ok ? "SYNCED" : "DRIFTED"}`);
  for (const [name, item] of Object.entries(report.statuses)) {
    console.log(`${item.status.padEnd(8)} ${name}${item.detail ? ` (${item.detail})` : ""}`);
  }
  console.log(`Source: ${report.source}`);
  console.log(`Live:   ${report.agentDir}`);
}
process.exitCode = report.ok ? 0 : 1;
