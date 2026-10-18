#!/usr/bin/env node
/**
 * 发版一条命令：bump 版本号 → 提交 → 打 tag → 推送 →（CI 自动建 Release + 传 tgz）
 *
 * 用法（在仓库根目录、你自己的终端里跑，沙箱没有 GitHub 凭证）：
 *   node release.mjs patch     # 0.2.1 → 0.2.2（修 bug）
 *   node release.mjs minor     # 0.2.1 → 0.3.0（加功能）
 *   node release.mjs major     # 0.2.1 → 1.0.0
 *   node release.mjs patch --dry-run
 *
 * 原则：日常改动只 commit/push，不发版；只有"要让别人装"的时候才跑这条命令。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((a) => ["patch", "minor", "major"].includes(a)) ?? "patch";

function sh(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    console.error(`\n[失败] ${cmd} ${cmdArgs.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? "").trim();
}

const pkgPath = "package.json";
const raw = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);
const [maj, min, pat] = pkg.version.split(".").map(Number);
const next =
  bump === "major" ? `${maj + 1}.0.0` :
  bump === "minor" ? `${maj}.${min + 1}.0` :
  `${maj}.${min}.${pat + 1}`;

console.log(`当前版本 ${pkg.version} → 新版本 ${next}（${bump}）`);
if (dryRun) {
  console.log("\n[dry-run] 将执行：\n  1) 改 package.json version\n  2) git add + commit\n  3) git tag v" + next + "\n  4) git push origin main 和 tag\n  5) CI 会自动 npm pack + 建 Release + 传 tgz\n");
  process.exit(0);
}

// 1) 工作区必须干净（否则容易把半成品发出去）
const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"]);
if (dirty) {
  console.error("[失败] 工作区有未提交的改动，先提交或 stash：\n" + dirty);
  process.exit(1);
}

// 2) 改版本号（保留原缩进与换行）
const indent = (raw.match(/^[ \t]+"/m) ?? ["  "])[0];
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, indent.length) + "\n", "utf8");
console.log("已更新 package.json");

// 3) 提交 + 打 tag + 推送
sh("git", ["add", pkgPath]);
sh("git", ["commit", "-m", `chore(release): v${next}`]);
sh("git", ["tag", "-a", `v${next}`, "-m", `v${next}`]);
sh("git", ["push", "origin", "main"]);
sh("git", ["push", "origin", `v${next}`]);
console.log(`\n已推送 tag v${next} —— CI 会自动打包并建 Release（约 1-2 分钟）。`);
console.log(`\n市场 YAML 要改的一行（tarball 指向新版本）：`);
console.log(`tarball: https://github.com/HeliosTangDev/dsh-ops-conventions/releases/download/v${next}/dsh-ops-conventions-${next}.tgz`);
console.log(`\n到 https://github.com/HeliosTangDev/dsh-ops-conventions/releases 确认附件已挂上，再改市场仓库那一行。`);
