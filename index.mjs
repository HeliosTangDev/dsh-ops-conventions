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
  const delivered = new Map(); // sessionId -> version（兜底）
  const compactionSeen = new Map(); // sessionId -> 已提示过的压缩次数（无 session 对象时兜底）
  const projectionCache = new Map(); // path -> { mtimeMs, size, stats }
  const projectionDir =
    config.sessionCacheDir ??
    process.env.DSH_SESSION_CACHE_DIR ??
    join(homedir(), ".dsh", "storages", "session_projcache", "sessions");

  /** 找到本会话的投影缓存文件（session-<id>.json；id 可能是全量或前缀） */
  function projectionPath(sid) {
    if (!sid || sid === "default") return null;
    const exact = join(projectionDir, `session-${sid}.json`);
    if (existsSyncSafe(exact)) return exact;
    try {
      const hit = readdirSync(projectionDir).find(
        (f) => f.startsWith(`session-${sid}`) && f.endsWith(".json"),
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
          const text2 = reminderText(version, indexPath);
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

  // 硬拦截：操作类轮次里，本会话未读 INDEX.md → 拒绝写类工具（fail-open：异常放行并记日志）
  ctx.on(
    "tools/pre-execute",
    async (exec, next) => {
      try {
        const sess = exec?.agent?.session;
        if (!sess) return next();
        if (sess[READ_INDEX]) return next();
        const text = sess[LAST_TEXT];
        if (typeof text !== "string" || !shouldInject(text)) return next();
        if (!enforce || !existsSyncSafe(indexPath)) return next();
        if (!isBlockedTool(exec.name, blockedTools)) return next();

        const version = readVersion(versionFile);
        const sid = sess.id ?? "default";
        log(`guard deny session=${sid} tool=${exec.name} v${version}`);
        return { kind: "deny", reason: denyReason(indexPath, version) };
      } catch (err) {
        log(`guard error: ${err?.message ?? String(err)}`);
        return next();
      }
    },
    { prepend: true },
  );

  // 观察成功的 read INDEX.md，给本会话记「已读」
  ctx.on("tools/result", (exec, result) => {
    try {
      if (result?.isError) return;
      if (!isIndexRead(exec?.name, exec?.arguments, indexPath)) return;
      const sess = exec?.agent?.session;
      if (!sess) return;
      sess[READ_INDEX] = true;
      log(`guard index-read session=${sess.id ?? "default"}`);
    } catch (err) {
      log(`guard observe error: ${err?.message ?? String(err)}`);
    }
  });
}
