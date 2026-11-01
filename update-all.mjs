#!/usr/bin/env node
// update-all.mjs - install dsh-ops-conventions into EVERY local DSH profile
// Scans multiple DSH homes (production + test) and installs into each profile dir.
//
//   node update-all.mjs            # install into every discovered profile
//   node update-all.mjs check      # only print version per profile
//   node update-all.mjs --pull     # git pull --ff-only first, then install
//   node update-all.mjs --no-lock  # skip refreshing each profile's pnpm lock
//
// Default DSH homes:
//   %USERPROFILE%\.dsh                -> desktop, web
//   D:\software\DSH-test\home         -> web (test environment)
// Override with:  set DSH_UPDATE_HOMES=C:\path\a;D:\path\b
//
// install.mjs copies THIS local repo into <profile>/node_modules, so the repo
// is the source of truth; --pull is only needed on a second machine.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.includes("check");
const pull = args.includes("--pull");
const noLock = args.includes("--no-lock");

const DEFAULT_HOMES = [join(homedir(), ".dsh"), "D:\\software\\DSH-test\\home"];
const homes = process.env.DSH_UPDATE_HOMES
  ? process.env.DSH_UPDATE_HOMES.split(";").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_HOMES;

function pnpmEntry() {
  const candidates = [
    process.env.DSH_PNPM,
    join(process.env.DSH_APP || "D:\\software\\DSH", "resources", "runtime", "primary-runtime", "dependencies", "pnpm", "bin", "pnpm.mjs"),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

function refreshLock(profile, pnpm) {
  const r = spawnSync(process.execPath, [pnpm, "install", "--lockfile-only", "--ignore-scripts"], {
    cwd: profile,
    stdio: "inherit",
  });
  return r.status === 0;
}

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

if (!noLock) {
  const pnpm = pnpmEntry();
  if (!pnpm) {
    console.warn("\n[warn] pnpm not found (set DSH_PNPM or DSH_APP); skipping lock refresh");
  } else {
    console.log("\n--- refresh pnpm locks (pin -> new file) ---");
    for (const profile of targets) {
      const ok = refreshLock(profile, pnpm);
      console.log(`${ok ? "OK " : "FAIL"} lock refresh: ${profile}`);
      if (!ok) failed++;
    }
  }
}

// 清掉旧版本 tgz：_cache 与各 profile 的 _local 只保留当前版本，
// 否则每次发版都会留 1+3 个旧包（tools_check LEFTOVERS 会一直 WARN）。
const pkgName = "dsh-ops-conventions";
let currentVer = "";
try {
  currentVer = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version || "";
} catch {
  /* 读不到就跳过清理 */
}
if (currentVer) {
  const keep = `${pkgName}-${currentVer}.tgz`;
  const dirs = [join(process.env.TOOLS_DEV_ROOT || dirname(repo), "_cache")];
  for (const p of targets) dirs.push(join(p, "_local"));
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.startsWith(pkgName + "-") && f.endsWith(".tgz") && f !== keep) {
        try {
          unlinkSync(join(dir, f));
          console.log(`pruned stale tgz: ${join(dir, f)}`);
        } catch {
          /* 占用/权限：留给下次 */
        }
      }
    }
  }
}

console.log("\n--- installed versions ---");
for (const p of targets) {
  console.log(`${p} -> ${installedVersion(p) ?? "NOT INSTALLED"}`);
}
console.log("\nRestart all three: DSH desktop app, dsh-web.cmd, dsh-test.cmd.");
process.exit(failed ? 1 : 0);
