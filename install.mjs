#!/usr/bin/env node
/**
 * install.mjs — 把 dsh-ops-conventions 装进一个 DSH profile（跨平台，零依赖）
 *
 * 用法：
 *   node install.mjs                                  # 默认 ~/.dsh/profiles/desktop，依赖钉 GitHub latest 固定名 tgz
 *   node install.mjs <profile 目录>                    # 指定 profile
 *   node install.mjs <profile> --pin 0.5.10           # 钉具体版本（用版本名资产）
 *   node install.mjs <profile> --pin file:D:/x.tgz    # 钉本地包或任意 URL
 *   node install.mjs <profile> --pin=https://...      # 同上，等号写法
 *   node install.mjs <profile> --no-pin               # 只写裸版本号（pnpm 会去 npm 找，多半不可达）
 *   node install.mjs <profile> --uninstall            # 卸载
 *
 * 它做的事：
 *   1) 把本包复制到 <profile>/node_modules/dsh-ops-conventions
 *   2) 在 <profile>/package.json 的 dependencies 里登记（默认钉 GitHub latest 固定名 tgz）
 *   3) 把包名加进 dsh.profile.bundles（否则 DSH 不会加载）
 *   4) 写盘前后自检：先备份 package.json.bak-<时间>，写后读回验「无 BOM + JSON 可解析 + 依赖已生效」，失败自动回滚
 *   5) 打印后续步骤（重启或开关插件）
 *
 * 为什么默认钉 URL（2026-10-24 定）：
 *   本机 pwsh 实为 Windows PowerShell 5.1，`Set-Content -Encoding utf8` 会把 profile 的
 *   package.json 写成带 BOM；宿主 readProfileManifest 是 readFileSync(utf8) + 直接
 *   JSON.parse，遇到 BOM 抛 DesktopHostFatalError 后静默退出 —— 现象就是「装完插件、
 *   重启、双击没反应」，而且连崩 7 次都只报同一行。把「钉依赖」也收进 node 之后，
 *   装插件就是一条命令，不再需要任何人手写 PowerShell 去改这个文件。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const pkgDir = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")); // 兼容带 BOM 的 JSON
const pkg = readJson(join(pkgDir, "package.json"));
const pkgName = pkg.name;
const REPO = "HeliosTangDev/dsh-ops-conventions";
const LATEST_TGZ = `https://github.com/${REPO}/releases/latest/download/dsh-ops-conventions.tgz`;
const versionTgz = (v) => `https://github.com/${REPO}/releases/download/v${v}/dsh-ops-conventions-${v}.tgz`;

const argv = process.argv.slice(2);
let uninstall = false;
let pin;
let pinGiven = false;
let profileArg = "";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--uninstall") uninstall = true;
  else if (a === "--no-pin") { pin = null; pinGiven = true; }
  else if (a === "--pin") {
    const v = argv[++i];
    if (v === undefined) fail("--pin 需要一个值：版本号 / URL / file: 路径");
    pin = v; pinGiven = true;
  } else if (a.startsWith("--pin=")) { pin = a.slice(6); pinGiven = true; }
  else if (a === "-h" || a === "--help") { usage(); process.exit(0); }
  else if (a.startsWith("-")) fail(`未知参数: ${a}`);
  else if (!profileArg) profileArg = a;
  else fail(`多余参数: ${a}`);
}
if (!pinGiven) pin = "__LOCAL_TGZ__";
else if (pin === "latest") pin = LATEST_TGZ;

const profileDir = resolve(profileArg || process.env.DSH_PROFILE_DIR || join(homedir(), ".dsh", "profiles", "desktop"));
const profilePkgPath = join(profileDir, "package.json");
if (pin === "__LOCAL_TGZ__") {
  pin = stageLocalTgz(profileDir);
  if (!pin) {
    console.warn(`⚠ 本机没有 ${pkgName}-${pkg.version}.tgz（先用 npm pack 生成或放进 _cache），退回 GitHub latest URL`);
    pin = LATEST_TGZ;
  }
}
const targetDir = join(profileDir, "node_modules", pkgName);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const backupPath = `${profilePkgPath}.bak-${stamp}`;

function usage() {
  console.log(`用法: node install.mjs [profile 目录] [--pin <版本|URL|file:路径> | --no-pin] [--uninstall]
  profile 默认: $DSH_PROFILE_DIR 或 ~/.dsh/profiles/desktop
  依赖默认钉: file:./_local/<name>-<version>.tgz（本机不可变，避免 integrity 失配）
  需要旧行为时显式 --pin latest 或 --pin <版本>`);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
/** 把「当前版本」的 tgz 放进 <profile>/_local，返回 file: 依赖值；找不到就返回 null。
 *  本地文件不可变（同一个 file: 路径永远同一份字节），所以 pnpm 的 integrity 不会再失配。 */
function stageLocalTgz(profileDirArg) {
  const v = pkg.version || "0.0.0";
  const candidates = [
    join(pkgDir, `${pkgName}-${v}.tgz`),
    join(process.env.TOOLS_DEV_ROOT || dirname(pkgDir), "_cache", `${pkgName}-${v}.tgz`),
    join(pkgDir, `${pkgName}-${v}.tgz`),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) return null;
  const localDir = join(profileDirArg, "_local");
  mkdirSync(localDir, { recursive: true });
  const dest = join(localDir, `${pkgName}-${v}.tgz`);
  copyFileSync(found, dest);
  return `file:./_local/${pkgName}-${v}.tgz`;
}

/** 钉成什么依赖值：默认最新的固定名 tgz；--pin 版本号换版本名资产；其余原样 */
function resolveDep(value) {
  if (value === null) return pkg.version || "0.0.0";
  if (/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(value)) return versionTgz(value);
  return value;
}

if (!existsSync(profilePkgPath)) {
  fail(
    `找不到 profile：${profileDir}\n  用法: node install.mjs <profile 目录>（默认 ~/.dsh/profiles/desktop）`,
  );
}

const profile = readJson(profilePkgPath);
profile.dependencies ||= {};
profile.dsh ||= {};
profile.dsh.profile ||= {};
profile.dsh.profile.bundles ||= [];

/** 写 profile 清单：先备份，写后读回自检（无 BOM + 可解析 + 依赖生效），失败回滚并退出 */
function saveProfile(value) {
  if (!existsSync(backupPath)) copyFileSync(profilePkgPath, backupPath);
  writeFileSync(profilePkgPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    const buf = readFileSync(profilePkgPath);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw new Error("写出的 package.json 带 UTF-8 BOM");
    const back = readJson(profilePkgPath);
    const wantDep = value.dependencies[pkgName];
    if (wantDep !== undefined && back.dependencies?.[pkgName] !== wantDep) {
      throw new Error("读回校验失败：dependencies 未按预期写入");
    }
    const wantBundle = value.dsh.profile.bundles.includes(pkgName);
    const gotBundle = !!back.dsh?.profile?.bundles?.includes(pkgName);
    if (wantBundle !== gotBundle) throw new Error("读回校验失败：bundles 未按预期写入");
  } catch (error) {
    copyFileSync(backupPath, profilePkgPath);
    fail(`写 profile 清单失败，已回滚：${error.message}\n  备份: ${backupPath}`);
  }
}

const dep = resolveDep(pin);

if (uninstall) {
  delete profile.dependencies[pkgName];
  profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((b) => b !== pkgName);
  saveProfile(profile);
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
  console.log(`✓ 已卸载 ${pkgName}`);
  console.log(`  profile : ${profileDir}`);
  console.log(`  清单备份: ${backupPath}`);
  console.log("  下一步：重启 DSH（或到插件页确认它已消失）。");
  process.exit(0);
}

// 1) 复制文件（跳过 .git / node_modules）
cpSync(pkgDir, targetDir, {
  recursive: true,
  force: true,
  filter: (src) => !/[\\/](\.git|node_modules)[\\/]?$/.test(src),
});
if (!existsSync(join(targetDir, "package.json"))) fail("复制失败：目标目录缺少 package.json");

// 2) 3) 登记
profile.dependencies[pkgName] = dep;
if (!profile.dsh.profile.bundles.includes(pkgName)) profile.dsh.profile.bundles.push(pkgName);
saveProfile(profile);

console.log(`✓ 已安装 ${pkgName}@${pkg.version || "0.0.0"}`);
console.log(`  profile : ${profileDir}`);
console.log(`  插件目录: ${targetDir}`);
console.log(`  依赖    : ${dep}${pin === LATEST_TGZ ? "（GitHub latest 固定名 tgz）" : ""}`);
console.log(`  清单备份: ${backupPath}`);
if (pin === null) {
  console.log("");
  console.log("⚠ --no-pin：依赖写的是裸版本号，pnpm 会去 npm 找这个包（大概率不存在），");
  console.log("  通常应改用默认：node install.mjs <profile>（钉 GitHub latest 固定名 tgz）");
}
console.log("");
console.log("下一步（二选一）：");
console.log("  · DSH 插件页 → 找到 dsh-ops-conventions → 关掉再打开（热重载，不用重启）");
console.log("  · 或者重启 DeepSeek Harness");
console.log("");
console.log("验证：说一句像要动手的话（如「写个备份脚本」），然后看注入日志：");
console.log(`  ${join(process.env.USERPROFILE || homedir(), ".dsh", "ops-conventions", "ops-conventions.log")}`);
