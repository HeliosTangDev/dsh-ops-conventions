// 端到端：加载真实插件模块，用真实投影文件 + 真实 pre-step 钩子验证「会话压缩提示」
// 宿主提供的 @deepseek-ai/dsh-llm 由 test/e2e-hooks.mjs 重定向到桩。
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function projection(compactions, pressure) {
  return {
    record: {
      rows: {
        contextTimeline: {
          val: {
            contextWindow: 1000000,
            events: [
              { seq: 1, kind: "inject" },
              ...Array.from({ length: compactions }, (_, i) => ({
                seq: 100 + i,
                kind: "compaction",
                tokens: 500000,
                count: 1000,
              })),
            ],
          },
        },
        contextPressure: { val: { pressureTokens: pressure, contextWindow: 1000000 } },
      },
    },
  };
}

test("压缩提示端到端：基线不提示、增加提示一次、不变不重复", async () => {
  register("./e2e-hooks.mjs", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "opsconv-e2e-"));
  try {
    const cacheDir = join(root, "sessions");
    const skillsDir = join(root, "skills");
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "VERSION"), "42", "utf8");
    const sid = "e2e";
    const file = join(cacheDir, `session-${sid}.json`);
    const put = (c, p) => writeFileSync(file, JSON.stringify(projection(c, p)), "utf8");
    put(1, 500000);

    const { apply } = await import("../index.mjs");
    const handlers = {};
    const ctx = {
      on: (ev, fn) => {
        handlers[ev] = fn;
      },
      logger: { info: () => {} },
    };
    apply(ctx, {
      skillsDir,
      sessionCacheDir: cacheDir,
      logFile: join(root, "plugin.log"),
      enforce: false,
    });

    const pre = handlers["agent/pre-step"];
    assert.equal(typeof pre, "function", "pre-step handler 已注册");

    const sess = { id: sid };
    const call = async () => {
      const decision = await pre({ agent: { session: sess }, messages: [] }, async () => ({
        kind: "enter",
        messages: [],
      }));
      return (decision?.messages ?? [])
        .map((m) =>
          typeof m.content === "string"
            ? m.content
            : (m.content ?? []).map((p) => p?.text ?? "").join(""),
        )
        .join("\n");
    };

    const t1 = await call();
    assert.ok(!t1.includes("会话压缩提示"), "首次看到只记基线，不提示");

    put(2, 600000);
    const t2 = await call();
    assert.ok(t2.includes("会话压缩提示"), "新增一次压缩要提示");
    assert.match(t2, /压缩 2 次/, "提示里带次数");

    const t3 = await call();
    assert.ok(!t3.includes("会话压缩提示"), "次数不变不重复提示");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
