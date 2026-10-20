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
const VERBS =
  /(写|改|修改|改成|换成|新建|创建|删|移动|移到|移入|移出|改名|重命名|整理|清理|归档|备份|恢复|回滚|安装|升级|卸载|跑|启动|重启|验证|自检|检查|生成|转换|导出|导入|同步|替换|覆盖)/;
const OBJECTS =
  /(脚本|文件|文件夹|目录|笔记|文档|章节|索引|导图|术语|任务|插件|配置|备份|图片|pdf|视频|mp4|mkv|mp3|wav|zip|压缩包|word|excel|表格|记忆|技能|代码|源码|函数|变量|文案|注释|逻辑|接口|模块|方法|参数|类名|文件名|路径)/i;
const FILE_OBJECT = /\.(mjs|js|ts|jsx|tsx|json|md|yml|yaml|py|ps1|cmd|bat|sh|css|html|toml|ini)\b/i;

/** 这句话像不像"要动手做操作" */
export function shouldInject(text) {
  if (!text) return false;
  const t = String(text);
  if (TOOL_WORDS.test(t)) return true;
  return VERBS.test(t) && (OBJECTS.test(t) || FILE_OBJECT.test(t));
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

/** 注入内容（强制措辞；含 6 行常驻约定，避免依赖会被抽取重写的 profile 段） */
export function reminderText(version, indexPath) {
  return (
    `[操作约定 v${version}｜强制] 要求不是建议：动手前必须 read ${indexPath} 并执行对应清单` +
    "（ops-scripts/notes/files/check/longtask/dsh），收尾按 ops-check 自检，汇报只列未通过项，" +
    "再做记忆归并、_tasks 清空、归档登记。" +
    "开场先扫 viking://user/default/memories/tasks 与 sessions，有到期/等待项先当面提醒（别等本人问）；" +
    "顺带看当前工作区 _tasks 有无上次残留，有就清掉或并入待办。" +
    "失败先分类、报原文，不许吞错误或自行解释成没事；删除/移动/覆盖前确认绝对路径，先复制成功再删旧；" +
    "不问「要不要」，明显该做的直接做；只有需要拍板时给 A/B/C+代价。" +
    "交互：先给结论与入口，一次列全（该做/已做/要你做/可选），不挤牙膏；用直白中文说状态与依据，不自造术语；" +
    "结尾分两段：待办（要你做/在等）在前、自检（只写已发生的验证）在后，不混写。" +
    "harness：不手改 .agent-teams/.dsh 运行时状态文件；改 profile/插件配置先备份；" +
    "凭证只从 _secrets 读，不贴聊天不写记忆；不擅自升级/重启。" +
    "全局：一个会话一条主线，冒出的别的事记待办、不切主线。" +
    "结论带证据（命令/数值），查不到就说查不到、推断标「推断」；时间日期当场取，不凭上下文推；" +
    "工作区外写先申请一次放宽权限，不推给本人手动做。" +
    "常驻：不说「待会儿做」（当场做完，或明说等回来再触发）；先给结论与入口，不列多方案让人挑；" +
    "改动先备份、失败可回滚，还原用哈希证明；优化收益＜成本就停，由本人拍板；" +
    "只修改工具区，系统级/提权改动交本人执行；换不换会话由本人决定，只有收到「会话压缩提示」时按提示判一次。" +
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

// ---- 硬拦截（2026-10-19）：本会话没读 INDEX.md 前拒绝写操作 ----

/** 默认拦截的写类工具；只拦文件写，只读工具与 shell 默认不拦（可配置加） */
export const DEFAULT_BLOCKED_TOOLS = ["write", "edit", "multi_edit", "apply_patch", "notebook_edit"];

/** 工具名是否在拦截名单（大小写不敏感） */
export function isBlockedTool(name, blocked = DEFAULT_BLOCKED_TOOLS) {
  if (typeof name !== "string") return false;
  const n = name.trim().toLowerCase();
  return blocked.some((b) => String(b).trim().toLowerCase() === n);
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const k of Object.keys(value)) collectStrings(value[k], out);
  return out;
}

const READ_TOOL = /^read(?:[_ -]?(?:file|text))?$/i;

/** 这次调用是不是在读 INDEX.md（read 类工具 + 参数里出现索引路径） */
export function isIndexRead(name, args, indexPath) {
  if (!READ_TOOL.test(String(name ?? ""))) return false;
  const target = String(indexPath ?? "").replace(/\\/g, "/").toLowerCase();
  for (const raw of collectStrings(args)) {
    const s = String(raw).replace(/\\/g, "/").toLowerCase();
    if (target && s.includes(target)) return true;
    if (/(^|\/)index\.md$/.test(s) && (s.includes("ops-skills") || s.includes("ops-conventions"))) return true;
  }
  return false;
}

/** 硬拦截时回给模型的拒绝理由（要能直接照做） */
export function denyReason(indexPath, version) {
  const v = version ? ` v${version}` : "";
  return (
    `[操作约定${v}｜硬拦截] 本会话还没 read 约定索引 ${indexPath}。` +
    "先 read 该文件并执行对应清单（ops-scripts/notes/files/check/longtask/dsh），再重试本次写操作；跳过=未完成。"
  );
}

/**
 * 数会话的「上下文压缩」次数。
 * 数据源：DSH 会话投影缓存 ~/.dsh/storages/session_projcache/sessions/session-<id>.json。
 * 口径：contextTimeline.val.events 里 kind === "compaction" 的条目才是压缩次数；
 * archived 只是「被压缩掉的历史条目」，不是次数（400 条归档可能只对应 1 次压缩）。
 */
export function compactionStats(projection) {
  const rows = projection?.record?.rows ?? {};
  const timeline = rows.contextTimeline?.val ?? {};
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  const comps = events.filter((e) => e && e.kind === "compaction");
  const pressure = rows.contextPressure?.val ?? {};
  const window = timeline.contextWindow ?? pressure.contextWindow ?? null;
  const used = pressure.pressureTokens ?? null;
  return {
    count: comps.length,
    last: comps.length > 0 ? comps[comps.length - 1] : null,
    pressureTokens: used,
    contextWindow: window,
    percent: used !== null && window ? Math.round((used / window) * 100) : null,
  };
}

/** 压缩次数增加时注入的一句话；没有压缩过返回 null（此时一个字都不注入） */
export function compactionHintText(stats) {
  const s = stats ?? {};
  const n = Number(s.count ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  const usage =
    s.percent !== null && s.percent !== undefined
      ? `（最近一次请求约 ${s.pressureTokens} tokens，占窗口 ${s.percent}%）`
      : "";
  return (
    `[会话压缩提示] 本会话上下文已被自动压缩 ${n} 次${usage}。` +
    "压缩说明上下文确实被裁过：若这条主线已收尾或进入等待，可在回复末尾提一句换会话（写清新会话先读哪张卡）；" +
    "若还在同一主线且状态没外化，就继续，不要为压缩而中断。"
  );
}
