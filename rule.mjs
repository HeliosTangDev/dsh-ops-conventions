import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ---- 路径解析（可配置；发行版无硬编码路径） ----
/** 所有候选目录（排错用，也会按顺序做存在性检查） */
export function skillsDirCandidates(config = {}) {
  const local = fileURLToPath(new URL("./skills", import.meta.url)); // 包自带，零配置可用
  return [
    config.skillsDir,
    process.env.DSH_OPS_CONVENTIONS_DIR,
    local,
    join(homedir(), ".openviking", "data", "viking", "default", "user", "default", "memories", "ops-conventions"),
    join(homedir(), ".dsh", "ops-conventions", "skills"),
  ].filter((p) => typeof p === "string" && p.length > 0);
}

/**
 * 按优先级挑一个"真的存在 INDEX.md"的约定目录：
 *   1) 插件配置 skillsDir
 *   2) 环境变量 DSH_OPS_CONVENTIONS_DIR
 *   3) 插件包自带 <package>/skills（发行版自包含，开箱即用）
 *   4) OpenViking 实际存储：<用户>/.openviking/data/viking/default/user/default/memories/ops-conventions
 *   5) 用户目录 ~/.dsh/ops-conventions/skills
 * 都不可用时返回优先级最高的那个（便于日志暴露问题）。
 */
export function resolveSkillsDir(config = {}) {
  for (const dir of skillsDirCandidates(config)) {
    try {
      if (existsSync(join(dir, "INDEX.md"))) return dir;
    } catch {
      /* 权限等异常忽略，继续下一个 */
    }
  }
  const c = skillsDirCandidates(config);
  return c[0] ?? join(homedir(), ".dsh", "ops-conventions", "skills");
}

/**
 * @param {object} config 插件配置
 * @returns {string} 注入日志文件路径
 */
export function resolveLogFile(config = {}) {
  return (
    config.logFile ||
    process.env.DSH_OPS_CONVENTIONS_LOG ||
    join(homedir(), ".dsh", "ops-conventions", "ops-conventions.log")
  );
}

// ---- 关键词判定 ----

// 工具/操作类关键词：出现即视为"要动手"
const TOOL_WORDS =
  /(脚本|powershell|pwsh|\.ps1|\.cmd|\.bat|python|npm|pnpm|node|dshm|taskrun|jobs\.cmd|批处理|跑批|监控|采样|后台任务|后台\s*job)/i;

// 动作词 + 对象词：同时出现才视为"要动手"（避免闲聊也提醒）
const VERBS = /(写|改|修改|新建|创建|删|移动|重命名|整理|清理|归档|备份|恢复|回滚|安装|升级|卸载|跑|启动|重启|验证|自检|检查|生成|转换|导出|导入|同步|整理)/;
const OBJECTS = /(脚本|文件|文件夹|目录|笔记|文档|章节|索引|导图|术语|任务|插件|配置|备份|图片|pdf|视频|word|excel|表格|记忆|技能)/i;

/** 这句话像不像"要动手做操作" */
export function shouldInject(text) {
  if (!text) return false;
  const t = String(text);
  if (TOOL_WORDS.test(t)) return true;
  return VERBS.test(t) && OBJECTS.test(t);
}

/** 读约定版本号；支持 VERSION / VERSION.txt / version.json；读不到就用 1 */
export function readVersion(file) {
  const candidates = [file, `${file}.txt`, join(dirname(file), "version.json")];
  for (const f of candidates) {
    try {
      const raw = readFileSync(f, "utf8").trim();
      const m = raw.match(/v?([0-9][0-9.]*)/i);
      if (m) return m[1];
    } catch {
      /* 换下一个文件名 */
    }
  }
  return "1";
}

/** 注入内容（保持极短；措辞是强制要求，不是建议） */
export function reminderText(version, indexPath) {
  return (
    `[操作约定 v${version}｜强制] 要求不是建议：动手前必须 read ${indexPath} 并执行对应清单` +
    "（ops-scripts/notes/files/check/longtask/dsh），收尾按 ops-check 自检；跳过=未完成。" +
    "若 skill 工具报 unknown（旧会话快照所致），直接 read 该文件即可，不要跳过。"
  );
}

/** 从消息数组取最后一条用户文本 */
export function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((p) => p && p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
    }
  }
  return "";
}
