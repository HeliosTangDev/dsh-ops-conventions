// 窄工具（窄白名单宿主执行）逻辑框架 —— 2026-11-17 结论的落地骨架。
//
// 设计边界（有意做窄，别在这上面加功能）：
//   · 只暴露「脚本 id + 受限参数」；路径、cwd、解释器全部来自白名单配置，不接受调用方传入。
//   · 参数白名单是字面量集合（allowedArgs），未知参数一律拒；不做通配、不做前缀匹配。
//   · 执行永远 `shell: false`，有超时与输出上限，每次调用写一行审计。
//   · 本模块是纯逻辑 + 单一执行入口：不读 DSH 宿主状态、不碰 fs 以外的全局。
// 上层（index.mjs）只在 config.narrowTool === true 时注册 ops_run 并使用本模块。
import { spawnSync } from "node:child_process";

export const NARROW_LIMITS = {
  timeoutMs: { default: 60_000, max: 600_000 },
  maxOutputBytes: { default: 20_000, max: 1_000_000 },
  argCountMax: 8,
  argLengthMax: 200,
  launcherMax: 6,
};

const norm = (p) => String(p).replace(/\//g, "\\").toLowerCase();

function isAbsolutePath(p) {
  const s = String(p).replace(/\//g, "\\");
  return /^[a-zA-Z]:\\/.test(s) || /^\\\\[^\\]+\\/.test(s);
}

/**
 * 解析并校验白名单配置。
 * @param {unknown} raw 配置对象（通常来自 JSON 文件）
 * @param {{rootDir?: string}} fallback 当 raw.rootDir 缺失时的兜底根目录
 * @returns {{scripts: Map<string, object>, errors: string[], errorsSeen: string[]}}
 */
export function parseNarrowConfig(raw, fallback = {}) {
  const errors = [];
  const scripts = new Map();
  const cfg = raw && typeof raw === "object" ? raw : {};
  const rootDirRaw = typeof cfg.rootDir === "string" && cfg.rootDir.trim() ? cfg.rootDir.trim() : "";
  const rootDir = rootDirRaw || (typeof fallback.rootDir === "string" ? fallback.rootDir : "");

  if (!rootDir || !isAbsolutePath(rootDir)) {
    errors.push("rootDir 必须是绝对路径（配置项 rootDir 或插件配置 rootDir）");
    return { scripts, errors };
  }

  const rootNorm = norm(rootDir).replace(/\\+$/, "") + "\\";
  const list = Array.isArray(cfg.scripts) ? cfg.scripts : [];
  if (!Array.isArray(cfg.scripts)) errors.push("scripts 必须是数组");

  for (const [i, item] of list.entries()) {
    const at = `scripts[${i}]`;
    if (!item || typeof item !== "object") {
      errors.push(`${at}: 必须是对象`);
      continue;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || !/^[a-zA-Z0-9._-]{1,64}$/.test(id)) {
      errors.push(`${at}: id 缺失或不合法（字母数字 . _ -，≤64）`);
      continue;
    }
    if (scripts.has(id)) {
      errors.push(`${at}: id 重复（${id}），保留第一条`);
      continue;
    }
    const path = typeof item.path === "string" ? item.path.trim() : "";
    if (!path || !isAbsolutePath(path)) {
      errors.push(`${at}(${id}): path 必须是绝对路径`);
      continue;
    }
    const pathNorm = norm(path);
    if (pathNorm.includes("..")) {
      errors.push(`${at}(${id}): path 不得包含 ..`);
      continue;
    }
    if (!pathNorm.startsWith(rootNorm)) {
      errors.push(`${at}(${id}): path 不在根目录 ${rootDir} 之内`);
      continue;
    }

    const allowedArgs = Array.isArray(item.allowedArgs)
      ? item.allowedArgs.filter((a) => typeof a === "string" && a.length > 0 && a.length <= NARROW_LIMITS.argLengthMax)
      : [];
    if (Array.isArray(item.allowedArgs) && allowedArgs.length !== item.allowedArgs.length) {
      errors.push(`${at}(${id}): allowedArgs 含非字符串或超长项，已丢弃`);
    }

    // 授权维度：workspaces 必须显式写（默认拒绝）；"*" 表示任意工作区。
    // 写错类型/写相对路径时直接丢弃该条目（宁可未知 id 被拒，也不要静默变成"全拒"或"全放"）。
    const workspaces = normalizeScopeList(item.workspaces, "path");
    if (workspaces === null) {
      errors.push(`${at}(${id}): workspaces 必须是字符串数组（"*" 或绝对路径），该条目已丢弃`);
      continue;
    }
    const sessions = normalizeScopeList(item.sessions, "sid");
    if (sessions === null) {
      errors.push(`${at}(${id}): sessions 必须是字符串数组（"*" 或会话 id），该条目已丢弃`);
      continue;
    }

    const launcher = Array.isArray(item.launcher)
      ? item.launcher.filter((a) => typeof a === "string" && a.length > 0)
      : [];
    if (launcher.length > NARROW_LIMITS.launcherMax) {
      errors.push(`${at}(${id}): launcher 过长（>${NARROW_LIMITS.launcherMax}），已截断`);
    }

    scripts.set(id, {
      id,
      path,
      cwd: rootDir,
      allowedArgs,
      launcher: launcher.slice(0, NARROW_LIMITS.launcherMax),
      timeoutMs: clampNumber(item.timeoutMs, NARROW_LIMITS.timeoutMs),
      maxOutputBytes: clampNumber(item.maxOutputBytes, NARROW_LIMITS.maxOutputBytes),
      workspaces: workspaces ?? [],
      sessions: sessions ?? [],
    });
  }

  return { scripts, errors };
}

/**
 * 归一化授权列表：字符串数组；path 类只允许 "*" 或绝对路径，sid 类只允许 "*" 或非空串。
 * @returns {string[]|null} null 表示给了但不是字符串数组（调用方记错误）
 */
function normalizeScopeList(value, kind) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s) continue;
    if (s === "*") {
      out.push("*");
      continue;
    }
    if (kind === "path" && !isAbsolutePath(s)) return null;
    out.push(s);
  }
  return out;
}

/**
 * 取调用方工作区：会话对象上不同版本把 cwd 放在不同位置（header.cwd / meta.cwd / cwd / workspace.path），
 * 逐个尝试；都取不到返回空串（授权判定按默认拒绝处理）。
 * @param {object} sess 会话对象（exec.agent.session）
 * @param {object} agent 可选，exec.agent
 */
export function resolveCallerWorkspace(sess, agent) {
  const pick = (v) => (typeof v === "string" && v.trim() ? v : "");
  const candidates = [
    pick(sess?.cwd),
    pick(sess?.header?.cwd),
    pick(sess?.meta?.cwd),
    pick(sess?.workspace?.path),
    pick(sess?.workspacePath),
    pick(sess?.workspaceDir),
    pick(agent?.cwd),
    pick(agent?.workspace?.path),
  ];
  return candidates.find(Boolean) ?? "";
}

const normWs = (p) => String(p ?? "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/**
 * 判断“这次调用来自哪个会话/工作区”是否在该条目授权范围内（fail-closed）。
 * workspaces 未写 = 拒绝（必须在白名单里显式写范围，或写 ["*"] 表示全局）。
 * sessions 未写 = 不额外限制（仍受 workspaces 约束）。
 * @param {object} entry 白名单条目
 * @param {{workspace?: string, sid?: string}} caller 调用方身份
 */
export function callerAllowed(entry, caller = {}) {
  const workspaces = Array.isArray(entry?.workspaces) ? entry.workspaces : [];
  const sessions = Array.isArray(entry?.sessions) ? entry.sessions : [];
  const sid = String(caller.sid ?? "");

  if (sessions.length > 0 && !sessions.includes("*") && !sessions.includes(sid)) {
    return { ok: false, reason: `会话 ${sid || "(unknown)"} 不在该条目的 sessions 白名单内` };
  }
  if (workspaces.length === 0) {
    return { ok: false, reason: "该条目没有写 workspaces（默认拒绝；全局请显式写 [\"*\"]）" };
  }
  if (workspaces.includes("*")) return { ok: true };

  const ws = normWs(caller.workspace);
  if (!ws) {
    return { ok: false, reason: "拿不到调用方工作区（会话未提供 cwd/workspace），按默认拒绝处理" };
  }
  for (const allowed of workspaces) {
    const a = normWs(allowed);
    if (ws === a || ws.startsWith(a + "\\")) return { ok: true };
  }
  return { ok: false, reason: `工作区 ${caller.workspace} 不在该条目的 workspaces 白名单内` };
}

function clampNumber(value, { default: def, max }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

/**
 * 规划一次调用：id 必须在白名单里，参数必须逐项命中 allowedArgs。
 * @returns {{ok: boolean, reason?: string, entry?: object, argv?: string[], cwd?: string}}
 */
export function planNarrowRun(scripts, id, args = []) {
  const entry = scripts instanceof Map ? scripts.get(String(id)) : scripts?.[String(id)];
  if (!entry) return { ok: false, reason: `未知脚本 id: ${id}（不在白名单）` };

  const list = args === undefined || args === null ? [] : args;
  if (!Array.isArray(list)) return { ok: false, reason: "args 必须是字符串数组" };
  if (list.length > NARROW_LIMITS.argCountMax) {
    return { ok: false, reason: `参数过多（>${NARROW_LIMITS.argCountMax}）` };
  }
  for (const a of list) {
    if (typeof a !== "string") return { ok: false, reason: "参数必须全部是字符串" };
    if (!a.length || a.length > NARROW_LIMITS.argLengthMax) {
      return { ok: false, reason: `参数长度不合法（1..${NARROW_LIMITS.argLengthMax}）` };
    }
    if (!entry.allowedArgs.includes(a)) {
      return { ok: false, reason: `参数未授权: ${a}（允许: ${entry.allowedArgs.join(", ") || "无"}）` };
    }
  }

  return { ok: true, entry, argv: [entry.path, ...list], cwd: entry.cwd };
}

/**
 * 执行一次已规划的调用。spawn / audit 可注入，便于测试。
 * 不抛异常：一切失败都折成 {ok:false, error}。
 */
export async function runNarrow(entry, args = [], deps = {}) {
  const spawn = typeof deps.spawn === "function" ? deps.spawn : defaultSpawn;
  const audit = typeof deps.audit === "function" ? deps.audit : () => {};
  const launcher = Array.isArray(entry?.launcher) ? entry.launcher : [];
  const file = launcher.length ? launcher[0] : entry.path;
  const argv = [...launcher.slice(1), entry.path, ...args];
  const started = Date.now();

  let raw;
  try {
    raw = spawn(file, argv, {
      shell: false,
      cwd: entry.cwd,
      timeoutMs: entry.timeoutMs,
      maxOutputBytes: entry.maxOutputBytes,
    });
  } catch (err) {
    const error = err?.message ?? String(err);
    audit(`${new Date().toISOString()} narrow run id=${entry.id} error=${error}`);
    return { ok: false, code: null, stdout: "", stderr: "", timedOut: false, truncated: false, error, durationMs: Date.now() - started };
  }

  const limit = entry.maxOutputBytes;
  const stdoutRaw = decodeOutput(raw?.stdout);
  const stderrRaw = decodeOutput(raw?.stderr);
  const truncated = stdoutRaw.length > limit || stderrRaw.length > limit;
  const result = {
    ok: raw?.ok === true && raw?.timedOut !== true,
    code: raw?.code ?? null,
    stdout: stdoutRaw.slice(0, limit),
    stderr: stderrRaw.slice(0, limit),
    timedOut: raw?.timedOut === true,
    truncated,
    error: typeof raw?.error === "string" ? raw.error : "",
    durationMs: Date.now() - started,
  };
  audit(
    `${new Date().toISOString()} narrow run id=${entry.id} exit=${result.code} timeout=${result.timedOut} ` +
      `truncated=${result.truncated} duration=${result.durationMs}ms`,
  );
  return result;
}

function decodeOutput(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8;
  try { return new TextDecoder("gbk").decode(buf); } catch { return utf8; }
}

function defaultSpawn(file, argv, opts) {
  const r = spawnSync(file, argv, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    encoding: "buffer",
    shell: false,
    windowsHide: true,
    maxBuffer: Math.max(opts.maxOutputBytes * 8, 1024 * 1024),
    env: process.env,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    timedOut: r.error?.code === "ETIMEDOUT",
    error: r.error ? String(r.error.message) : "",
  };
}
