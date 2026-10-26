// 纯逻辑测试（通用版）：node test/rule.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_BLOCKED_TOOLS,
  bellIntegrity,
  buildStructGates,
  compactionHintText,
  compactionStats,
  denyReason,
  isBlockedTool,
  isCheckerCommandSafe,
  isIndexRead,
  isReadOnlyTool,
  isShellWrite,
  isTodoCheck,
  maintHintText,
  needsGuard,
  normalizeSessionId,
  readVersion,
  reminderText,
  shouldInject,
  skillsDirCandidates,
  structCheckIds,
  structGatesFor,
} from "../rule.mjs";

test("reminderText：通用版只给版本 + 清单路径，不夹带个人约定", () => {
  const t = reminderText("7", "D:/me/skills/INDEX.md");
  assert.ok(t.includes("v7"));
  assert.ok(t.includes("D:/me/skills/INDEX.md"));
  assert.ok(t.includes("只提醒一次"));
  for (const personal of ["待办校验器", "四件套", "_tasks", "不写「建议」", "旧快照"]) {
    assert.ok(!t.includes(personal), `generic bell must not contain: ${personal}`);
  }
});

test("reminderText：bellExtra 追加在末尾，空值不追加", () => {
  const withExtra = reminderText("7", "D:/x/INDEX.md", { extra: "  我的补充规则  " });
  assert.ok(withExtra.trimEnd().endsWith("我的补充规则"));
  const without = reminderText("7", "D:/x/INDEX.md", { extra: "   " });
  assert.ok(!without.includes("我的补充规则"));
  assert.equal(without.split("\n").length, 1);
});

test("readVersion：VERSION / VERSION.txt / version.json，读不到用 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-ver-"));
  try {
    writeFileSync(join(dir, "VERSION"), "12\n", "utf8");
    assert.equal(readVersion(join(dir, "VERSION")), "12");
    rmSync(join(dir, "VERSION"));
    writeFileSync(join(dir, "VERSION.txt"), "v13\n", "utf8");
    assert.equal(readVersion(join(dir, "VERSION")), "13");
    rmSync(join(dir, "VERSION.txt"));
    writeFileSync(join(dir, "version.json"), '{"version":"14"}', "utf8");
    assert.equal(readVersion(join(dir, "VERSION")), "14");
    rmSync(join(dir, "version.json"));
    assert.equal(readVersion(join(dir, "nope")), "1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shouldInject：动手词命中，闲聊不命中", () => {
  assert.equal(shouldInject("帮我改个脚本"), true);
  assert.equal(shouldInject("把配置改成 2000"), true);
  assert.equal(shouldInject("今天天气怎么样"), false);
  assert.equal(shouldInject(""), false);
});

test("路径解析：配置目录优先于包自带 skills", () => {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-skills-"));
  try {
    mkdirSync(join(dir, "custom"));
    writeFileSync(join(dir, "custom", "INDEX.md"), "# x\n", "utf8");
    const c = skillsDirCandidates({ skillsDir: join(dir, "custom") });
    assert.equal(c[0], join(dir, "custom"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("工具分类：默认只拦写类；read 类只读；blockedTools 生效", () => {
  assert.equal(isBlockedTool("write"), true);
  assert.equal(isBlockedTool("read"), false);
  assert.equal(isReadOnlyTool("read"), true);
  assert.equal(isReadOnlyTool("mcp__srv__list_items"), true);
  assert.equal(needsGuard("write", {}), true);
  assert.equal(needsGuard("read", {}), false);
  assert.equal(needsGuard("pwsh", { command: "Get-Date" }), false);
  assert.equal(needsGuard("pwsh", { command: "Get-Date" }, ["pwsh"]), true);
  assert.equal(needsGuard("cmd", { command: "dir" }, ["cmd"]), true);
  assert.deepEqual(DEFAULT_BLOCKED_TOOLS.includes("write"), true);
});

test("shell 写识别：常见写动词与 cmd 绕过被拦，只读放行", () => {
  assert.equal(isShellWrite("pwsh", { command: "Remove-Item x -Force" }), true);
  assert.equal(isShellWrite("pwsh", { command: "Set-Content a.txt b" }), true);
  assert.equal(isShellWrite("pwsh", { command: "git push origin main" }), true);
  assert.equal(isShellWrite("pwsh", { command: "echo hi > out.txt" }), true);
  assert.equal(isShellWrite("pwsh", { command: "Invoke-Expression $x" }), true);
  assert.equal(isShellWrite("pwsh", { command: "cmd /c copy a b" }), true);
  assert.equal(isShellWrite("pwsh", { command: "Get-Date" }), false);
  assert.equal(isShellWrite("read", { file_path: "x" }), false);
});

test("校验器白名单：单条放行；串联/管道/文件重定向拒绝", () => {
  const ps = "powershell -NoProfile -ExecutionPolicy Bypass -File D:\\x\\todo_check.ps1";
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps }), true);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " 2>&1" }), true);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " ; Remove-Item D:\\x -Force" }), false);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " | iex" }), false);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " > C:\\x.txt" }), false);
  assert.equal(isCheckerCommandSafe("read", { file_path: ps }), false);
});

test("结构门：默认空；配置后按路径命中，跑过检查器即记 id", () => {
  assert.deepEqual(structGatesFor({ file_path: "D:\\a\\b" }), []);
  assert.deepEqual(structCheckIds("pwsh", { command: "python x.py" }), []);
  const gates = buildStructGates({
    structGates: [
      { id: "docs", pathRe: "docs[/\\\\]", checkRe: "docs_check\\.py", checker: "python docs_check.py" },
    ],
  });
  assert.equal(gates.length, 1);
  assert.deepEqual(structGatesFor({ file_path: "D:/repo/docs/a.md" }, gates), ["docs"]);
  assert.deepEqual(structCheckIds("pwsh", { command: "python docs_check.py" }, gates), ["docs"]);
  assert.equal(isCheckerCommandSafe("pwsh", { command: "python docs_check.py" }, gates), true);
});

test("denyReason：通用版只提 INDEX；配置待办后才给校验器命令", () => {
  const plain = denyReason("D:/x/INDEX.md", "9");
  assert.ok(plain.includes("D:/x/INDEX.md"));
  assert.ok(plain.includes("v9"));
  assert.ok(!plain.includes("todo_check"));
  const withTodo = denyReason("D:/x/INDEX.md", "9", "D:/x/tasks/OPEN.md", "run checker");
  assert.ok(withTodo.includes("run checker"));
  const onlyTodo = denyReason("D:/x/INDEX.md", "9", "D:/x/tasks/OPEN.md", "run checker", { indexRead: true });
  assert.ok(!onlyTodo.includes("read 约定索引"));
  assert.ok(onlyTodo.includes("run checker"));
});

test("isIndexRead / isTodoCheck：read 工具与 shell 读都算", () => {
  assert.equal(isIndexRead("read", { file_path: "D:/x/INDEX.md" }, "D:/x/INDEX.md"), true);
  assert.equal(isIndexRead("read", { file_path: "D:/x/other.md" }, "D:/x/INDEX.md"), false);
  assert.equal(isTodoCheck("pwsh", { command: "powershell -File D:\\x\\todo_check.ps1" }), true);
  assert.equal(isTodoCheck("bash", { command: "sh todo.cmd" }), true);
  assert.equal(isTodoCheck("read", { file_path: "D:/x/todo_check.ps1" }), false);
});

test("maintHintText：无 Issues 返回空；有 Issues 带条数与路径", () => {
  assert.equal(maintHintText("# x\n\n## Issues\n- none\n"), "");
  assert.equal(maintHintText("# x\n"), "");
  const h = maintHintText("# x\n\n## Issues\n- a broken\n- b broken\n\n## Actions taken\n", "D:/m.md");
  assert.ok(h.includes("2 项待处理"));
  assert.ok(h.includes("D:/m.md"));
});

test("压缩统计与提示：从 contextTimeline 数 compaction", () => {
  const proj = {
    record: {
      rows: {
        contextTimeline: { val: { events: [{ kind: "compaction" }, { kind: "x" }, { kind: "compaction" }] } },
        contextPressure: { val: { pressureTokens: 5000, contextWindow: 100000 } },
      },
    },
  };
  const s = compactionStats(proj);
  assert.equal(s.count, 2);
  assert.equal(s.percent, 5);
  assert.ok(String(compactionHintText(s)).includes("2 次"));
  assert.equal(compactionHintText({ count: 0 }), null);
});

test("bellIntegrity：无绑定文件时放行；sha 不一致时 ok=false", () => {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-bell-"));
  try {
    const rule = join(dir, "rule.mjs");
    writeFileSync(rule, "x", "utf8");
    assert.equal(bellIntegrity(rule, join(dir, "nope.json")).ok, true);
    writeFileSync(join(dir, "state.json"), JSON.stringify({ sha256: "DEADBEEF" }), "utf8");
    const r = bellIntegrity(rule, join(dir, "state.json"));
    assert.equal(r.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeSessionId：去掉 session- / session_ 前缀", () => {
  assert.equal(normalizeSessionId("session-abc"), "abc");
  assert.equal(normalizeSessionId("session_abc"), "abc");
  assert.equal(normalizeSessionId("abc"), "abc");
  assert.equal(normalizeSessionId(""), "");
});
