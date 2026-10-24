#!/usr/bin/env node
// update-all.mjs - install dsh-ops-conventions into every local DSH profile
//   node update-all.mjs            # install into desktop + web
//   node update-all.mjs check      # only print installed versions
//   node update-all.mjs --pull     # git pull --ff-only first, then install both
// Notes: install.mjs copies THIS local repo into <profile>/node_modules,
// so pull the repo first if you want the newest code.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(fileURLToPath(import.meta.url));
const profilesDir = join(homedir(), ".dsh", "profiles");
const profiles = ["desktop", "web"];
const args = process.argv.slice(2);
const checkOnly = args.includes("check");
const pull = args.includes("--pull");

function installedVersion(name) {
  const p = join(profilesDir, name, "node_modules", "dsh-ops-conventions", "package.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")).version;
  } catch {
    return "unreadable";
  }
}

if (checkOnly) {
  for (const p of profiles) {
    const v = installedVersion(p);
    console.log(`${p}: ${v ? v : "NOT INSTALLED"}`);
  }
  process.exit(0);
}

if (pull) {
  console.log("git pull --ff-only ...");
  const g = spawnSync("git", ["-C", repo, "pull", "--ff-only"], { stdio: "inherit" });
  if (g.status !== 0) {
    console.error("git pull failed; aborting before install");
    process.exit(g.status ?? 1);
  }
}

let failed = 0;
for (const p of profiles) {
  const profilePath = join(profilesDir, p);
  if (!existsSync(profilePath)) {
    console.log(`skip ${p}: profile dir not found (${profilePath})`);
    continue;
  }
  console.log(`\n=== install into ${p} ===`);
  const r = spawnSync(process.execPath, [join(repo, "install.mjs"), profilePath], { stdio: "inherit" });
  if (r.status !== 0) {
    failed++;
    console.error(`install into ${p} failed (exit ${r.status})`);
  }
}

console.log("\n--- installed versions ---");
for (const p of profiles) {
  console.log(`${p}: ${installedVersion(p) ?? "NOT INSTALLED"}`);
}
console.log("\nRestart DSH desktop and the web service to load the new copy.");
process.exit(failed ? 1 : 0);
