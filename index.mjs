import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  DEFAULT_BLOCKED_TOOLS,
  compactionHintText,
  compactionWarnText,
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
  isWriteOrExecTool,
  needsGuard,
  normalizeSessionId,
  projectionFileCandidates,
  lastUserText,
  pickAssistantText,
  isSummaryLike,
  betterAssistantText,
  habitCandidate,
  habitRow,
  correctiveSignal,
  maintHintText,
  signalSummary,
  signalHintText,
  readVersion,
  reminderText,
  liveStatusText,
  statusSummary,
  staleClaimVersions,
  checkReply,
  checkReplyTime,
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
  const signalsFile = typeof config.signalsFile === "string" ? config.signalsFile : "";
  const signalsHint = typeof config.signalsHint === "string" ? config.signalsHint : "";
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
  // 大任务预规划门（2026-11-04）：累计写入不同文件/目录到阈值后，要求存在六段 PLAN.md
  const planGate = config.planGate === true;
  const planGateAfterFiles = Number(config.planGateAfterFiles) > 0 ? Number(config.planGateAfterFiles) : 4;
  const planGateAfterDirs = Number(config.planGateAfterDirs) > 0 ? Number(config.planGateAfterDirs) : 3;
  const planFile = typeof config.planFile === "string" ? config.planFile : "";
  const FILE_EDIT_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch", "notebook_edit"]);
  const PLAN_FILES = Symbol.for("dsh.opsConventions.planFiles");
  const PLAN_DIRS = Symbol.for("dsh.opsConventions.planDirs");
  const globalPlanFiles = new Set();
  const globalPlanDirs = new Set();
  const normPath = (p) => String(p).replace(/\//g, "\\").toLowerCase();
  const isPlanTarget = (p) => !!p && normPath(p) === normPath(planFile);
  const writeTarget = (exec) => {
    const a = exec?.arguments || {};
    const p = a.path ?? a.file_path ?? a.filePath ?? a.notebook_path ?? a.target_file;
    if (typeof p === "string") return p;
    if (Array.isArray(a.paths) && typeof a.paths[0] === "string") return a.paths[0];
    if (Array.isArray(a.edits)) {
      const e = a.edits.find((x) => x && (x.path || x.file_path));
      if (e) return e.path || e.file_path;
    }
    return "";
  };
  const planSectionsOk = () => {
    try {
      const txt = readFileSync(planFile, "utf8");
      return (txt.match(/^##\s*[1-6]\./gm) || []).length >= 6;
    } catch {
      return false;
    }
  };
  // 可选：现场状态行 / 版本引用核对（默认关闭；需要的文件路径一律由配置传入）
  const statusEnabled = config.status === true;
  const statusTodoJson = typeof config.statusTodoJson === "string" ? config.statusTodoJson : "";
  const hostVersionFile = typeof config.hostVersionFile === "string" ? config.hostVersionFile : "";
  const asarCandidates = Array.isArray(config.asarCandidates) ? config.asarCandidates : [];
  const versionWarning = config.versionWarning === true;
  const versionWarnFile = typeof config.versionWarnFile === "string" ? config.versionWarnFile : "";
  const installedProfileDirs = Array.isArray(config.installedProfileDirs) ? config.installedProfileDirs : [];
  // 可选：只读状态工具 ops_status（默认关闭）
  const statusTool = config.statusTool === true;
  const todoLastFile = typeof config.todoLastFile === "string" ? config.todoLastFile : "";
  const memoryDir = typeof config.memoryDir === "string" ? config.memoryDir : "";
  // 可选：回复合规扫描（规则由个人配置提供；命中在下一轮注入警告 + 落文件）
  const replyChecks = Array.isArray(config.replyChecks) ? config.replyChecks : [];
  const replyWarnFile =
    typeof config.replyWarnFile === "string" && config.replyWarnFile ? config.replyWarnFile : versionWarnFile;
  const replyWarnedBySid = new Map();
  // 可选：把回复违规升级为门禁（只拦写类工具，最多罚 1 轮，避免死锁）
  const replyCheckBlock = config.replyCheckBlock === true;
  // 可选：检查回复里最后一个 @HH:mm 是否本轮（超时/未来即违规）
  const replyTimeCheck =
    config.replyTimeCheck && typeof config.replyTimeCheck === "object" ? config.replyTimeCheck : null;
  const delivered = new Map(); // sessionId -> version（兜底）
  const compactionSeen = new Map(); // sessionId -> 已提示过的压缩次数（无 session 对象时兜底）
  const compactWarnSeen = new Map(); // sessionId -> 是否已发过阈值预警
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

  // Append one line to an evidence file, keeping at most 300 lines.
  function appendRotated(file, line, keep = 300) {
    try {
      const prev = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
      const next = [...prev, line].slice(-keep);
      writeFileSync(file, next.join("\n") + "\n", "utf8");
    } catch (e) {
      log(`rotate warn file failed: ${e?.message ?? String(e)}`);
    }
  }

  const SIGNAL_SEEN = Symbol.for("dsh.opsConventions.signalSeen");
  const SIGNAL_SEEN_AT = Symbol.for("dsh.opsConventions.signalSeenAt");
  function fmtSignalMsg(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v.message === "string" && v.message) return v.message;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  function appendSignal(kind, sid, tool, msg) {
    if (!signalsFile) return;
    try {
      appendFileSync(signalsFile, `${new Date().toISOString()}  kind=${kind}  sid=${sid || ""}  tool=${tool || ""}  msg=${String(msg || "").replace(/\s+/g, " ").slice(0, 160)}\n`, "utf8");
      // keep the file small: trim to the last 200 lines once it passes 256 KB
      try {
        if (statSync(signalsFile).size > 262144) {
          const keep = readFileSync(signalsFile, "utf8").split("\n").filter(Boolean).slice(-200);
          writeFileSync(signalsFile, keep.join("\n") + "\n", "utf8");
        }
      } catch {}
    } catch {}
  }

  function log(line) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${new Date().toISOString()}  ${line}\n`, "utf8");
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  // 常驻检查刷新（2026-11-11）：每轮开始跑一次 -Turbo（<1s）；写/执行后 10 秒 debounce 加速。
  const checksRunner = typeof config.checksRunner === "string" ? config.checksRunner : "D:\\software\\ToolsUse\\_tools\\checks\\run_turbo.ps1";
  const checksState = typeof config.checksState === "string" ? config.checksState : "D:\\software\\ToolsUse\\_tools\\checks\\last-fast.json";
  let checksDirty = false;
  let checksTimer = null;
  let lastChecksRun = 0;
  // 异步刷新：起 run_turbo.ps1 后立即返回，不阻塞轮次；状态行读它写的 JSON。
  // 2026-11-10 修复：宿主（打包应用）的 PATH 可能不含 WindowsPowerShell 目录，
  // 只写 "powershell.exe" 会异步 ENOENT，而旧代码没有 error 监听 → 刷新永远不落盘且日志只留 scheduled。
  const checksShell = process.env.SystemRoot
    ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  function runChecksFast(reason) {
    checksDirty = false;
    if (checksTimer) { clearTimeout(checksTimer); checksTimer = null; }
    lastChecksRun = Date.now();
    try {
      const child = spawn(checksShell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", checksRunner], { detached: true, stdio: "ignore" });
      child.on("error", (e) => log(`checks refresh error: ${e?.message ?? String(e)} shell=${checksShell} runner=${checksRunner}`));
      child.on("exit", (code, sig) => log(`checks refresh exit: code=${code} sig=${sig ?? ""} runner=${checksRunner}`));
      if (child.unref) child.unref();
      log(`checks refresh scheduled: ${reason}`);
    } catch (e) {
      log(`checks refresh error: ${e?.message ?? String(e)}`);
    }
  }
  function markChecksDirty(tool) {
    checksDirty = true;
    if (checksTimer) clearTimeout(checksTimer);
    checksTimer = setTimeout(() => runChecksFast("debounce:" + String(tool || "")), 10000);
    if (checksTimer.unref) checksTimer.unref();
  }
  // 习惯收件箱（2026-11-11）：用户消息含纠正/追问信号时，自动落一条待处理记录。
  // 触发点：session/event 的 user/message（日志已实证存在）；处理点：收尾 habit_inbox.ps1 -Check。
  const habitInbox = join(dirname(logFile), "habit_inbox.jsonl");
  const habitSeen = new Map();
  function captureHabit(sid, role, type, text) {
    try {
      const userish = /user/i.test(String(role || "")) || /user\/message/i.test(String(type || ""));
      if (userish) {
        log(`habit see: role=${role} type=${type} len=${String(text || "").length} marker=${correctiveSignal(text)}`);
      }
      const cand = habitCandidate(role, type, text);
      if (!cand) return;
      const last = habitSeen.get(sid);
      if (last === cand) return;
      habitSeen.set(sid, cand);
      const row = {
        ts: new Date().toISOString(),
        session: String(sid || ""),
        role: String(role || ""),
        type: String(type || ""),
        marker: correctiveSignal(cand),
        text: cand,
      };
      mkdirSync(dirname(habitInbox), { recursive: true });
      appendFileSync(habitInbox, JSON.stringify(row) + "\n", "utf8");
      log(`habit inbox: marker=${row.marker} session=${row.session} head=${JSON.stringify(cand.slice(0, 40))}`);
    } catch (e) {
      log(`habit inbox error: ${e?.message ?? String(e)}`);
    }
  }

  // 加载自检（2026-11-11）：不依赖用户发消息，起进程就能证明“判据→落行”链路是否通。
  const habitSelftestFile = join(dirname(logFile), "habit_selftest.jsonl");
  if (config.habitSelfTest !== false) {
    try {
      const row = habitRow("selftest", "user", "user/message", "为什么自检触发？");
      if (!row) {
        log("habit selftest: fail (no row)");
      } else {
        mkdirSync(dirname(habitSelftestFile), { recursive: true });
        appendFileSync(habitSelftestFile, JSON.stringify(row) + "\n", "utf8");
        log(`habit selftest: ok marker=${row.marker} file=${habitSelftestFile}`);
      }
    } catch (e) {
      log(`habit selftest: error ${e?.message ?? String(e)}`);
    }
  }

  // 总开关：enabled=false 时保持加载但不注册任何钩子（零注入、零拦截、零扫描）
  if (config.enabled === false) {
    log("plugin disabled by config.enabled=false (no hooks registered)");
    return;
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
  const prevReplyBySid = new Map();   // last COMPLETED turn reply (used by the version scan)
  let prevReplyGlobal = "";           // fallback: last completed reply regardless of session id
  let lastAccSid = "";                // session id that produced lastAsstBySid's newest content
  const staleWarnedBySid = new Map();
  const REPLY_VIOLATION = Symbol.for("dsh.opsConventions.replyViolation");
  let replyViolationGlobal = null; // 无 session（子代理等）时兜底

  // 在回复产生时缓存最后一条 assistant 文本（pre-step 的 messages 里看不到 assistant，
  // 这里用 session/event 抓，供下一轮版本核对使用）。
  let eventShapeCount = 0;
  ctx.on("session/event", (session, event) => {
    try {
      const d = event?.data ?? {};
      const sid0 = session?.id ?? "default";
      const pickText = (o) => pickAssistantText(o);
      const role = String(d.role ?? d.message?.role ?? event?.role ?? "");
      const type = String(event?.type ?? "");
      if (eventShapeCount < 5) {
        eventShapeCount++;
        log(`session event: type=${type} role=${role} sid=${sid0} dataKeys=${Object.keys(d).join(",")}`);
      }
      const txt = pickText(d) || pickText(event);
      captureHabit(sid0, role, type, txt);
      if (type === "tool/result") {
        const tool = String(d.tool ?? d.name ?? d.toolName ?? d.call?.tool ?? d.toolName ?? "");
        if (!tool || isWriteOrExecTool(tool)) markChecksDirty(tool || "unknown");
      } else if (type === "turn/end") {
        if (checksDirty) runChecksFast("turn-end");
      }
      if (type === "turn/start") {
        const done = String(lastAsstBySid.get(sid0) || "");
        if (done.trim()) {
          prevReplyBySid.set(sid0, done);
          prevReplyGlobal = done;
        }
        // also move the key that actually accumulated text, in case the ids differ
        if (lastAccSid && lastAccSid !== sid0) {
          const acc = String(lastAsstBySid.get(lastAccSid) || "");
          if (acc.trim()) {
            prevReplyBySid.set(lastAccSid, acc);
            prevReplyGlobal = acc;
          }
          lastAsstBySid.delete(lastAccSid);
        }
        lastAsstBySid.delete(sid0);
      }
      if (txt && (/assistant|agent|model/i.test(role) || /assistant|agent|model|response/i.test(type))) {
        const cur = String(lastAsstBySid.get(sid0) || "");
        const chosen = betterAssistantText(cur, txt);
        if (chosen !== cur) { lastAsstBySid.set(sid0, chosen); lastAccSid = sid0; }
        log(`asst capture: type=${type} role=${role} sid=${sid0} len=${txt.length} kept=${chosen.length} head=${JSON.stringify(txt.slice(0, 40))}${isSummaryLike(txt) ? " (summary-skip)" : ""}`);
      }
    } catch (e) {
      log(`session event capture error: ${e?.message ?? String(e)}`);
    }
  });
  const COMPACT_SEEN = Symbol.for("dsh.opsConventions.compactionSeen");
  const COMPACT_WARN_SEEN = Symbol.for("dsh.opsConventions.compactWarnSeen");
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
          // 每轮开始刷新一次（10 秒内已跑过则复用），保证状态最多滞后一轮。
          try {
            if (statusEnabled && Date.now() - lastChecksRun > 5 * 60 * 1000) runChecksFast("turn");
          } catch {}
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
            let st2 = st;
            try {
              if (st && existsSync(checksState)) {
                const c = JSON.parse(readFileSync(checksState, "utf8"));
                const d2 = new Date(c.ts);
                const hh = String(d2.getHours()).padStart(2, "0");
                const mm = String(d2.getMinutes()).padStart(2, "0");
                const age = (Date.now() - d2.getTime()) / 60000;
                if (Number(c.pass) >= 0) st2 = st + ` | checks=${c.pass}/${Number(c.pass) + Number(c.fail)} @${hh}:${mm}` + (age > 5 ? "(old)" : "");
              }
            } catch {}
            if (st2) {
              if (st.includes("host=?")) log("status host unresolved (asar read failed in all candidates)");
              log(`inject status chars=${st.length}`);
              messages = [
                ...messages,
                createUserMessage({
                  content: [{ type: "text", text: st2 }],
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

        // event signals: other sessions (>=2) once, and this session (>=3) at most once per 20 min
        try {
          if (signalsFile && existsSyncSafe(signalsFile)) {
            const text = readFileSync(signalsFile, "utf8");
            const other = signalSummary(text, sid, {});
            const mine = signalSummary(text, "", {});
            const own = { failures: mine.failures - other.failures, denied: mine.denied - other.denied };
            const lastAt = (sess && sess[SIGNAL_SEEN_AT]) || 0;
            const cooldown = 20 * 60 * 1000;
            let hint = "";
            if (other.failures + other.denied >= 2 && !(sess && sess[SIGNAL_SEEN])) {
              hint = signalsHint || signalHintText(other);
              if (sess) sess[SIGNAL_SEEN] = true;
            } else if (own.failures + own.denied >= 3 && Date.now() - lastAt > cooldown) {
              hint = signalsHint || signalHintText(own, { scope: "session" });
              if (sess) sess[SIGNAL_SEEN_AT] = Date.now();
            }
            if (hint) {
              log(`inject signals session=${sid} other=${other.failures + other.denied} own=${own.failures + own.denied}`);
              messages = [
                ...messages,
                createUserMessage({
                  content: [{ type: "text", text: hint }],
                  source: { kind: "plugin:dsh-ops-conventions", plugin: "dsh-ops-conventions", form: "instructions" },
                }),
              ];
            }
          }
        } catch (err) {
          log(`signal hint error: ${err?.message ?? String(err)}`);
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

        // 阈值预警（2026-11-11 A 案）：达到 compactWarnPct 时每会话提醒一次，不等压缩发生。
        const compactWarnPct = Number(config.compactWarnPct ?? 0);
        if (stats && compactWarnPct > 0) {
          const warned = sess ? sess[COMPACT_WARN_SEEN] : compactWarnSeen.get(sid);
          if (!warned) {
            const warnText = compactionWarnText(stats, compactWarnPct);
            if (warnText) {
              if (sess) sess[COMPACT_WARN_SEEN] = true;
              else compactWarnSeen.set(sid, true);
              log(`compaction warn session=${sid} percent=${stats.percent} threshold=${compactWarnPct}`);
              messages = [
                ...messages,
                createUserMessage({
                  content: [{ type: "text", text: warnText }],
                  source: { kind: "plugin:dsh-ops-conventions", plugin: "dsh-ops-conventions", form: "instructions" },
                }),
              ];
            }
          }
        }
        // 版本引用核对 + 回复合规扫描：都在下一轮 pre-step 里检查上一条回复
        //   - versionWarning: 现状句写了非现场版本 → 警告
        //   - replyChecks:   个人配置的回复规则（两段式/禁词等）→ 警告
        if (versionWarning || replyChecks.length > 0) {
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
          const prevTurn = String(prevReplyBySid.get(sid) || "") || prevReplyGlobal;
          const txt = (prev ? extractText(prev) : "") || prevTurn || cachedText;
          log(`version scan: dec=${decMsgs.length} in=${inMsgs.length} asst=${asstCount} sid=${sid} prevTurn=${prevTurn.length} cached=${cachedText.length} textLen=${txt ? txt.length : -1}`);
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
                  appendRotated(
                    versionWarnFile,
                    `- ${new Date().toISOString()} session=${sid} stale=${stale.join(",")} (live: host=${host || "see status.cmd"}, bell=v${version})`,
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
            if (replyChecks.length) {
              let hits = checkReply(txt, replyChecks);
              if (replyTimeCheck) hits = hits.concat(checkReplyTime(txt, { ...replyTimeCheck, nowMs: Date.now() }));
              const key = hits.map((h) => h.id).sort().join(",");
              log(`reply-scan len=${txt.length} hits=${hits.length} ids=${key || "-"} head=${JSON.stringify(txt.slice(0, 60))}`);
              if (hits.length) {
                // 记录违规（供门禁使用）；同一 key 连续出现则 turns+1
                const prev = sess ? sess[REPLY_VIOLATION] : replyViolationGlobal;
                const turns = prev && prev.key === key ? (prev.turns || 1) + 1 : 1;
                const rec = { key, ids: hits.map((h) => h.id), turns };
                if (sess) sess[REPLY_VIOLATION] = rec; else replyViolationGlobal = rec;
                if (replyWarnedBySid.get(sid) !== key) {
                  replyWarnedBySid.set(sid, key);
                  log(`reply-check: ${hits.map((h) => h.id).join(",")} turns=${turns}`);
                  try {
                    if (replyWarnFile) {
                      appendRotated(
                        replyWarnFile,
                        `- ${new Date().toISOString()} session=${sid} reply=${hits.map((h) => h.id).join(",")} turns=${turns}`,
                      );
                    }
                  } catch {}
                  messages = [
                    ...messages,
                    createUserMessage({
                      content: [
                        {
                          type: "text",
                          text: `[回复核对] 上一条回复命中：${hits.map((h) => `${h.id}（${h.message}）`).join("；")}；按清单修正。`,
                        },
                      ],
                      source: { kind: "plugin:dsh-ops-conventions", plugin: "dsh-ops-conventions", form: "instructions" },
                    }),
                  ];
                }
              } else if (sess ? sess[REPLY_VIOLATION] : replyViolationGlobal) {
                if (sess) delete sess[REPLY_VIOLATION]; else replyViolationGlobal = null;
                replyWarnedBySid.delete(sid);
                log(`reply-check cleared session=${sid}`);
              }
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
        // 回复合规门（可选，2026-11-08）：上一轮回复违规 → 本轮拒绝写类工具；
        // 同一违规连续两轮则自动解除（防误报死锁）。
        if (replyCheckBlock) {
          const rv = sess ? sess[REPLY_VIOLATION] : replyViolationGlobal;
          if (rv) {
            if (rv.turns >= 2) {
              if (sess) delete sess[REPLY_VIOLATION]; else replyViolationGlobal = null;
              log(`guard reply-check auto-clear ids=${rv.key} session=${sess ? (sess.id ?? "default") : "none"}`);
            } else {
              log(`guard deny-reply-check ids=${rv.key} session=${sess ? (sess.id ?? "default") : "none"} tool=${exec.name}`);
              appendSignal("deny", sess ? (sess.id ?? "default") : "default", exec.name, "gate=reply-check:" + rv.key);
              return {
                kind: "deny",
                reason:
                  `「操作约定｜回复核对」上一条回复命中 ${rv.key}。` +
                  "按约定补上缺失内容（例如报状态要带命令、采样时间与数据年龄）后，再重试本次写操作。",
              };
            }
          }
        }
        // 有会话用会话标记；无会话（子代理等）用全局标记，不能直接放行
        const idxRead = sess ? !!sess[READ_INDEX] : globalReadIndex;
        // 待办门只认「真的跑过校验器」：读 OPEN.md 只是读规则，不再算数
        const todoDone = sess ? !!sess[TODO_CHECKED] : globalTodoChecked;
        const needTodo = existsSyncSafe(todoFile) && !todoDone;
        // 结构门（可选）：先判，避免被「已读 INDEX」的早退跳过（曾经的 bug）
        const gateIds = structGatesFor(exec.arguments, structGates, exec.name);
        if (gateIds.length) {
          const checked = sess ? (sess[STRUCT_CHECKED] || {}) : globalStructChecked;
          const missing = gateIds.filter((id) => !checked[id]);
          if (missing.length) {
            const g = missing[0];
            const gate = structGates.find((x) => x.id === g);
            log(`guard deny-struct gate=${g} session=${sess ? (sess.id ?? "default") : "none"} tool=${exec.name}`);
          appendSignal("deny", sess ? (sess.id ?? "default") : "default", exec.name, "gate=struct:" + g);
            return {
              kind: "deny",
              reason:
                `「操作约定｜结构门:${g}」本会话还没跑过该区域的结构检查。先执行：` +
                (gate ? gate.checker : "该区域的结构检查器") +
                "（它会列出结构与规范问题；跑一次即放行，发现问题先修），然后重试本次写操作。",
            };
          }
        }
        // 大任务预规划门（2026-11-04）：累计写入不同文件/目录到阈值后，没有六段 PLAN.md 就拒绝后续写
        if (planGate && planFile && FILE_EDIT_TOOLS.has(exec.name)) {
          const target = writeTarget(exec);
          if (!isPlanTarget(target) && !planSectionsOk()) {
            const files = sess ? (sess[PLAN_FILES] || new Set()) : globalPlanFiles;
            const dirs = sess ? (sess[PLAN_DIRS] || new Set()) : globalPlanDirs;
            if (files.size >= planGateAfterFiles || dirs.size >= planGateAfterDirs) {
              log(`guard deny-plan session=${sess ? (sess.id ?? "default") : "none"} files=${files.size} dirs=${dirs.size} tool=${exec.name}`);
          appendSignal("deny", sess ? (sess.id ?? "default") : "default", exec.name, "gate=plan");
              return {
                kind: "deny",
                reason:
                  `「操作约定｜大任务预规划」本会话已改 ${files.size} 个文件 / ${dirs.size} 个目录，超过阈值（${planGateAfterFiles} 文件 / ${planGateAfterDirs} 目录）。` +
                  `先写 ${planFile}（六段：目标/边界/步骤/风险/验收/回滚；模板 ops-skills\\PLAN-TEMPLATE.md），再继续；写 PLAN.md 本身不受拦。`,
              };
            }
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
            appendSignal("deny", sid, exec.name, "gate=todo");
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
      if (result?.isError) {
        appendSignal("fail", exec?.agent?.session?.id ?? "default", exec?.name, fmtSignalMsg(result?.error ?? result?.message ?? "isError"));
        return;
      }
      const sess = exec?.agent?.session;
      // 大任务预规划：累计成功写入的不同文件/目录（PLAN.md 本身不计）
      if (planGate && planFile && FILE_EDIT_TOOLS.has(exec?.name)) {
        const t = writeTarget(exec);
        if (t && !isPlanTarget(t)) {
          const files = sess ? (sess[PLAN_FILES] || (sess[PLAN_FILES] = new Set())) : globalPlanFiles;
          const dirs = sess ? (sess[PLAN_DIRS] || (sess[PLAN_DIRS] = new Set())) : globalPlanDirs;
          files.add(normPath(t));
          dirs.add(normPath(dirname(t)));
        }
      }
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

  // ---- 只读状态工具 ops_status（2026-11-01；需 config.statusTool: true） ----
  // 动态 import：宿主没提供 @deepseek-ai/dsh-tools 时只记日志，不影响门铃/守卫。
  if (statusTool) {
    const pluginPkg = fileURLToPath(new URL("./package.json", import.meta.url));
    import("@deepseek-ai/dsh-tools")
      .then(({ defineTool }) => {
        if (!ctx.tools || typeof ctx.tools.register !== "function") {
          log("status tool skipped: ctx.tools unavailable");
          return;
        }
        ctx.tools.register(
          defineTool({
            name: "ops_status",
            description:
              "Read-only status of the ops-conventions setup: bell VERSION, plugin package version, todo counts, maintenance-report issues, memory-library file count, and recent inject/guard log. Sections whose paths are not configured are omitted.",
            parameters: {
              detail: { type: "string", description: 'brief (default) or "full"' },
            },
            // defineTool 需要 output.schema + output.render（否则注册时读 render 报错）
            output: {
              schema: { type: "object", additionalProperties: true },
              render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
            },
            async execute(args) {
              return statusSummary({
                versionFile,
                packageFile: pluginPkg,
                todoFile: statusTodoJson,
                todoLastFile,
                maintReport,
                memoryDir,
                logFile,
                repoDir: typeof config.statusRepoDir === "string" ? config.statusRepoDir : "",
                markerFile: maintReport ? join(dirname(maintReport), "MAINT-OPEN.md") : "",
              });
            },
          }),
        );
        log(`status tool registered: ops_status repo=${config.statusRepoDir ? "yes" : "no"}`);
      })
      .catch((err) => log(`status tool skipped: ${err?.message ?? String(err)}`));
  }
}
