import { readFileSync, existsSync, openSync, readSync, closeSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** 读 JSON 并容忍 UTF-8 BOM（PowerShell 5.1 的 Set-Content -Encoding utf8 会写 BOM，JSON.parse 不容它）。 */
export function readJsonFile(file) {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

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

/**
 * 注入内容（通用版：不含任何个人约定）。
 * @param {string} version 约定版本
 * @param {string} indexPath INDEX.md 路径
 * @param {object} [opts] { extra?: string } extra 用于用户自定义追加（config.bellExtra）
 */
export function reminderText(version, indexPath, opts = {}) {
  const extra = typeof opts.extra === "string" && opts.extra.trim() ? "\n" + opts.extra.trim() : "";
  return (
    `[操作约定 v${version}] 动手前必须 read ${indexPath} 并执行对应清单；同一会话同一版本只提醒一次。` +
    "收尾按清单自检；清单正文以 INDEX.md 为准，本消息只是提醒。" +
    "若 skill 工具报 unknown（旧会话快照所致），直接 read 该文件即可，不要跳过。" +
    extra
  );
}

/** 维护报告的 Issues 摘要：没有 Issues 返回 ""（正常情况零注入成本）；reportPath 用于提示位置 */
export function maintHintText(report, reportPath = "") {
  const s = String(report ?? "");
  const m = s.match(/##\s*Issues\s*\n([\s\S]*?)(?:\n##\s|$)/);
  if (!m) return "";
  const items = m[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l && !/^none$/i.test(l));
  if (!items.length) return "";
  const head = items.slice(0, 4).join("；");
  const more = items.length > 4 ? ` 等 ${items.length} 项` : "";
  const where = reportPath ? `（${reportPath}）` : "";
  return `[维护报告] ${items.length} 项待处理：${head}${more}${where}`;
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
export function needsGuard(name, args, blocked = DEFAULT_BLOCKED_TOOLS) {
  const n = String(name ?? "").trim();
  if (!n) return true; // 名字缺失，保守拦
  // 配置里点名的工具一律视为"动手"（含 shell：此时只读命令也要先读清单）
  if (isBlockedTool(n, blocked)) return true;
  if (isWriteTool(n, blocked)) return true; // 显式写类优先（如 add_skill 不能被 "skill" 只读后缀放行）
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
    '\\bforfiles\\b|\\bcertutil\\b|\\bbitsadmin\\b',
    '\\b(?:invoke-expression|iex|start-process)\\b',
    '\\b(?:cmd|powershell|pwsh)(?:\\.exe)?\\s+/(?:c|k)\\b',
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

/**
 * 校验器类命令的严格白名单：待办/结构检查器必须能跑，否则死锁。
 * 只放行「单条校验器命令」：出现串联（; && ||）或文件重定向（> 文件）一律不算。
 * 管道仅在右侧是「只显示」cmdlet（Select-Object / Format-* / Out-* 等）时放行，
 * 因为 `检查器 | iex`、`| Remove-Item` 这类等于任意命令后门。
 * 允许 2>&1 / 2>nul / >nul / 2>$null 这类无副作用的重定向。
 */
const PIPE_DISPLAY =
  /^(select-object|select|format-table|format-list|format-wide|out-string|out-host|out-null|sort-object|measure-object|convertto-json|findstr|more)\b/i;

export function isCheckerCommandSafe(name, args, gates = []) {
  if (!SHELL_TOOL.test(String(name ?? "").trim())) return false;
  const isChecker = isTodoCheck(name, args) || structCheckIds(name, args, gates).length > 0;
  if (!isChecker) return false;
  for (const raw of collectStrings(args)) {
    const s = String(raw);
    // 先剥掉无副作用重定向（2>&1 / 2>nul / >nul / 2>$null）
    const stripped = s.replace(/[0-9*]?>\s*(&[12]|nul\b|\$null)/gi, "");
    if (/[;&]/.test(stripped)) return false; // 串联一律拒绝
    const segs = stripped.split("|");
    if (/>/.test(segs[0])) return false; // 主命令不许写文件
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i].trim();
      if (!PIPE_DISPLAY.test(seg)) return false; // 管道右侧只允许显示类命令
      if (/[;&>]/.test(seg)) return false;
    }
  }
  return true;
}

// ---- 通用结构门（可选，默认关闭）：写某区域前，本会话必须跑过该区域的结构检查器 ----
// 通过配置 structGates: [{ id, pathRe, checkRe, checker }] 启用；发行版不带任何路径。
export const STRUCT_GATES = [];

/** 从配置生成结构门（正则字符串 → RegExp；配置非法则忽略该项） */
export function buildStructGates(config = {}) {
  if (!Array.isArray(config.structGates)) return [];
  const out = [];
  for (const g of config.structGates) {
    try {
      if (!g || !g.id || !g.checker) continue;
      out.push({
        id: String(g.id),
        pathRe: g.pathRe ? new RegExp(String(g.pathRe), "i") : /$^/,
        checkRe: g.checkRe ? new RegExp(String(g.checkRe), "i") : /$^/,
        checker: String(g.checker),
        // 可选：只对这些工具生效（如环境门只管 shell，避免编辑文档提到命令名就误拦）
        tools: Array.isArray(g.tools) ? g.tools.map((t) => String(t).toLowerCase()) : [],
      });
    } catch {
      /* 非法正则跳过 */
    }
  }
  return out;
}

/** 这次调用命中了哪些结构门（按参数里的路径匹配；gate 可限定 tools） */
export function structGatesFor(args, gates = [], toolName = "") {
  const ids = [];
  const tn = String(toolName ?? "").trim().toLowerCase();
  for (const raw of collectStrings(args)) {
    const s = String(raw).replace(/\\/g, "/");
    for (const g of gates) {
      if (g.tools && g.tools.length > 0 && tn && !g.tools.includes(tn)) continue;
      if (g.pathRe.test(s) && !ids.includes(g.id)) ids.push(g.id);
    }
  }
  return ids;
}

/** 这条命令是不是某区域的结构检查器（跑过即该门放行） */
export function structCheckIds(name, args, gates = []) {
  if (!SHELL_TOOL.test(String(name ?? "").trim())) return [];
  const ids = [];
  for (const raw of collectStrings(args)) {
    const s = String(raw);
    for (const g of gates) if (g.checkRe.test(s) && !ids.includes(g.id)) ids.push(g.id);
  }
  return ids;
}

/** 硬拦截时回给模型的拒绝理由（只报缺的那几项，且给可直接执行的命令） */
export function denyReason(indexPath, version, todoPath, todoCheckCmd, flags = {}) {
  const v = version ? ` v${version}` : "";
  const parts = [];
  if (!flags.indexRead) parts.push(`read 约定索引 ${indexPath}`);
  if (todoPath && !flags.todoChecked) {
    parts.push(
      todoCheckCmd
        ? `运行待办校验器：${todoCheckCmd}`
        : "运行待办校验器 todo_check.ps1 / todo.cmd（只读型命令，不要再套 ; 或 |）",
    );
  }
  if (parts.length === 0) parts.push(`read 约定索引 ${indexPath}`);
  const gate = !flags.indexRead ? "index" : "todo";
  return (
    `[操作约定${v}｜硬拦截 gate=${gate}] 本会话还没 ` + parts.join("，也没 ") + "。做完后" +
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
  const totals = timeline.totals ?? {};
  const fromTotals = Number(totals.compactions);
  const count = Number.isFinite(fromTotals) && fromTotals > 0 ? fromTotals : comps.length;
  const pressure = rows.contextPressure?.val ?? {};
  const window = timeline.contextWindow ?? pressure.contextWindow ?? null;
  const used = pressure.pressureTokens ?? null;
  return {
    count: count,
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

/**
 * 门铃完整性：已装 rule.mjs 的 sha256 是否等于 bell_state.json 绑定的值。
 * 手改已装副本（绕过 sync.cmd）时返回 ok=false，注入方据此加一行告警。
 * @param {string} ruleFile 已装 rule.mjs 的绝对路径
 * @param {string} stateFile ops-skills/bell_state.json
 */
export function bellIntegrity(ruleFile, stateFile) {
  try {
    const sha = createHash("sha256").update(readFileSync(ruleFile)).digest("hex").toUpperCase();
    if (!existsSync(stateFile)) return { ok: true, reason: "no-state" };
    const st = readJsonFile(stateFile);
    if (!st || !st.sha256) return { ok: true, reason: "bad-state" };
    return { ok: st.sha256 === sha, expected: st.sha256, actual: sha };
  } catch (e) {
    return { ok: true, reason: "error: " + (e && e.message) };
  }
}

/** 读 asar 内 JSON；失败抛错。 */
function readAsarJson(asarPath, innerPath) {  const fd = openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const scanLen = Math.min(head.readUInt32LE(8) + 4096, 16 * 1024 * 1024);
    const raw = Buffer.alloc(scanLen);
    readSync(fd, raw, 0, scanLen, 0);
    const txt = raw.toString("utf8");
    const start = txt.indexOf("{");
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < txt.length; i++) {
      const c = txt[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const dataStart = Math.ceil((end + 1) / 4) * 4;
    const header = JSON.parse(txt.slice(start, end + 1));
    let node = header.files;
    for (const seg of innerPath.split("/")) node = node && node.files ? node.files[seg] : node && node[seg];
    const buf = Buffer.alloc(node.size);
    readSync(fd, buf, 0, node.size, dataStart + Number(node.offset));
    return JSON.parse(buf.toString("utf8"));
  } finally { closeSync(fd); }
}

/**
 * 现场状态一行：宿主版本、门铃 VERSION、维护报告时间/issue 数、待办判定（含采样时间，超过 10 分钟标 stale）、marker。
 * 只读文件，不跑子进程；任何异常返回 ""（fail-open）。
 */
export function liveStatusText(opts = {}) {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    let host = "";
    // 可选：宿主版本缓存文件（由用户自己的 status 脚本写入；不配就不显示）
    try {
      const hf = opts.hostVersionFile || "";
      if (hf && existsSync(hf)) host = readFileSync(hf, "utf8").trim();
    } catch {}
    const exeDir = dirname(process.execPath || "");
    const asarCandidates = [
      opts.asar,
      process.env.DSH_ASAR,
      join(exeDir, "resources", "app.asar"),
      join(exeDir, "..", "resources", "app.asar"),
      ...(Array.isArray(opts.asarCandidates) ? opts.asarCandidates : []),
    ].filter(Boolean);
    for (const ap of asarCandidates) {
      if (host) break;
      for (const inner of ["dsh/package.json", "package.json"]) {
        try { host = readAsarJson(ap, inner).version; break; } catch {}
      }
    }
    // 宿主进程内读 asar 不可靠（2026-10-27 实测全失败）：退化为提示，不再显示 "?"。
    if (!host) host = "see status.cmd";
    let bell = "?";
    try { bell = readFileSync(opts.versionFile, "utf8").trim(); } catch {}
    let maint = "none";
    const rp = opts.maintReport || "";
    if (rp && existsSync(rp)) {
      const st = statSync(rp);
      const txt = readFileSync(rp, "utf8");
      const m = txt.match(/##\s*Issues\s*\n([\s\S]*?)(?:\n##|$)/);
      let n = 0;
      if (m) n = m[1].split(/\r?\n/).filter((l) => /^-/.test(l.trim()) && !/^-?\s*none/i.test(l.trim())).length;
      maint = `${st.mtime.getFullYear()}-${pad(st.mtime.getMonth() + 1)}-${pad(st.mtime.getDate())} ${pad(st.mtime.getHours())}:${pad(st.mtime.getMinutes())} issues=${n}`;
    }
    let todos = "?";
    const tf = opts.todoFile || "";
    if (tf && existsSync(tf)) {
      try {
        const j = readJsonFile(tf);
        const items = Array.isArray(j.items) ? j.items : [];
        const ask = items.filter((x) => String(x.type) === "ask").length;
        todos = `${items.length} (ask ${ask}; run todo_check for verdict)`;
      } catch { todos = "parse-error"; }
    }
    // 待办判定（2026-11-13）：todo_check 每轮由 -Turbo 刷新并写 todoLastFile（todo_last.txt）。
    // 状态行直接展示判定与采样时间；超过 10 分钟标 stale，避免把旧判定当现状报。
    let todoVerdict = "";
    const tlf = opts.todoLastFile || "";
    if (tlf && existsSync(tlf)) {
      try {
        const stl = statSync(tlf);
        const ageMin = (now.getTime() - stl.mtime.getTime()) / 60000;
        const hh = `${pad(stl.mtime.getHours())}:${pad(stl.mtime.getMinutes())}`;
        const m = readFileSync(tlf, "utf8").match(/summary:\s*(open=\d+[^\r\n]*)/);
        if (m) todoVerdict = ageMin <= 10 ? `${m[1].trim()} @${hh}` : `stale ${m[1].trim()} @${hh} - run todo_check`;
      } catch {}
    }
    const marker = rp ? (existsSync(rp.replace(/MAINT-LATEST\.md$/i, "MAINT-OPEN.md")) ? "present" : "absent") : "?";
    const todoPart = todoVerdict ? `todo ${todoVerdict}` : `todo items=${todos}`;
    return `[现场状态 ${ts}] host=${host} bell=v${bell}; maint=${maint}; ${todoPart}; marker=${marker}. 报状态用这里的数字，旧记忆/旧快照作废。`;
  } catch (e) {
    return "";
  }
}

/**
 * 扫上一条助手回复里的「现状声明句」，找出与现场不一致的版本引用。
 * 只报"当前/已装/最新"这类句子里的版本，避免把历史版本误判。
 * @param {string} text 助手回复文本
 * @param {{bellVersion?: string, host?: string, installed?: Set<string>}} live
 * @returns {string[]} 不一致的版本 token
 */
/** 纠正/追问信号：用户消息里出现这些词，视为“可能含可复用思考模式”，写进习惯收件箱待处理 */
export const CORRECTIVE_MARKERS = [
  "为什么", "为啥", "不对", "错了", "漏了", "怎么没", "怎么又",
  "之前", "应该", "还是没", "又回", "别再", "你确定", "保证",
  "没落", "没写", "没跑", "没做", "又忘",
];

export function correctiveSignal(text) {
  const t = String(text ?? "").trim();
  if (t.length < 8) return "";
  for (const m of CORRECTIVE_MARKERS) if (t.includes(m)) return m;
  return "";
}

export function staleClaimVersions(text, live = {}) {
  const claim = /当前|现在|目前|已装|已升到|用的是|最新/;
  const sem = /\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?\b/g;
  const vv = /\bv(\d{1,3})\b/g;
  const installed = live.installed instanceof Set ? live.installed : new Set();
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!claim.test(line)) continue;
    for (const m of line.matchAll(sem)) {
      const v = m[0];
      if (installed.has(v) || v === live.host) continue;
      // 2026-11-11: 插件自身版本与“要求/范围”表达式不是本机现状，别当误报。
      const before = line.slice(Math.max(0, m.index - 30), m.index);
      if (/(插件|plugin)/i.test(before)) continue;
      if (/(要求|需要|engines|peer|版本|>=|<=|>|<|~|\^)\s*[:：]?\s*$/i.test(before)) continue;
      if (/^(\s*(>=|<=|>|<|~|\^))/.test(line.slice(m.index + v.length))) continue;
      out.push(v);
    }
    for (const m of line.matchAll(vv)) {
      const n = m[1];
      if (live.bellVersion && String(live.bellVersion) !== n && Number(n) >= 30) out.push("v" + n);
    }
  }
  return [...new Set(out)];
}

// ---- 只读状态汇总（2026-11-01）：供 ops_status 工具调用；路径全部来自配置，未配置的项不出现 ----

/** 数维护报告的 Issues 条数（与 liveStatusText 同口径） */
function countIssues(text) {
  const m = text.match(/##\s*Issues\s*\n([\s\S]*?)(?:\n##|$)/);
  if (!m) return 0;
  return m[1].split(/\r?\n/).filter((l) => /^-/.test(l.trim()) && !/^-?\s*none/i.test(l.trim())).length;
}

/** 递归数某目录下 .md 文件数与最新修改时间（目录不存在返回 null） */
function memoryTreeStats(dir) {
  try {
    if (!existsSync(dir)) return null;
    const all = readdirSync(dir, { recursive: true });
    let count = 0;
    let latest = 0;
    for (const rel of all) {
      const p = join(dir, String(rel));
      try {
        const st = statSync(p);
        if (!st.isFile() || !/\.md$/i.test(String(rel))) continue;
        count++;
        if (st.mtimeMs > latest) latest = st.mtimeMs;
      } catch {
        /* 单文件失败跳过 */
      }
    }
    return { count, latest: latest ? new Date(latest).toISOString() : null };
  } catch {
    return null;
  }
}

/**
 * 只读状态汇总：门铃版本、插件包版本、待办、维护报告、记忆库、最近日志。
 * 任何一段失败只让该段为 null，不抛异常。
 */

/** 读一个 git ref：先 loose 文件，再 packed-refs。返回 40 位 sha 或 ""。 */
function readGitRef(gitDir, refName) {
  const loose = join(gitDir, ...refName.split("/"));
  try {
    const v = readFileSync(loose, "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(v)) return v;
  } catch {}
  try {
    const packed = readFileSync(join(gitDir, "packed-refs"), "utf8");
    for (const line of packed.split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{40})\s+(\S+)$/);
      if (m && m[2] === refName) return m[1];
    }
  } catch {}
  return "";
}

export function statusSummary(opts = {}) {
  const out = { generatedAt: new Date().toISOString() };

  if (opts.versionFile) {
    try {
      out.bell = { version: readFileSync(opts.versionFile, "utf8").trim() };
    } catch {
      out.bell = null;
    }
  }
  if (opts.packageFile) {
    try {
      const p = readJsonFile(opts.packageFile);
      out.plugin = { name: p.name, version: p.version };
    } catch {
      out.plugin = null;
    }
  }
  if (opts.todoFile) {
    try {
      const j = readJsonFile(opts.todoFile);
      const items = Array.isArray(j.items) ? j.items : [];
      out.todo = {
        items: items.length,
        // declared = how the item is written; NOT the verdict (a done ASK still has type ask)
        declared: {
          ask: items.filter((x) => String(x?.type) === "ask").length,
          machine: items.filter((x) => String(x?.type) !== "ask").length,
        },
      };
      if (opts.todoLastFile && existsSync(opts.todoLastFile)) {
        const st = statSync(opts.todoLastFile);
        out.todo.lastRun = new Date(st.mtimeMs).toISOString();
        const txt = readFileSync(opts.todoLastFile, "utf8");
        const m = txt.match(/summary:[^\r\n]*/i);
        if (m) {
          out.todo.lastSummary = m[0].trim();
          const kv = {};
          for (const part of m[0].replace(/^summary:\s*/i, "").split(/\s+/)) {
            const mm = part.match(/^([a-z]+)=(\d+)$/i);
            if (mm) kv[mm[1].toLowerCase()] = Number(mm[2]);
          }
          if (Object.keys(kv).length) out.todo.verdict = kv;
        }
      }
    } catch {
      out.todo = null;
    }
  }
  if (opts.maintReport) {
    try {
      if (existsSync(opts.maintReport)) {
        const st = statSync(opts.maintReport);
        out.maint = {
          issues: countIssues(readFileSync(opts.maintReport, "utf8")),
          updatedAt: new Date(st.mtimeMs).toISOString(),
        };
      }
    } catch {
      out.maint = null;
    }
  }
  if (opts.memoryDir) out.memory = memoryTreeStats(opts.memoryDir);
  if (opts.logFile) {
    try {
      const txt = readFileSync(opts.logFile, "utf8");
      const lines = txt.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-200);
      let lastInject = null;
      for (const l of tail) {
        const m = l.match(/inject v(\S+).*chars=(\d+)/);
        if (m) lastInject = { at: l.slice(0, 24), version: m[1], chars: Number(m[2]) };
      }
      out.log = {
        lines: lines.length,
        lastInject,
        denyCount: tail.filter((l) => /guard deny/.test(l)).length,
        errorCount: tail.filter((l) => /\berror\b/i.test(l)).length,
      };
    } catch {
      out.log = null;
    }
  }
  if (opts.repoDir) {
    try {
      const gitDir = join(opts.repoDir, ".git");
      const head = readGitRef(gitDir, "refs/heads/main");
      const origin = readGitRef(gitDir, "refs/remotes/origin/main");
      out.repo = {
        head: head ? head.slice(0, 8) : "",
        originMain: origin ? origin.slice(0, 8) : "",
        pushed: !!(head && origin && head === origin),
        unpushedKnown: !!(head && origin),
      };
    } catch {
      out.repo = null;
    }
  }
  if (opts.markerFile) {
    try { out.maintMarker = existsSync(opts.markerFile); } catch { out.maintMarker = null; }
  }
  return out;
}

/**
 * 回复合规扫描（通用）：rules=[{id, pattern, require?, message}]。
 * - pattern 命中 = 触发；
 * - 若规则带 require，则要求 require 也命中，否则记为违规（例：说到 bell=vN 必须带 @HH:mm）。
 * 非法正则/缺字段被跳过，不抛异常。
 */
export function checkReply(text, rules = []) {
  const out = [];
  const t = String(text ?? "");
  if (!t) return out;
  for (const r of rules) {
    if (!r || !r.id || !r.pattern) continue;
    try {
      if (!new RegExp(String(r.pattern)).test(t)) continue;
      if (r.require) {
        let ok = false;
        try {
          ok = new RegExp(String(r.require)).test(t);
        } catch {
          ok = false;
        }
        if (ok) continue;
      }
      const m = new RegExp(String(r.pattern)).exec(t);
      out.push({ id: String(r.id), message: String(r.message || r.id), match: String(m ? m[0] : "").slice(0, 60) });
    } catch {
      /* 非法正则跳过 */
    }
  }
  return out;
}

/**
 * 时间新鲜度检查（0.9.2）：取回复中最后一个 `@HH:mm`，与当前时间比较。
 * 只在该回复出现状态触发词时生效；缺时间格式的情况交给 require 规则。
 * @returns {Array<{id,message,match}>}
 */
export function checkReplyTime(text, opts = {}) {
  const t = String(text ?? "");
  if (!t) return [];
  try {
    const trigger = opts.trigger ? new RegExp(String(opts.trigger)) : /bell=v\d+|现场状态/;
    if (!trigger.test(t)) return [];
    const times = [...t.matchAll(/@(\d{1,2}):(\d{2})/g)];
    if (!times.length) return [];
    const last = times[times.length - 1];
    const now = opts.now instanceof Date ? opts.now : new Date(Number(opts.nowMs) || Date.now());
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(last[1]), Number(last[2]), 0, 0);
    let ageMin = (now.getTime() - d.getTime()) / 60000;
    // 跨零点：时间“在未来”超过 1 小时，按昨天算
    if (ageMin < -60) ageMin += 1440;
    const maxAge = Number(opts.maxAgeMinutes) > 0 ? Number(opts.maxAgeMinutes) : 10;
    const maxFuture = Number(opts.maxFutureMinutes) >= 0 ? Number(opts.maxFutureMinutes) : 5;
    const id = String(opts.id || "status-time-stale");
    if (ageMin > maxAge) {
      return [{ id, message: `最后时间 ${last[0]} 已过期（约 ${Math.round(ageMin)} 分钟前，允许 ${maxAge}）`, match: last[0] }];
    }
    if (ageMin < -maxFuture) {
      return [{ id, message: `最后时间 ${last[0]} 在未来（约 ${Math.abs(Math.round(ageMin))} 分钟）`, match: last[0] }];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 从 assistant 事件/消息里取**正文**文本（0.9.4）：
 * 只拼 type 为空或 "text" 的 part，主动排除 reasoning/thinking/tool-* 等，
 * 否则 Thinking 会被当成“上一条回复”（0.9.3 日志里 head="Key observations:" 就是它）。
 */
export function pickAssistantText(o) {
  if (!o) return "";
  const c = o.content ?? o.text ?? o.message?.content ?? o.message?.text;
  const part = (p) => {
    if (typeof p === "string") return p;
    if (!p || typeof p !== "object") return "";
    const t = String(p.type ?? "");
    if (t && t !== "text") return "";
    return typeof p.text === "string" ? p.text : "";
  };
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(part).join("");
  if (c && typeof c === "object") {
    const t = String(c.type ?? "");
    if (!t || t === "text") return typeof c.text === "string" ? c.text : "";
  }
  return "";
}

/** 整段就是摘要（开头即 User/Summary 等）→ true；正文里引用这些词不算 */
export function isSummaryLike(text) {
  const head = String(text ?? "").slice(0, 60);
  return /^(User|The user|Assistant|Summary|Conversation summary)\b/i.test(head);
}

/** 同一轮多条候选：摘要不占位，非摘要取更长者 */
export function betterAssistantText(prev, next) {
  const p = String(prev ?? "");
  const n = String(next ?? "");
  if (!n) return p;
  if (isSummaryLike(n)) return p;
  return n.length > p.length ? n : p;
}

/** 解析信号文件：每行 `ISO  kind=fail|deny  sid=…  tool=…  msg=…`。只统计窗口内、排除当前会话的条目。 */export function signalSummary(text, excludeSid = "", opts = {}) {
  const windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : 24 * 3600 * 1000;
  const now = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : Date.now();
  const out = { failures: 0, denied: 0, sessions: 0, samples: [] };
  const sids = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(\S+)\s+kind=(\w+)(?:\s+sid=([^\s]*))?(?:\s+tool=([^\s]*))?/);
    if (!m) continue;
    const at = Date.parse(m[1]);
    if (!Number.isFinite(at) || now - at > windowMs) continue;
    const sid = m[3] || "";
    if (excludeSid && sid === excludeSid) continue;
    if (m[2] === "fail") out.failures++;
    else if (m[2] === "deny") out.denied++;
    else continue;
    if (sid) sids.add(sid);
    if (out.samples.length < 3 && m[4]) out.samples.push(m[4]);
  }
  out.sessions = sids.size;
  return out;
}

/** 信号摘要 → 一行注入文本；不足阈值返回 ""（默认 2 起）。 */
export function signalHintText(summary, opts = {}) {
  const s = summary || {};
  const min = Number(opts.min) > 0 ? Number(opts.min) : 2;
  const total = (s.failures || 0) + (s.denied || 0);
  if (total < min) return "";
  const parts = [];
  if (s.failures) parts.push(`${s.failures} 次工具失败`);
  if (s.denied) parts.push(`${s.denied} 次守卫拒绝`);
  const where = s.samples && s.samples.length ? `（${s.samples.join("、")}）` : "";
  const own = opts.scope === "session";
  const when = own ? "本会话" : "最近 24h 其他会话";
  return (
    `[事件信号] ${when}有 ${parts.join("、")}${where}；` +
    `若其中有值得改进的方向，按本机约定处理（大的直接改，小的按规则记录）。`
  );
}

/** 习惯收件箱触发判据：仅用户消息 + 纠正/追问信号 + 足够长度 → 返回摘录，否则 "" */
export function habitCandidate(role, type, text) {
  const r = String(role ?? "").toLowerCase();
  const t = String(type ?? "").toLowerCase();
  if (r.includes("assistant") || r.includes("agent") || r.includes("model")) return "";
  const isUser = r.includes("user") || t.includes("user/message");
  if (!isUser) return "";
  const body = String(text ?? "").trim();
  // 注入内容也会以 user/message 出现（门铃、记忆上下文、技能目录），不算用户追问。
  if (/^(\[操作约定|<openviking-context>|<available-skills>|Instructions from|Relevant memory from OpenViking)/.test(body)) return "";
  if (body.length < 8) return "";
  const marker = correctiveSignal(body);
  if (!marker) return "";
  return body.slice(0, 200);
}
/** 把一次 session/event 转成收件行（纯函数，便于离线模拟；不写磁盘） */
export function habitRow(sid, role, type, text, now = new Date().toISOString()) {
  const cand = habitCandidate(role, type, text);
  if (!cand) return null;
  return {
    ts: now,
    session: String(sid || ""),
    role: String(role || ""),
    type: String(type || ""),
    marker: correctiveSignal(cand),
    text: cand,
  };
}
/** 上下文阈值预警：percent 达到 thresholdPct（>0）时返回提醒文本，否则 ""。 */
export function compactionWarnText(stats, thresholdPct) {
  const pct = Number(stats?.percent);
  const th = Number(thresholdPct);
  if (!Number.isFinite(pct) || !Number.isFinite(th) || th <= 0) return "";
  if (pct < th) return "";
  return `[上下文提醒] 已用 ${pct}%（阈值 ${th}%）。先收尾/分步处理，别再把大段输出堆进上下文；必要时开新会话接主线卡。`;
}
/** 刷新判据（2026-11-11）：写类或执行类工具 -> true；纯只读 -> false。 */
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch", "notebook_edit"]);
const EXEC_TOOLS = new Set(["pwsh", "bash", "cmd", "run_command", "exec"]);
export function isWriteOrExecTool(name) {
  const n = String(name ?? "").toLowerCase();
  if (!n) return false;
  if (WRITE_TOOLS.has(n) || EXEC_TOOLS.has(n)) return true;
  return /^mcp__openviking__(write|edit|add_|forget)/.test(n);
}