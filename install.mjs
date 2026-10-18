#!/usr/bin/env node
/**
 * install.mjs — 把 dsh-ops-conventions 装进一个 DSH profile（跨平台，零依赖）
 *
 * 用法：
 *   node install.mjs                       # 默认装到 ~/.dsh/profiles/desktop
 *   node install.mjs <profile 目录>         # 指定 profile
 *   node install.mjs <profile 目录> --uninstall
 *
 * 它做的事：
 *   1) 把本包复制到 <profile>/node_modules/dsh-ops-conventions
 *   2) 在 <profile>/package.json 的 dependencies 里登记
 *   3) 把包名加进 dsh.profile.bundles（否则 DSH 不会加载）
 *   4) 打印后续步骤（重启或开关插件）
 *
 * 不动你自己的约定：默认读取包内自带 skills/；想用自己的，配 skillsDir 即可。
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const pkgDir = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")); // 兼容 Windows 带 BOM 的 JSON
const pkg = readJson(join(pkgDir, "package.json"));
const pkgName = pkg.name;

const argv = process.argv.slice(2);
const uninstall = argv.includes("--uninstall");
const profileArg = argv.find((a) => !a.startsWith("-")) || process.env.DSH_PROFILE_DIR;
const profileDir = resolve(profileArg || join(homedir(), ".dsh", "profiles", "desktop"));
const profilePkgPath = join(profileDir, "package.json");
const targetDir = join(profileDir, "node_modules", pkgName);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
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

if (uninstall) {
  delete profile.dependencies[pkgName];
  profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((b) => b !== pkgName);
  writeFileSync(profilePkgPath, JSON.stringify(profile, null, 2) + "\n", "utf8");
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
  console.log(`✓ 已卸载 ${pkgName}`);
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
profile.dependencies[pkgName] = pkg.version || "0.0.0";
if (!profile.dsh.profile.bundles.includes(pkgName)) profile.dsh.profile.bundles.push(pkgName);
writeFileSync(profilePkgPath, JSON.stringify(profile, null, 2) + "\n", "utf8");

console.log(`✓ 已安装 ${pkgName}@${pkg.version || "0.0.0"}`);
console.log(`  profile : ${profileDir}`);
console.log(`  插件目录: ${targetDir}`);
console.log(`  自带清单: ${join(targetDir, "skills")}`);
console.log("");
console.log("下一步（二选一）：");
console.log("  · DSH 插件页 → 找到 dsh-ops-conventions → 关掉再打开（热重载，不用重启）");
console.log("  · 或者重启 DeepSeek Harness");
console.log("");
console.log("验证：说一句像要动手的话（如「写个备份脚本」），然后看注入日志：");
console.log(`  ${join(process.env.USERPROFILE || homedir(), ".dsh", "ops-conventions", "ops-conventions.log")}`);

