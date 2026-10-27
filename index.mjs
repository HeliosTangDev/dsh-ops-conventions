import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  DEFAULT_BLOCKED_TOOLS,
  compactionHintText,
  compactionStats,
  denyReason,
  isBlockedTool,
  buildStructGates,
  isCheckerCommandSafe,
  isIndexRead,
  isShellWrite,
  isTodoCheck,
  isTodoRead,
  structCheckIds,
  structGatesFor,
  isWriteTool,
  needsGuard,
  normalizeSessionId,
  projectionFileCandidates,
  lastUserText,
  maintHintText,
  readVersion,
  reminderText,
  liveStatusText,
  staleClaimVersions,
  bellIntegrity,
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
 * 配置（可选，全部有默认值，发行版开箱即用）：
 *  - skillsDir:     约定技能目录（默认 $DSH_OPS_CONVENTIONS_DIR 或包自带 skills/）
 *  - logFile:       注入日志（默认 $DSH_OPS_CONVENTIONS_LOG 或 ~/.dsh/ops-conventions/ops-conventions.log）
 *  - enforce:       是否启用硬拦截（默认 true；false = 只注入门铃）
 *  - blockedTools:  拦截的写类工具名（默认 write/edit/multi_edit/apply_patch/notebook_edit）
 *  - bellExtra:     追加到门铃末尾的自定义文本（默认无）
 *  - bellExtraFile: 可选：个人补充规则文件路径；每次注入现读（改文件不必重启）
 *  - todoFile:      可选：待办镜像文件；配置后写操作还要求先跑 todoCheckCmd（默认关闭）
 *  - todoCheckCmd:  可选：待办校验器命令（用于拒绝时直接给出可执行命令）
 *  - maintReport:   可选：维护报告路径；有 Issues 时自动摘要注入（默认关闭）
 *  - structGates:   可选：结构门数组 [{id, pathRe, checkRe, checker}]（默认关闭）
 */
export function apply(ctx, config = {}) {
  const skillsDir = resolveSkillsDir(config);
  const logFile = resolveLogFile(config);
  const indexPath = join(skillsDir, "INDEX.md");
  const versionFile = join(skillsDir, "VERSION");
  // 可选：待办镜像（默认不启用；配置 todoFile 才参与硬拦截）
  const todoFile = typeof config.todoFile === "string" ? config.todoFile : "";
  const maintReport = typeof config.maintReport === "string" ? config.maintReport : "";
  const bellExtra = typeof config.bellExtra === "string" ? config.bellExtra : "";
  // 可选：个人补充规则文件（每次注入时现读，改文件不用重启；文件不存在则回退 bellExtra）
  const bellExtraFile = typeof config.bellExtraFile === "string" ? config.bellExtraFile : "";
  function readBellExtra() {
    if (bellExtraFile) {
      try {
        const t = readFileSync(bellExtraFile, "utf8").trim();
        if (t) return t;
      } catch {
        /* 读不到就回退 */
      }
    }
    return bellExtra;
  }
  const structGates = buildStructGates(config);
  // 可选：现场状态行 / 版本引用核对（默认关闭；需要的文件路径一律由配置传入）
  const statusEnabled = config.status === true;
  const statusTodoJson = typeof config.statusTodoJson === "string" ? config.statusTodoJson : "";
  const hostVersionFile = typeof config.hostVersionFile === "string" ? config.hostVersionFile : "";
  const asarCandidates = Array.isArray(config.asarCandidates) ? config.asarCandidates : [];
  const versionWarning = config.versionWarning === true;
  const versionWarnFile = typeof config.versionWarnFile === "string" ? config.versionWarnFile : "";
  const installedProfileDirs = Array.isArray(config.installedProfileDirs) ? config.installedProfileDirs : [];
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
  let globalMaintSeen = 0;
  let globalStatusSent = false;
  let globalTodoChecked = false; // 无会话时（子代理等）的「跑过待办校验器」标记
  const blockedTools =
    Array.isArray(config.blockedTools) && config.blockedTools.length > 0
      ? config.blockedTools
      : DEFAULT_BLOCKED_TOOLS;
  const todoCheckCmd = typeof config.todoCheckCmd === "string" ? config.todoCheckCmd : "";

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
  const LAST_ASST = Symbol.for("dsh.opsConventions.lastAssistantText");
  const lastAsstBySid = new Map();
  const staleWarnedBySid = new Map();

  // 在回复产生时缓存最后一条 assistant 文本（pre-step 的 messages 里看不到 assistant，
  // 这里用 session/event 抓，供下一轮版本核对使用）。
  let eventShapeCount = 0;
  ctx.on("session/event", (session, event) => {
    try {
      const d = event?.data ?? {};
      const sid0 = session?.id ?? "default";
      const pickText = (o) => {
        if (!o) return "";
        const c = o.content ?? o.text ?? o.message?.content ?? o.message?.text;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : (x && x.text) || "")).join("");
        return "";
      };
      const role = String(d.role ?? d.message?.role ?? event?.role ?? "");
      const type = String(event?.type ?? "");
      if (eventShapeCount < 5) {
        eventShapeCount++;
        log(`session event: type=${type} role=${role} dataKeys=${Object.keys(d).join(",")}`);
      }
      const txt = pickText(d) || pickText(event);
      if (type === "turn/start") lastAsstBySid.delete(sid0);
      if (txt && (/assistant|agent|model/i.test(role) || /assistant|agent|model|response/i.test(type))) {
        const cur = String(lastAsstBySid.get(sid0) || "");
        // 一轮里可能有多条 assistant 事件（分段/增量）：保留最长的一条，避免只拿到碎片
        if (txt.length > cur.length) lastAsstBySid.set(sid0, txt);
        log(`asst capture: type=${type} role=${role} len=${txt.length} kept=${String(lastAsstBySid.get(sid0) || "").length}`);
      }
    } catch (e) {
      log(`session event capture error: ${e?.message ?? String(e)}`);
    }
  });
  const COMPACT_SEEN = Symbol.for("dsh.opsConventions.compactionSeen");
  const MAINT_SEEN = Symbol.for("dsh.opsConventions.maintSeen");
  const STATUS_SENT = Symbol.for("dsh.opsConventions.statusSent");

  ctx.on(
    "agent/pre-step",
    async ({ agent, messages, signal }, next) => {
      const inMessages = messages;
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
          const text2 = reminderText(version, indexPath, { extra: readBellExtra() });
          let injectText = text2;
          const integ = bellIntegrity(fileURLToPath(new URL("./rule.mjs", import.meta.url)), join(skillsDir, "bell_state.json"));
          if (!integ.ok) {
            log(`bell integrity FAIL installed=${String(integ.actual).slice(0, 12)} bound=${String(integ.expected).slice(0, 12)}`);
            injectText = "[门铃完整性告警] 已装 rule.mjs 与版本绑定不一致（被手改、未走 sync.cmd），请跑 sync.cmd 后重启。\n" + text2;
          }
          log(`inject v${version} session=${sid} chars=${injectText.length}`);
          messages = [
            ...messages,
            createUserMessage({
              content: [{ type: "text", text: injectText }],
              source: {
                kind: "plugin:dsh-ops-conventions",
                plugin: "dsh-ops-conventions",
                form: "instructions",
              },
            }),
          ];
        }

        // 现场状态：每会话注入一次，数字直接读文件（仅在配置 status: true 时启用）
        try {
          if (statusEnabled && !(sess ? sess[STATUS_SENT] : globalStatusSent)) {
            if (sess) sess[STATUS_SENT] = true; else globalStatusSent = true;
            const st = liveStatusText({
              asar: process.env.DSH_ASAR,
              versionFile,
              maintReport: maintReport || process.env.OPS_MAINT_REPORT || "",
              todoFile: statusTodoJson,
              hostVersionFile,
              asarCandidates,
            });
            if (st) {
              if (st.includes("host=?")) log("status host unresolved (asar read failed in all candidates)");
              log(`inject status chars=${st.length}`);
              messages = [
                ...messages,
                createUserMessage({
                  content: [{ type: "text", text: st }],
                  source: { kind: "plugin:dsh-ops-conventions", plugin: "dsh-ops-conventions", form: "instructions" },
                }),
              ];
            }
          }
        } catch (err) {
          log(`status inject error: ${err?.message ?? String(err)}`);
        }

        // 维护报告有 Issues → 自动把摘要带进来（仅在配置 maintReport 时启用；每份报告只带一次）
        try {
          const rp = maintReport || process.env.OPS_MAINT_REPORT || "";
          if (rp && existsSyncSafe(rp)) {
            const mt = statSync(rp).mtimeMs;
            const seen = sess ? sess[MAINT_SEEN] : globalMaintSeen;
            if (seen !== mt) {
              const hint = maintHintText(readFileSync(rp, "utf8"), rp);
              if (sess) sess[MAINT_SEEN] = mt; else globalMaintSeen = mt;
              if (hint) {
                log(`inject maint-issues session=${sid} chars=${hint.length}`);
                messages = [
                  ...messages,
                  createUserMessage({
                    content: [{ type: "text", text: hint }],
                    source: { kind: "plugin:dsh-ops-conventions", plugin: "dsh-ops-conventions", form: "instructions" },
                  }),
                ];
              }
            }
          }
        } catch (err) {
          log(`maint hint error: ${err?.message ?? String(err)}`);
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

        // 版本引用核对：上一条回复若在"当前/已装"句里写了非现场版本，注入一行警告（仅在配置 versionWarning: true 时启用）
        if (versionWarning) {
        try {
          const isAssistant = (m) => m && (m.role === "assistant" || m.role === "model" || m.type === "assistant");
          const extractText = (m) => {
            const c = m && (m.content ?? m.parts ?? m.text);
            if (typeof c === "string") return c;
            if (Array.isArray(c)) {
              return c
                .map((x) => (typeof x === "string" ? x : x && typeof x.text === "string" ? x.text : ""))
                .join("\n");
            }
            if (c && typeof c === "object" && typeof c.text === "string") return c.text;
            return "";
          };
          const decMsgs = decision.messages || [];
          const inMsgs = inMessages || [];
          const pick = (arr) => {
            const a = arr.filter(isAssistant);
            return a.length ? a[a.length - 1] : null;
          };
          const prev = pick(decMsgs) || pick(inMsgs);
          const asstCount = decMsgs.filter(isAssistant).length + inMsgs.filter(isAssistant).length;
          const cachedText = String(lastAsstBySid.get(sid) || "");
          const txt = prev ? extractText(prev) : cachedText;
          log(`version scan: dec=${decMsgs.length} in=${inMsgs.length} asst=${asstCount} cached=${cachedText.length} textLen=${txt ? txt.length : -1}`);
          if (txt) {
            const installed = new Set();
            try {
              for (const prof of installedProfileDirs) {
                const pj = JSON.parse(readFileSync(join(prof, "package.json"), "utf8"));
                for (const v of Object.values(pj.dependencies || {})) {
                  const m = String(v).match(/\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?/);
                  if (m) installed.add(m[0]);
                }
              }
            } catch {}
            let host = "";
            try { if (hostVersionFile) host = readFileSync(hostVersionFile, "utf8").trim(); } catch {}
            const stale = staleClaimVersions(txt, { bellVersion: version, host, installed });
            const warnKey = stale.slice().sort().join(",");
            if (stale.length && staleWarnedBySid.get(sid) !== warnKey) {
              staleWarnedBySid.set(sid, warnKey);
              log(`stale version claim: ${stale.join(",")}`);
              // 也落成文件：模型上下文之外，用户和维护报告都能看到这条记录
              try {
                if (versionWarnFile) {
                  appendFileSync(
                    versionWarnFile,
                    `- ${new Date().toISOString()} session=${sid} stale=${stale.join(",")} (live: host=${host || "see status.cmd"}, bell=v${version})\n`,
                    "utf8",
                  );
                }
              } catch {}
              messages = [
                ...messages,
                createUserMessage({
                  content: [{ type: "text", text: `[版本核对] 上一条回复在现状句里写了 ${stale.slice(0, 3).join("、")}，与现场不一致（host=${host || "see status.cmd"}，bell=v${version}）；以 status.cmd 输出为准。` }],
                  source: { kind: "plugin:dsh-ops-conventions", plugin: "dsh-ops-conventions", form: "instructions" },
                }),
              ];
            }
          }
        } catch (err) {
          log(`stale version check error: ${err?.message ?? String(err)}`);
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
        // 校验器白名单：待办/结构检查器是「解锁动作」，必须先放行，否则会死锁。
        // 严格：只认单条校验器命令（禁止 ; && || | 与文件重定向）。
        if (isCheckerCommandSafe(exec.name, exec.arguments, structGates)) return next();
        const writeAttempt = needsGuard(exec.name, exec.arguments, blockedTools);
        if (!writeAttempt) return next();
        const sess = exec?.agent?.session;
        // 有会话用会话标记；无会话（子代理等）用全局标记，不能直接放行
        const idxRead = sess ? !!sess[READ_INDEX] : globalReadIndex;
        // 待办门只认「真的跑过校验器」：读 OPEN.md 只是读规则，不再算数
        const todoDone = sess ? !!sess[TODO_CHECKED] : globalTodoChecked;
        const needTodo = existsSyncSafe(todoFile) && !todoDone;
        // 结构门（可选）：先判，避免被「已读 INDEX」的早退跳过（曾经的 bug）
        const gateIds = structGatesFor(exec.arguments, structGates);
        if (gateIds.length) {
          const checked = sess ? (sess[STRUCT_CHECKED] || {}) : globalStructChecked;
          const missing = gateIds.filter((id) => !checked[id]);
          if (missing.length) {
            const g = missing[0];
            const gate = structGates.find((x) => x.id === g);
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
        if (idxRead && !needTodo) return next();
        if (!sess) log(`guard no-session using-global idx=${idxRead} todo=${todoDone} tool=${exec.name}`);
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
          reason: denyReason(indexPath, version, existsSyncSafe(todoFile) ? todoFile : null, todoCheckCmd, {
            indexRead: idxRead,
            todoChecked: todoDone,
          }),
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
        for (const id of structCheckIds(exec?.name, exec?.arguments, structGates)) {
          globalStructChecked[id] = true;
          log(`guard struct-check id=${id} session=none`);
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
      for (const id of structCheckIds(exec?.name, exec?.arguments, structGates)) {
        sess[STRUCT_CHECKED] = sess[STRUCT_CHECKED] || {};
        sess[STRUCT_CHECKED][id] = true;
        globalStructChecked[id] = true;
        log(`guard struct-check id=${id} session=${sid}`);
      }
    } catch (err) {
      log(`guard observe error: ${err?.message ?? String(err)}`);
    }
  });
}
