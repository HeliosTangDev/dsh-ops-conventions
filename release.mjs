#!/usr/bin/env node
/**
 * 发版一条命令：bump 版本号 → 提交 → 打 tag → 推送 →（CI 自动建 Release + 传 tgz）
 *
 * 用法（在仓库根目录、你自己的终端里跑，沙箱没有 GitHub 凭证）：
 *   node release.mjs patch     # 0.2.1 → 0.2.2（修 bug）
 *   node release.mjs minor     # 0.2.1 → 0.3.0（加功能）
 *   node release.mjs major     # 0.2.1 → 1.0.0
 *   node release.mjs patch --dry-run
 *   node release.mjs patch --prepare   # 只 bump+commit+tag，不推送（网络差时用）
 *   node release.mjs --push-only       # 把当前版本的 main 与 tag 推上去（重试推送用）
 *
 * 原则：日常改动只 commit/push，不发版；只有"要让别人装"的时候才跑这条命令。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const prepareOnly = args.includes("--prepare") || args.includes("--no-push");
const pushOnly = args.includes("--push-only");
const bump = args.find((a) => ["patch", "minor", "major"].includes(a)) ?? "patch";

function sh(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    console.error(`\n[失败] ${cmd} ${cmdArgs.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? "").trim();
}

// 推送统一 120 秒超时，避免网络差时无限卡住
function pushRef(ref) {
  return spawnSync("git", ["push", "origin", ref], { encoding: "utf8", timeout: 120000 });
}
function reportPush(r, what) {
  console.error(`\n[失败] ${what}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
}

const pkgPath = "package.json";
const raw = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);

// --push-only：只重试推送，不 bump（网络差导致上次没推完时用）
if (pushOnly) {
  const v = pkg.version;
  console.log(`push-only：推送 main 与 tag v${v}`);
  const m = pushRef("main");
  if (m.status !== 0) {
    reportPush(m, "git push origin main");
    console.error("网络恢复后重跑本命令即可（不会 bump）。");
    process.exit(1);
  }
  const t = pushRef(`v${v}`);
  if (t.status !== 0) {
    reportPush(t, `git push origin v${v}`);
    console.error(`main 已推；网络恢复后只补推 tag：git push origin v${v}`);
    process.exit(1);
  }
  console.log(`已推送 v${v}，CI 约 1-2 分钟出包。`);
  process.exit(0);
}

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

// 防重复 bump：当前版本的 tag 已存在时，只有「远端也已有该 tag」才允许继续 bump（说明上次发版完整）
const curTag = `v${pkg.version}`;
if (spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${curTag}`]).status === 0) {
  const remote = spawnSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${curTag}`], { encoding: "utf8", timeout: 30000 });
  const pushed = remote.status === 0 && String(remote.stdout || "").trim().length > 0;
  if (!pushed) {
    if (remote.status !== 0) {
      console.error(`[拒绝] 无法确认远端 tag ${curTag}（网络或凭证问题）。`);
      console.error(`先确认：git ls-remote --tags origin refs/tags/${curTag}`);
    } else {
      console.error(`[拒绝] 当前版本 ${pkg.version} 的 tag ${curTag} 本地有、远端没有（上次没推完）。`);
      console.error("不要重跑 bump。先推：node release.mjs --push-only");
    }
    process.exit(1);
  }
  console.log(`[继续] 远端已有 tag ${curTag}（上次发版完整），继续 bump 到 ${next}`);
}

// 文档提醒：Release notes 由 commit 自动生成，质量取决于 CHANGELOG/commit；README 不会自动改
try {
  const cl = readFileSync("CHANGELOG.md", "utf8");
  if (!cl.includes(`## ${next}`)) {
    console.warn(`[提醒] CHANGELOG.md 没有 "## ${next}" 段：Release notes 只会是 commit 标题。`);
    console.warn("        建议先补 CHANGELOG（行为变化），README 的「它做什么」按需同步。");
  }
} catch {
  /* 没有 CHANGELOG 就不提醒 */
}

// push 卡住时按 Ctrl+C：只要 bump 已提交、还没推完，就回滚，避免下次重跑再 bump
let bumpCommitted = false;
let pushDone = false;
process.on("SIGINT", () => {
  try {
    if (bumpCommitted && !pushDone) {
      console.error("\n[中断] 推送未完成，回滚本次 bump…");
      sh("git", ["reset", "--hard", "HEAD~1"]);
      sh("git", ["tag", "-d", `v${next}`]);
      console.error("已回滚，未发出。修好网络后重跑本命令。");
    }
  } catch (err) {
    console.error(String(err));
  }
  process.exit(130);
});

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
bumpCommitted = true;

if (prepareOnly) {
  console.log(`\n已本地准备好 v${next}（提交 + tag），未推送。`);
  console.log(`网络好时执行：git push origin main && git push origin v${next}`);
  console.log("或：node release.mjs --push-only");
  process.exit(0);
}

// push main 失败：回滚本次 bump（未推送），避免重跑时再 bump 一次
const mainPush = pushRef("main");
if (mainPush.status !== 0) {
  reportPush(mainPush, "git push origin main");
  sh("git", ["reset", "--hard", "HEAD~1"]);
  sh("git", ["tag", "-d", `v${next}`]);
  console.error("\n已回滚本次 bump（未推送）。修好网络后重跑本命令。");
  process.exit(1);
}

// push tag 失败：main 已在远端，不要重跑（会再 bump），只补推 tag
const tagPush = pushRef(`v${next}`);
if (tagPush.status !== 0) {
  reportPush(tagPush, `git push origin v${next}`);
  console.error(`不要重跑（会再 bump）；网络恢复后只补推 tag：git push origin v${next}`);
  console.error("或：node release.mjs --push-only");
  process.exit(1);
}
pushDone = true;
console.log(`\n已推送 tag v${next} —— CI 会自动打包并建 Release（约 1-2 分钟）。`);
console.log(`\n市场 YAML 用固定名 latest 链接，不需要改：`);
console.log(`tarball: https://github.com/HeliosTangDev/dsh-ops-conventions/releases/latest/download/dsh-ops-conventions.tgz`);
console.log(`\n到 https://github.com/HeliosTangDev/dsh-ops-conventions/releases 确认附件已挂上（版本名 + 固定名两个）。`);
