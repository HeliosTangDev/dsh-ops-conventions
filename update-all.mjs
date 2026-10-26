#!/usr/bin/env node
// update-all.mjs - install dsh-ops-conventions into EVERY local DSH profile
// Scans multiple DSH homes (production + test) and installs into each profile dir.
//
//   node update-all.mjs            # install into every discovered profile
//   node update-all.mjs check      # only print version per profile
//   node update-all.mjs --pull     # git pull --ff-only first, then install
//
// Default DSH homes:
//   %USERPROFILE%\.dsh                -> desktop, web
//   D:\software\DSH-test\home         -> web (test environment)
// Override with:  set DSH_UPDATE_HOMES=C:\path\a;D:\path\b
//
// install.mjs copies THIS local repo into <profile>/node_modules, so the repo
// is the source of truth; --pull is only needed on a second machine.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.includes("check");
const pull = args.includes("--pull");

const DEFAULT_HOMES = [join(homedir(), ".dsh"), "D:\\software\\DSH-test\\home"];
const homes = process.env.DSH_UPDATE_HOMES
  ? process.env.DSH_UPDATE_HOMES.split(";").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_HOMES;

function listProfiles(home) {
  const dir = join(home, "profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name))
    // 只认真 profile：必须有 package.json（跳过 _backups 这类目录）
    .filter((p) => existsSync(join(p, "package.json")));
}

function installedVersion(profilePath) {
  const p = join(profilePath, "node_modules", "dsh-ops-conventions", "package.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")).version;
  } catch {
    return "unreadable";
  }
}

const targets = [];
for (const home of homes) {
  for (const profile of listProfiles(home)) targets.push(profile);
}

if (targets.length === 0) {
  console.error("no profiles found under: " + homes.join(", "));
  process.exit(1);
}

if (checkOnly) {
  for (const p of targets) {
    const v = installedVersion(p);
    console.log(`${p} -> ${v ? v : "NOT INSTALLED"}`);
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
for (const profile of targets) {
  console.log(`\n=== install into ${profile} ===`);
  const r = spawnSync(process.execPath, [join(repo, "install.mjs"), profile], { stdio: "inherit" });
  if (r.status !== 0) {
    failed++;
    console.error(`install into ${profile} failed (exit ${r.status})`);
  }
}

console.log("\n--- installed versions ---");
for (const p of targets) {
  console.log(`${p} -> ${installedVersion(p) ?? "NOT INSTALLED"}`);
}
console.log("\nRestart all three: DSH desktop app, dsh-web.cmd, dsh-test.cmd.");
process.exit(failed ? 1 : 0);
