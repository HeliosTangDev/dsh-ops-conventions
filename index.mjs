import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  lastUserText,
  readVersion,
  reminderText,
  resolveLogFile,
  resolveSkillsDir,
  shouldInject,
} from "./rule.mjs";

export const name = "dsh-ops-conventions";
export const inject = ["agents"];

/**
 * 让"操作约定"在动手前确定性出现（不依赖记忆召回的运气）：
 *  - 只在"像要动手"的轮次注入（闲聊 0 成本）
 *  - 同一会话同一版本只注入一次；VERSION 变了自动再注入一次
 * 配置（可选）：
 *  - skillsDir: 约定技能目录（默认 $DSH_OPS_CONVENTIONS_DIR 或 ~/.dsh/ops-conventions/skills）
 *  - logFile:   注入日志（默认 $DSH_OPS_CONVENTIONS_LOG 或 ~/.dsh/ops-conventions/ops-conventions.log）
 */
export function apply(ctx, config = {}) {
  const skillsDir = resolveSkillsDir(config);
  const logFile = resolveLogFile(config);
  const indexPath = join(skillsDir, "INDEX.md");
  const versionFile = join(skillsDir, "VERSION");
  const delivered = new Map(); // sessionId -> version（兜底）

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
  log("plugin loaded");

  const GATE = Symbol.for("dsh.opsConventions.injectedVersion");

  ctx.on(
    "agent/pre-step",
    async ({ agent, messages, signal }, next) => {
      const decision = await next();
      try {
        if (!decision || decision.kind !== "enter") return decision;
        if (signal?.aborted) return decision;
        const text = lastUserText(decision.messages ?? messages);
        if (!shouldInject(text)) return decision;

        const version = readVersion(versionFile);
        const sid = agent?.session?.id ?? agent?.id ?? "default";
        const sess = agent?.session;
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
}
