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
export function reminderText(version, indexPath, todoPath) {
  const todo = todoPath ? `；并 read 待办镜像 ${todoPath} 或运行 todo_check.ps1（二选一；报待办前必须先跑校验，镜像只是快照）` : "";
  return (
    `[操作约定 v${version}｜强制] 动手前必须 read ${indexPath} 并执行对应清单` + todo +
    "；收尾按 ops-check：记忆归并、清 _tasks、归档登记。" +
    "开场扫 tasks（OPEN.md+MAINT-LATEST Issues）与 sessions，到期项当面提醒，清 _tasks 残留。" +
    "失败分类报原文，不许吞或粉饰；删/移/覆盖前确认绝对路径，先复制成功再删旧。" +
    "不问「要不要」；要拍板给 A/B/C+代价；结论与入口一次列全（该做/已做/要你做/可选），直白中文不自造术语。" +
    "结尾两段：待办在前（要你做/在等/待拍板，命令写全路径与参数），任务未完成与等待只进待办；自检只写报错/未执行/失败，可修当场修并复检。" +
    "mem candidates 有候选就提醒升门铃，由你定。" +
    "提到约定先判层落位：跨类进门铃、某类进清单、参考进偏好/实体；只写记忆=没写成，落位后读回。" +
    "承诺不落空：不说「待会儿做」，写「已落位」须带读回证据。" +
    "已决定不做的不再提；待办只存 memories/tasks/。" +
    "harness：改配置先备份；凭证只从 _secrets 读，不贴聊天不写记忆；不擅自升级/重启。" +
    "一主线一会话，别的事记待办；不列多方案让人挑。" +
    "结论带证据，查不到说查不到、推断标「推断」；状态当场取（时间/进程/任务记录）；工作区外写先申请放宽。" +
    "改动先备份可回滚；收益＜成本就停；只改工具区，系统级交本人；换会话自决，仅「压缩提示」判一次；skill 报 unknown 直接 read。"
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

// 写类工具名模式：覆盖内置 write/edit/... 与 MCP 的 mcp__<srv>__write / __edit / __add_resource / dshm_install 等
// 不匹配 pwsh/bash（它们走 isShellWrite 按命令串判定）
const WRITE_TOOL_NAME =
  /(?:^|__|[-_])(?:write|edit|multi_edit|apply_patch|notebook_edit|create_file|create_directory|delete_file|remove_file|move_file|rename_file|mkdir|append|patch|add_resource|add_skill|install|uninstall|upgrade|toggle|restart)$/i;

/** 这次调用是不是"写类工具"：名单命中 或 名字符合写类模式 */
export function isWriteTool(name, blocked = DEFAULT_BLOCKED_TOOLS) {
  const n = String(name ?? "").trim();
  if (!n) return false;
  return isBlockedTool(n, blocked) || WRITE_TOOL_NAME.test(n);
}

// ---- 只读白名单：明确只读才放行，其余（含未来新增工具）默认按"可能写"处理 ----
// 支持三种形态：read / read_file / mcp__srv__get_acl / agent_teams_status
const READONLY_TOOL_NAME =
  /(?:^|[-_])(?:read|search|find|glob|grep|list|ls|dir|directory|tree|status|info|get|query|inspect|view|show|stat|health|ping|version|outdated|describe|fetch|weather|worldclock|calc|diff|check|validate|explain|research|reflect|dependencies|present|skill|question)(?:_\w+)*$/i;

/** 工具名是否明确只读（可安全跳过守卫） */
export function isReadOnlyTool(name) {
  const n = String(name ?? "").trim();
  if (!n) return false;
  return READONLY_TOOL_NAME.test(n);
}

/**
 * 这次调用是否需要"先读约定"：
 * - 明确只读工具（read/search/list/status/…）→ 不需要
 * - shell：只拦命令串里的写操作 → 只读命令不需要
 * - 其余一律需要（内置写工具、MCP 未知工具、`dshm_*`、将来新增的任何工具）→ **未知即拦**
 */
export function needsGuard(name, args) {
  const n = String(name ?? "").trim();
  if (!n) return true; // 名字缺失，保守拦
  if (isWriteTool(n)) return true; // 显式写类优先（如 add_skill 不能被 "skill" 只读后缀放行）
  if (isReadOnlyTool(n)) return false;
  if (SHELL_TOOL.test(n)) return isShellWrite(n, args);
  return true;
}

// ---- 命令行里的写操作（shell 不在 blockedTools 里，靠命令串识别；2026-10-21 补口）----
const SHELL_TOOL = /^(pwsh|powershell|bash|sh|shell|cmd|run_command|exec)$/i;

// 只认"会改动磁盘/远端"的动词与重定向，避免把只读命令也拦掉
const SHELL_WRITE = new RegExp(
  [
    '\\b(?:copy|move|rename|mkdir|rmdir|del)\\b',
    '\\b(?:set-content|add-content|out-file|new-item|copy-item|move-item|remove-item|rename-item|clear-content|set-itemproperty)\\b',
    '\\brm\\b|\\bmv\\b|\\bcp\\b|\\bmkdir\\b|\\btouch\\b|\\btee\\b',
    '>>?\\s*\\S',
    '\\bgit\\s+(?:push|tag|commit|reset)\\b',
    '\\bov\\s+(?:write|rm|mkdir|skills\\s+(?:add|remove))\\b',
    '\\bnpm\\s+(?:i|install|uninstall|publish)\\b',
    '\\bnode\\s+\\S*release\\.mjs\\b',
    '\\bschtasks\\b|\\breg\\s+(?:add|delete|import)\\b',
  ].join('|'),
  'i',
);

/** 这条命令调用是不是"要写东西"（shell 类工具专用） */
export function isShellWrite(name, args) {
  if (!SHELL_TOOL.test(String(name ?? '').trim())) return false;
  for (const raw of collectStrings(args)) {
    if (SHELL_WRITE.test(String(raw))) return true;
  }
  return false;
}

// shell 里读文件（用于把「用命令行读了 INDEX/OPEN.md」也算已读）
const SHELL_READ = /\b(?:get-content|gc|cat|type|head|more|select-string)\b/i;

function isShellRead(name, args) {
  if (!SHELL_TOOL.test(String(name ?? '').trim())) return false;
  for (const raw of collectStrings(args)) {
    if (SHELL_READ.test(String(raw))) return true;
  }
  return false;
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
  if (!READ_TOOL.test(String(name ?? "")) && !isShellRead(name, args)) return false;
  const target = String(indexPath ?? "").replace(/\\/g, "/").toLowerCase();
  for (const raw of collectStrings(args)) {
    const s = String(raw).replace(/\\/g, "/").toLowerCase();
    if (target && s.includes(target)) return true;
    if (/(^|\/)index\.md$/.test(s) && (s.includes("ops-skills") || s.includes("ops-conventions"))) return true;
  }
  return false;
}

/** 这次调用是不是在读待办镜像 OPEN.md（read 类工具 + 参数里出现该路径） */
export function isTodoRead(name, args, todoPath) {
  if (!READ_TOOL.test(String(name ?? "")) && !isShellRead(name, args)) return false;
  const target = String(todoPath ?? "").replace(/\\/g, "/").toLowerCase();
  if (!target) return false;
  for (const raw of collectStrings(args)) {
    const s = String(raw).replace(/\\/g, "/").toLowerCase();
    if (target && s.includes(target)) return true;
    if (/(^|\/)open\.md$/.test(s) && s.includes("tasks")) return true;
  }
  return false;
}

// 跑待办检查器（todo_check.ps1 / todo.cmd）= 真的做了「报待办前先校验」
// 这是 B 方案的核心：把"报前先跑校验"从文案变成 guard 可观测的动作。
const TODO_CHECK = /todo(?:_check)?\.(?:ps1|cmd)/i;

/** 这次调用是不是在跑待办检查器（shell 类工具 + 参数里出现 todo_check.ps1 / todo.cmd） */
export function isTodoCheck(name, args) {
  if (!SHELL_TOOL.test(String(name ?? "").trim())) return false;
  for (const raw of collectStrings(args)) {
    if (TODO_CHECK.test(String(raw))) return true;
  }
  return false;
}

// ---- 通用结构门（2026-10-22）：写某区域前，本会话必须跑过该区域的结构检查器 ----
// 加区域只加配置，不改代码。
export const STRUCT_GATES = [
  {
    id: "tools",
    pathRe: /software[\\/](toolsuse|toolsdev)/i,
    checkRe: /tools_check\.py/i,
    checker: "python D:\\software\\ToolsUse\\_tools\\misc\\tools_check.py",
  },
  {
    id: "notes",
    pathRe: /blog[\\/]article[\\/]course/i,
    checkRe: /notes_check\.py/i,
    checker: "python D:\\software\\ToolsUse\\_tools\\misc\\notes_check.py",
  },
];

/** 这次调用命中了哪些结构门（按参数里的路径匹配） */
export function structGatesFor(args) {
  const ids = [];
  for (const raw of collectStrings(args)) {
    const s = String(raw).replace(/\\/g, "/");
    for (const g of STRUCT_GATES) if (g.pathRe.test(s) && !ids.includes(g.id)) ids.push(g.id);
  }
  return ids;
}

/** 这条命令是不是某区域的结构检查器（跑过即该门放行） */
export function structCheckIds(name, args) {
  if (!SHELL_TOOL.test(String(name ?? "").trim())) return [];
  const ids = [];
  for (const raw of collectStrings(args)) {
    const s = String(raw);
    for (const g of STRUCT_GATES) if (g.checkRe.test(s) && !ids.includes(g.id)) ids.push(g.id);
  }
  return ids;
}

const TOOLS_CHECK = /tools_check\.py/i;

/** 这次调用是不是在跑工具区的结构检查器 */
export function isToolsCheck(name, args) {
  if (!SHELL_TOOL.test(String(name ?? "").trim())) return false;
  for (const raw of collectStrings(args)) {
    if (TOOLS_CHECK.test(String(raw))) return true;
  }
  return false;
}

/** 这次调用的参数是否涉及工具区（ToolsUse / ToolsDev）——只对工具区的写操作加门 */
export function touchesToolArea(args) {
  for (const raw of collectStrings(args)) {
    const s = String(raw).toLowerCase().replace(/\\/g, "/");
    if (s.includes("software/toolsuse") || s.includes("software/toolsdev")) return true;
  }
  return false;
}
/** 硬拦截时回给模型的拒绝理由（要能直接照做） */
export function denyReason(indexPath, version, todoPath, todoRead) {
  const v = version ? ` v${version}` : "";
  const parts = [`read 约定索引 ${indexPath}`];
  if (todoPath && !todoRead) {
    parts.push(`read 待办镜像 ${todoPath}，或运行 todo_check.ps1（二选一；它逐条跑校验给出实时结果，镜像是快照）`);
  }
  return (
    `[操作约定${v}｜硬拦截] 本会话还没 ` + parts.join("，也没 ") + "。做完后" +
    "执行对应清单（ops-scripts/notes/files/check/longtask/dsh），再重试本次写操作；跳过=未完成。"
  );
}

/**
 * 数会话的「上下文压缩」次数。
 * 数据源：DSH 会话投影缓存 ~/.dsh/storages/session_projcache/sessions/session-<id>.json。
 * 口径：contextTimeline.val.events 里 kind === "compaction" 的条目才是压缩次数；
 * archived 只是「被压缩掉的历史条目」，不是次数（400 条归档可能只对应 1 次压缩）。
 */
/** 会话 id 归一：DSH 的 Session.id 可能带 `session-` / `session_` 前缀，缓存文件名只用裸 uuid */
export function normalizeSessionId(sid) {
  return String(sid ?? "").trim().replace(/^session[-_]/i, "");
}

/** 投影缓存文件的候选文件名（真实文件名形如 session-<uuid>.json，兼容裸 uuid） */
export function projectionFileCandidates(sid) {
  const base = normalizeSessionId(sid);
  if (!base) return [];
  return [`session-${base}.json`, `${base}.json`];
}

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
