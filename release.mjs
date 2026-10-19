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

// 1.5) 发版前拒绝 BOM（DSH 解析带 BOM 的 package.json 会直接拒绝安装；
//      本地手工 npm pack 会绕过 CI 的 BOM 检查，所以在源头也拦一道）
function hasBom(file) {
  const b = readFileSync(file);
  return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
}
const bomCheckFiles = ["package.json", "cordis.patch.yml", "index.mjs", "rule.mjs", "install.mjs"];
const bomFiles = bomCheckFiles.filter((f) => { try { return hasBom(f); } catch { return false; } });
if (bomFiles.length > 0) {
  console.error("[失败] 以下文件带 UTF-8 BOM，DSH 会拒绝安装：\n  " + bomFiles.join("\n  "));
  console.error("用 node 重写这些文件（utf8 无 BOM）后再发版。");
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

// push main 失败：回滚本次 bump（未推送），避免重跑时再 bump 一次
const mainPush = spawnSync("git", ["push", "origin", "main"], { encoding: "utf8" });
if (mainPush.status !== 0) {
  console.error(`\n[失败] git push origin main\n${mainPush.stdout ?? ""}${mainPush.stderr ?? ""}`);
  sh("git", ["reset", "--hard", "HEAD~1"]);
  sh("git", ["tag", "-d", `v${next}`]);
  console.error("\n已回滚本次 bump（未推送）。修好网络后重跑本命令。");
  process.exit(1);
}

// push tag 失败：main 已在远端，不要重跑（会再 bump），只补推 tag
const tagPush = spawnSync("git", ["push", "origin", `v${next}`], { encoding: "utf8" });
if (tagPush.status !== 0) {
  console.error(`\n[失败] main 已推，tag 未推\n${tagPush.stdout ?? ""}${tagPush.stderr ?? ""}`);
  console.error(`不要重跑（会再 bump）；网络恢复后只补推 tag：git push origin v${next}`);
  process.exit(1);
}
console.log(`\n已推送 tag v${next} —— CI 会自动打包并建 Release（约 1-2 分钟）。`);
console.log(`\n市场 YAML 用固定名 latest 链接，不需要改：`);
console.log(`tarball: https://github.com/HeliosTangDev/dsh-ops-conventions/releases/latest/download/dsh-ops-conventions.tgz`);
console.log(`\n到 https://github.com/HeliosTangDev/dsh-ops-conventions/releases 确认附件已挂上（版本名 + 固定名两个）。`);
