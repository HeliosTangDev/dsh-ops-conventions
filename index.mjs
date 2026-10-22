import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  DEFAULT_BLOCKED_TOOLS,
  compactionHintText,
  compactionStats,
  denyReason,
  isBlockedTool,
  isIndexRead,
  isShellWrite,
  isTodoCheck,
  isTodoRead,
  STRUCT_GATES,
  structCheckIds,
  structGatesFor,
  isWriteTool,
  needsGuard,
  normalizeSessionId,
  projectionFileCandidates,
  lastUserText,
  readVersion,
  reminderText,
  resolveLogFile,
  resolveSkillsDir,
  shouldInject,
  skillsDirCandidates,
} from "./rule.mjs";

export const name = "dsh-ops-conventions";
export const inject = ["agents", "tools"];

function existsSyncSafe(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * 让"操作约定"在动手前确定性出现（不依赖记忆召回的运气）：
 *  - 每会话每版本注入一次；VERSION 变了，下一轮就注入（不看轮次类型，闲聊轮也算）
 *  - 硬拦截（enforce，默认开）：操作类轮次里，本会话还没 read INDEX.md 时拒绝写类工具
 * 配置（可选）：
 *  - skillsDir:     约定技能目录（默认 $DSH_OPS_CONVENTIONS_DIR 或 ~/.dsh/ops-conventions/skills）
 *  - logFile:       注入日志（默认 $DSH_OPS_CONVENTIONS_LOG 或 ~/.dsh/ops-conventions/ops-conventions.log）
 *  - enforce:       是否启用硬拦截（默认 true；false = 只注入门铃）
 *  - blockedTools:  拦截的写类工具名（默认 write/edit/multi_edit/apply_patch/notebook_edit）
 */
export function apply(ctx, config = {}) {
  const skillsDir = resolveSkillsDir(config);
  const logFile = resolveLogFile(config);
  const indexPath = join(skillsDir, "INDEX.md");
  const versionFile = join(skillsDir, "VERSION");
  // 待办镜像：<约定目录的上一级>\tasks\OPEN.md（如 D:\software\ToolsDev\tasks\OPEN.md）。
  // 存在才参与硬拦截；不存在则只保留 INDEX 拦截，避免在没有该文件的机器上误拦。
  const todoFile = join(dirname(skillsDir), "tasks", "OPEN.md");
  const delivered = new Map(); // sessionId -> version（兜底）
  const compactionSeen = new Map(); // sessionId -> 已提示过的压缩次数（无 session 对象时兜底）
  const projectionCache = new Map(); // path -> { mtimeMs, size, stats }
  const projectionDir =
    config.sessionCacheDir ??
    process.env.DSH_SESSION_CACHE_DIR ??
    join(homedir(), ".dsh", "storages", "session_projcache", "sessions");

  /** 找到本会话的投影缓存文件（session-<uuid>.json；sid 可能自带 session- 前缀） */
  function projectionPath(sid) {
    if (!sid || sid === "default") return null;
    const base = normalizeSessionId(sid);
    if (!base) return null;
    for (const name of projectionFileCandidates(sid)) {
      const p = join(projectionDir, name);
      if (existsSyncSafe(p)) return p;
    }
    try {
      const hit = readdirSync(projectionDir).find(
        (f) =>
          f.endsWith(".json") &&
          (f.startsWith(`session-${base}`) || f.startsWith(base)),
      );
      if (hit) return join(projectionDir, hit);
    } catch {
      /* 目录不存在或读不了：安静降级 */
    }
    return null;
  }

  /** 读压缩统计（按 mtime+size 缓存，避免每轮都解析大 JSON） */
  function readCompactionStats(sid) {
    try {
      const path = projectionPath(sid);
      if (!path) return null;
      const st = statSync(path);
      const cached = projectionCache.get(path);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.stats;
      const stats = compactionStats(JSON.parse(readFileSync(path, "utf8")));
      projectionCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, stats });
      return stats;
    } catch (err) {
      log(`compaction read error: ${err?.message ?? String(err)}`);
      return null;
    }
  }

  const enforce = config.enforce !== false;
  // 无会话上下文（子代理等）时用全局「已读」标记兜底，避免整类调用绕过守卫
  let globalReadIndex = false;
  let globalReadTodo = false;
  let globalStructChecked = {};
  let globalTodoChecked = false; // 无会话时（子代理等）的「跑过待办校验器」标记
  const blockedTools =
    Array.isArray(config.blockedTools) && config.blockedTools.length > 0
      ? config.blockedTools
      : DEFAULT_BLOCKED_TOOLS;

  function log(line) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${new Date().toISOString()}  ${line}\n`, "utf8");
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  try {
    ctx.logger?.info?.("[ops-conventions] loaded");
  } catch {
    /* ignore */
  }
  log(`plugin loaded  skillsDir=${skillsDir}  indexExists=${existsSyncSafe(indexPath)}`);
  log(`skillsDir candidates: ${skillsDirCandidates(config).join(" | ")}`);
  log(`guard loaded  enforce=${enforce}  blocked=${blockedTools.join(",")}`);

  const GATE = Symbol.for("dsh.opsConventions.injectedVersion");
  const READ_INDEX = Symbol.for("dsh.opsConventions.indexRead");
  const READ_TODO = Symbol.for("dsh.opsConventions.todoMirrorRead");
  const TODO_CHECKED = Symbol.for("dsh.opsConventions.todoChecked");
  const STRUCT_CHECKED = Symbol.for("dsh.opsConventions.structChecked");
  const LAST_TEXT = Symbol.for("dsh.opsConventions.lastUserText");
  const COMPACT_SEEN = Symbol.for("dsh.opsConventions.compactionSeen");

  ctx.on(
    "agent/pre-step",
    async ({ agent, messages, signal }, next) => {
      const decision = await next();
      try {
        if (!decision || decision.kind !== "enter") return decision;
        if (signal?.aborted) return decision;
        const text = lastUserText(decision.messages ?? messages);
        const sess = agent?.session;
        if (sess) sess[LAST_TEXT] = text;

        const version = readVersion(versionFile);
        const sid = agent?.session?.id ?? agent?.id ?? "default";
        const gateHit = sess ? sess[GATE] === version : delivered.get(sid) === version;
        let messages = decision.messages;

        if (!gateHit) {
          if (sess) sess[GATE] = version;
          delivered.set(sid, version);
          const text2 = reminderText(version, indexPath, existsSyncSafe(todoFile) ? todoFile : null);
          log(`inject v${version} session=${sid} chars=${text2.length}`);
          messages = [
            ...messages,
            createUserMessage({
              content: [{ type: "text", text: text2 }],
              source: {
                kind: "plugin:dsh-ops-conventions",
                plugin: "dsh-ops-conventions",
                form: "instructions",
              },
            }),
          ];
        }

        // 会话被自动压缩过 → 次数增加时注入一次提示。
        // 这是机械触发器：不依赖模型自己感知"会话长了"，压缩事件是 DSH 自己记的。
        // 首次看到某个会话时只记基线、不提示：旧会话里的历史压缩不是"刚发生"。
        const stats = readCompactionStats(sid);
        if (stats) {
          const seen = sess ? sess[COMPACT_SEEN] : compactionSeen.get(sid);
          if (seen === undefined) {
            if (sess) sess[COMPACT_SEEN] = stats.count;
            else compactionSeen.set(sid, stats.count);
            if (stats.count > 0) log(`compaction baseline session=${sid} count=${stats.count}`);
          } else if (stats.count > seen) {
            if (sess) sess[COMPACT_SEEN] = stats.count;
            else compactionSeen.set(sid, stats.count);
            const hint = compactionHintText(stats);
            if (hint) {
              log(`compaction hint session=${sid} count=${stats.count}`);
              messages = [
                ...messages,
                createUserMessage({
                  content: [{ type: "text", text: hint }],
                  source: {
                    kind: "plugin:dsh-ops-conventions",
                    plugin: "dsh-ops-conventions",
                    form: "instructions",
                  },
                }),
              ];
            }
          }
        }

        if (messages === decision.messages) return decision;
        return { kind: "enter", messages };
      } catch (err) {
        log(`error: ${err?.message ?? String(err)}`);
        return decision; // 任何意外都不影响正常对话
      }
    },
    { prepend: true },
  );

  // 硬拦截：只要这次调用是"写类动作"，本会话未读 INDEX.md（+ 待办镜像）就拒绝（fail-open：异常放行并记日志）
  ctx.on(
    "tools/pre-execute",
    async (exec, next) => {
      try {
        const writeAttempt = needsGuard(exec.name, exec.arguments);
        if (!writeAttempt) return next();
        // 结构检查器本身永远放行：否则「先跑检查器」会被结构门反过来挡住（死锁）
        if (structCheckIds(exec.name, exec.arguments).length > 0) return next();
        const sess = exec?.agent?.session;
        // 有会话用会话标记；无会话（子代理等）用全局标记，不能直接放行
        const idxRead = sess ? !!sess[READ_INDEX] : globalReadIndex;
        const todoRead = sess
          ? !!sess[READ_TODO] || !!sess[TODO_CHECKED]
          : globalReadTodo || globalTodoChecked;
        const needTodo = existsSyncSafe(todoFile) && !todoRead;
        if (idxRead && !needTodo) return next();
        // 第三道门：写某个区域之前，本会话必须跑过该区域的结构检查器（通用，按路径匹配）
        const gateIds = structGatesFor(exec.arguments);
        if (gateIds.length) {
          const checked = sess ? (sess[STRUCT_CHECKED] || {}) : globalStructChecked;
          const missing = gateIds.filter((id) => !checked[id]);
          if (missing.length) {
            const g = missing[0];
            const gate = STRUCT_GATES.find((x) => x.id === g);
            log(`guard deny-struct gate=${g} session=${sess ? (sess.id ?? "default") : "none"} tool=${exec.name}`);
            return {
              kind: "deny",
              reason:
                `「操作约定｜结构门:${g}」本会话还没跑过该区域的结构检查。先执行：` +
                (gate ? gate.checker : "该区域的结构检查器") +
                "（它会列出结构与规范问题；跑一次即放行，发现问题先修），然后重试本次写操作。",
            };
          }
        }
        if (!sess) log(`guard no-session using-global idx=${idxRead} todo=${todoRead} tool=${exec.name}`);
        if (!enforce) {
          log(`guard skip reason=enforce-off tool=${exec.name}`);
          return next();
        }
        if (!existsSyncSafe(indexPath)) {
          log(`guard skip reason=no-index path=${indexPath}`);
          return next();
        }

        const version = readVersion(versionFile);
        const sid = sess?.id ?? "default";
        log(`guard deny session=${sid} tool=${exec.name} v${version} needTodo=${needTodo}`);
        return {
          kind: "deny",
          reason: denyReason(indexPath, version, existsSyncSafe(todoFile) ? todoFile : null, sess?.[READ_TODO]),
        };
      } catch (err) {
        log(`guard error: ${err?.message ?? String(err)}`);
        return next();
      }
    },
    { prepend: true },
  );

  // 观察成功的 read INDEX.md / tasks\OPEN.md，给本会话记「已读」
  ctx.on("tools/result", (exec, result) => {
    try {
      if (result?.isError) return;
      const sess = exec?.agent?.session;
      if (!sess) {
        if (isIndexRead(exec?.name, exec?.arguments, indexPath)) globalReadIndex = true;
        if (isTodoRead(exec?.name, exec?.arguments, todoFile)) globalReadTodo = true;
        for (const id of structCheckIds(exec?.name, exec?.arguments)) {
          sess[STRUCT_CHECKED] = sess[STRUCT_CHECKED] || {};
          sess[STRUCT_CHECKED][id] = true;
          globalStructChecked[id] = true;
          log(`guard struct-check id=${id} session=${sid}`);
        }
        if (isTodoCheck(exec?.name, exec?.arguments)) {
          globalTodoChecked = true;
          log("guard todo-check (no-session)");
        }
        return;
      }
      const sid = sess.id ?? "default";
      if (isIndexRead(exec?.name, exec?.arguments, indexPath)) {
        sess[READ_INDEX] = true;
        log(`guard index-read session=${sid}`);
      }
      if (isTodoRead(exec?.name, exec?.arguments, todoFile)) {
        sess[READ_TODO] = true;
        log(`guard todo-read session=${sid}`);
      }
      if (isTodoCheck(exec?.name, exec?.arguments)) {
        sess[TODO_CHECKED] = true;
        log(`guard todo-check session=${sid}`);
      }
    } catch (err) {
      log(`guard observe error: ${err?.message ?? String(err)}`);
    }
  });
}
