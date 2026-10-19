import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  DEFAULT_BLOCKED_TOOLS,
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
 *  - 只在"像要动手"的轮次注入（闲聊 0 成本）
 *  - 同一会话同一版本只注入一次；VERSION 变了自动再注入一次
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
        if (!shouldInject(text)) return decision;

        const version = readVersion(versionFile);
        const sid = agent?.session?.id ?? agent?.id ?? "default";
        if (sess && sess[GATE] === version) return decision;
        if (!sess && delivered.get(sid) === version) return decision;
        if (sess) sess[GATE] = version;
        delivered.set(sid, version);
        const text2 = reminderText(version, indexPath);
        log(`inject v${version} session=${sid} chars=${text2.length}`);

        const msg = createUserMessage({
          content: [{ type: "text", text: text2 }],
          source: {
            kind: "plugin:dsh-ops-conventions",
            plugin: "dsh-ops-conventions",
            form: "instructions",
          },
        });
        return { kind: "enter", messages: [...decision.messages, msg] };
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
