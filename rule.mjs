import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---- 路径解析（可配置；发行版无硬编码路径） ----
/**
 * @param {object} config 插件配置
 * @returns {string} 约定技能目录（含 INDEX.md / VERSION）
 */
export function resolveSkillsDir(config = {}) {
  return (
    config.skillsDir ||
    process.env.DSH_OPS_CONVENTIONS_DIR ||
    join(homedir(), ".dsh", "ops-conventions", "skills")
  );
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

/** 读约定版本号；读不到就用 1 */
export function readVersion(file) {
  try {
    const raw = readFileSync(file, "utf8").trim();
    const m = raw.match(/v?([0-9][0-9.]*)/i);
    return m ? m[1] : "1";
  } catch {
    return "1";
  }
}

/** 注入内容（保持极短；措辞是强制要求，不是建议） */
export function reminderText(version, indexPath) {
  return (
    `[操作约定 v${version}｜强制] 要求不是建议：动手前必须 read ${indexPath} 并执行对应清单` +
    "（ops-scripts/notes/files/check/longtask/dsh），收尾按 ops-check 自检；跳过=未完成。"
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
