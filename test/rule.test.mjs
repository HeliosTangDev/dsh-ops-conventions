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
  signalSummary,
  signalHintText,
  needsGuard,
  normalizeSessionId,
  readVersion,
  readJsonFile,
  liveStatusText,
  reminderText,
  shouldInject,
  skillsDirCandidates,
  structCheckIds,
  structGatesFor,
  statusSummary,
  checkReply,
  correctiveSignal,
  habitCandidate,
  compactionWarnText,
  staleClaimVersions,
  isWriteOrExecTool,
  checkReplyTime,
  pickAssistantText,
  isSummaryLike,
  betterAssistantText,
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

test("校验器白名单：单条放行；显示类管道放行；串联/危险管道/文件重定向拒绝", () => {
  const ps = "powershell -NoProfile -ExecutionPolicy Bypass -File D:\\x\\todo_check.ps1";
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps }), true);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " 2>&1 | Select-Object -Last 3" }), true);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " | Out-String" }), true);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " | iex" }), false);
  assert.equal(isCheckerCommandSafe("pwsh", { command: ps + " | Remove-Item D:\\x -Force" }), false);
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

  // 可选 tools 限定：只对 shell 生效的 gate 不应命中 edit/write
  const shellOnly = buildStructGates({
    structGates: [
      { id: "env", pathRe: "reg\\s+add", checkRe: "env-before\\.ps1", checker: "powershell -File env-before.ps1", tools: ["pwsh", "cmd"] },
    ],
  });
  assert.deepEqual(structGatesFor({ command: "reg add HKCU\\X" }, shellOnly, "pwsh"), ["env"]);
  assert.deepEqual(structGatesFor({ old_string: "reg add HKCU\\X" }, shellOnly, "edit"), []);
  assert.deepEqual(structGatesFor({ old_string: "reg add HKCU\\X" }, shellOnly), ["env"]);
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

test("statusSummary：按配置汇总，未配置段不出现，任何缺失不抛错", () => {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-status-"));
  try {
    writeFileSync(join(dir, "VERSION"), "7\n", "utf8");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", version: "1.2.3" }), "utf8");
    writeFileSync(
      join(dir, "todo.json"),
      JSON.stringify({ items: [{ id: "a", type: "ask" }, { id: "b", type: "open" }] }),
      "utf8",
    );
    writeFileSync(join(dir, "MAINT.md"), "# m\n\n## Issues\n- x\n- y\n", "utf8");
    mkdirSync(join(dir, "mem", "sub"), { recursive: true });
    writeFileSync(join(dir, "mem", "a.md"), "# a\n", "utf8");
    writeFileSync(join(dir, "mem", "sub", "b.md"), "# b\n", "utf8");
    writeFileSync(join(dir, "mem", "c.txt"), "x", "utf8");
    writeFileSync(
      join(dir, "log.txt"),
      "2026-11-01T00:00:00Z  inject v7 session=x chars=100\n2026-11-01T00:01:00Z  guard deny tool=pwsh\n",
      "utf8",
    );

    const s = statusSummary({
      versionFile: join(dir, "VERSION"),
      packageFile: join(dir, "package.json"),
      todoFile: join(dir, "todo.json"),
      maintReport: join(dir, "MAINT.md"),
      memoryDir: join(dir, "mem"),
      logFile: join(dir, "log.txt"),
    });
    assert.equal(s.bell.version, "7");
    assert.equal(s.plugin.version, "1.2.3");
    assert.equal(s.todo.items, 2);
    assert.deepEqual(s.todo.declared, { ask: 1, machine: 1 });
    assert.equal(s.maint.issues, 2);
    assert.equal(s.memory.count, 2);
    assert.equal(s.log.lastInject.version, "7");
    assert.equal(s.log.denyCount, 1);

    const bare = statusSummary({});
    assert.equal(bare.bell, undefined);
    assert.equal(bare.todo, undefined);
    assert.equal(bare.memory, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkReply：命中返回 id/message；无命中与非法正则不抛错", () => {
  const rules = [
    { id: "no-next-time", pattern: "下次注意", message: "不许用下次注意结案" },
    { id: "bad-regex", pattern: "(", message: "invalid" },
    { id: "no-todo", pattern: "^(?![\\s\\S]*##\\s*待办)[\\s\\S]*##\\s*自检", message: "有自检段但无待办段" },
  ];
  assert.equal(checkReply("", rules).length, 0);
  assert.equal(checkReply("正常回复，没有禁词", rules).length, 0);
  const hit = checkReply("这次先这样，下次注意", rules);
  assert.deepEqual(hit.map((h) => h.id), ["no-next-time"]);
  assert.ok(hit[0].message.includes("下次注意"));
  const sections = checkReply("## 自检\n- 无", rules);
  assert.ok(sections.some((h) => h.id === "no-todo"));
  const both = checkReply("## 待办\n- 无\n\n## 自检\n- 无", rules);
  assert.equal(both.length, 0);

  // require：触发词命中但缺少必需内容时才算违规
  const req = [{ id: "status-needs-time", pattern: "bell=v\\d+", require: "@\\d{1,2}:\\d{2}", message: "带时间" }];
  assert.equal(checkReply("bell=v17 无时间", req).length, 1);
  assert.equal(checkReply("bell=v17 @03:50", req).length, 0);
  assert.equal(checkReply("没有状态句", req).length, 0);

  // 时间新鲜度：只看最后一个 @HH:mm，超过阈值/在未来才算违规
  const now = new Date(2026, 10, 8, 4, 0, 0);
  const opts = { now, trigger: "bell=v\\d+", maxAgeMinutes: 10, maxFutureMinutes: 5 };
  assert.equal(checkReplyTime("状态 bell=v90 @03:55", opts).length, 0);
  assert.equal(checkReplyTime("状态 bell=v90 @03:40", opts)[0].id, "status-time-stale");
  assert.equal(checkReplyTime("状态 bell=v90 @04:20", opts)[0].id, "status-time-stale");
  assert.equal(checkReplyTime("状态 bell=v90", opts).length, 0);
  assert.equal(checkReplyTime("普通回复 @03:40", opts).length, 0);

  // 只取正文：reasoning/tool-* 的 text 不能混进“上一条回复”
  assert.equal(
    pickAssistantText({ content: [{ type: "reasoning", text: "think" }, { type: "text", text: "答" }, { type: "tool-call", text: "call" }] }),
    "答",
  );
  assert.equal(pickAssistantText({ content: "plain" }), "plain");
  assert.equal(pickAssistantText({ message: { content: [{ type: "text", text: "m" }] } }), "m");
  assert.equal(pickAssistantText({ content: [{ type: "reasoning", text: "only-think" }] }), "");
});

test("捕获选择：摘要不占位、正文取最长、正文引用摘要词不算摘要", () => {
  // 摘要类（整段开头就是 User/Summary）必须跳过
  assert.equal(isSummaryLike('User sent "1" and adds a maxim'), true);
  assert.equal(isSummaryLike("Summary: earlier we did X"), true);
  // 正文里引用过这些词不算摘要
  assert.equal(isSummaryLike("看到问题根源了：日志里写 User pushes back"), false);
  assert.equal(isSummaryLike(""), false);

  // 摘要不能覆盖已有正文
  assert.equal(betterAssistantText("最终回复", "User pushes back: x"), "最终回复");
  // 更长的正文胜出
  assert.equal(betterAssistantText("短", "更长的最终回复"), "更长的最终回复");
  // 更短的不覆盖
  assert.equal(betterAssistantText("更长的最终回复", "短"), "更长的最终回复");
  // 空候选不改变
  assert.equal(betterAssistantText("已有", ""), "已有");
});
test("maintHintText: only the first 4 items are listed, the rest are counted", () => {
  const items = ["a", "b", "c", "d", "e", "f"].map((x) => "- item " + x + " broken").join("\n");
  const h = maintHintText("# m\n\n## Issues\n" + items + "\n\n## Actions taken\n", "D:/m.md");
  assert.ok(h.includes("6 项待处理"));
  assert.ok(h.includes("等 6 项"));
  assert.ok(!h.includes("item f"));
});

test("signalSummary: window + sid exclusion + kind counting", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const text = [
    `${iso(1000)}  kind=fail  sid=A  tool=bash  msg=boom`,
    `${iso(2000)}  kind=deny  sid=A  tool=write  msg=guard`,
    `${iso(49 * 3600 * 1000)}  kind=fail  sid=B  tool=edit  msg=old`,   // outside 24h window
    `${iso(3000)}  kind=ok    sid=C  tool=read  msg=fine`,              // unknown kind
  ].join("\n");
  const s = signalSummary(text, "A", { nowMs: now });
  assert.equal(s.failures, 0, "own sid excluded");
  assert.equal(s.denied, 0);
  assert.equal(s.sessions, 0);
  const s2 = signalSummary(text, "Z", { nowMs: now });
  assert.equal(s2.failures, 1, "old line outside window");
  assert.equal(s2.denied, 1);
  assert.equal(s2.sessions, 1);
});

test("signalHintText: below threshold is silent, at threshold counts both kinds", () => {
  assert.equal(signalHintText({ failures: 1, denied: 0 }), "");
  assert.equal(signalHintText({ failures: 0, denied: 0 }), "");
  const h = signalHintText({ failures: 2, denied: 1, samples: ["bash"] });
  assert.ok(h.includes("2 次工具失败"));
  assert.ok(h.includes("1 次守卫拒绝"));
  assert.ok(h.includes("按本机约定处理"));
});

test("statusSummary: repo refs decide pushed/not-pushed, marker is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-status-"));
  const git = join(dir, ".git");
  mkdirSync(join(git, "refs", "heads"), { recursive: true });
  mkdirSync(join(git, "refs", "remotes", "origin"), { recursive: true });
  const sha = "0123456789abcdef0123456789abcdef01234567";
  writeFileSync(join(git, "refs", "heads", "main"), sha + "\n", "utf8");
  writeFileSync(join(git, "refs", "remotes", "origin", "main"), sha + "\n", "utf8");
  const s1 = statusSummary({ repoDir: dir, markerFile: join(dir, "MAINT-OPEN.md") });
  assert.equal(s1.repo.pushed, true);
  assert.equal(s1.repo.unpushedKnown, true);
  assert.equal(s1.maintMarker, false);
  writeFileSync(join(git, "refs", "remotes", "origin", "main"), "fedcba9876543210fedcba9876543210fedcba98\n", "utf8");
  const s2 = statusSummary({ repoDir: dir });
  assert.equal(s2.repo.pushed, false, "different remote sha means not pushed");
  rmSync(dir, { recursive: true, force: true });
});

// ---- correctiveSignal：纠正/追问信号（2026-11-11，思考习惯捕获的触发判据） ----
test("correctiveSignal flags a corrective follow-up", () => {
  assert.ok(correctiveSignal("可是又回到那个问题，我不提这个你有做保证触发的机制吗"));
});

test("correctiveSignal ignores short neutral answers", () => {
  assert.equal(correctiveSignal("好的"), "");
  assert.equal(correctiveSignal("继续"), "");
  assert.equal(correctiveSignal(""), "");
});

test("correctiveSignal returns the matched marker", () => {
  const hit = correctiveSignal("为什么这次又没写现场时间？");
  assert.ok(hit.length > 0, "should return a non-empty marker");
});
// ---- habitCandidate：用户消息→习惯收件箱的触发判据（2026-11-11） ----
test("habitCandidate captures a user corrective message", () => {
  const hit = habitCandidate("user", "user/message", "为什么这次又没写现场时间？");
  assert.ok(hit && hit.length > 0);
});

test("habitCandidate ignores assistant messages", () => {
  assert.equal(habitCandidate("assistant", "user/message", "为什么这次又没写现场时间？"), "");
});

test("habitCandidate ignores short/neutral user text", () => {
  assert.equal(habitCandidate("user", "user/message", "好"), "");
  assert.equal(habitCandidate("user", "user/message", ""), "");
});
// ---- compactionStats：真实投影用 totals.compactions 记次数（2026-11-11 修） ----
test("compactionStats counts totals.compactions when timeline events are empty", () => {
  const proj = { record: { rows: { contextTimeline: { val: { totals: { compactions: 3 }, events: [], contextWindow: 1048576 } }, contextPressure: { val: { pressureTokens: 328170 } } } } };
  const s = compactionStats(proj);
  assert.equal(s.count, 3);
  assert.equal(s.percent, 31);
});

test("compactionStats falls back to event count when totals missing", () => {
  const proj = { record: { rows: { contextTimeline: { val: { events: [{ kind: "compaction" }, { kind: "compaction" }] } } } } };
  assert.equal(compactionStats(proj).count, 2);
});
// ---- compactionWarnText：上下文阈值预警（2026-11-11 A 案） ----
test("compactionWarnText fires at or above threshold", () => {
  const txt = compactionWarnText({ percent: 61 }, 60);
  assert.ok(txt.includes("61%"));
  assert.ok(txt.includes("60%"));
});

test("compactionWarnText stays silent below threshold / unknown percent", () => {
  assert.equal(compactionWarnText({ percent: 32 }, 60), "");
  assert.equal(compactionWarnText({ percent: null }, 60), "");
  assert.equal(compactionWarnText({ percent: 90 }, 0), "");
});
// ---- 小改动批 2026-11-11：版本误报过滤 + 拒绝原因标具体门 ----
test("staleClaimVersions ignores plugin versions and requirement ranges", () => {
  const live = { host: "0.2.2-rc.1", bellVersion: 92, installed: new Set() };
  const text = "当前配置：插件 dsh-live-compact 1.0.2 要求 DSH >=0.2.0-rc.2 <0.3.0";
  assert.deepEqual(staleClaimVersions(text, live), []);
});

test("staleClaimVersions still flags a mismatched host version", () => {
  const live = { host: "0.2.2-rc.1", bellVersion: 92, installed: new Set() };
  assert.ok(staleClaimVersions("当前 host 0.2.1-rc.3", live).includes("0.2.1-rc.3"));
});

test("denyReason marks the specific gate", () => {
  const r1 = denyReason("D:\\x\\INDEX.md", 92, "D:\\todo.json", "todo_check.ps1", { indexRead: false, todoChecked: true });
  assert.ok(r1.includes("gate=index"), r1);
  const r2 = denyReason("D:\\x\\INDEX.md", 92, "D:\\todo.json", "todo_check.ps1", { indexRead: true, todoChecked: false });
  assert.ok(r2.includes("gate=todo"), r2);
});
// ---- isWriteOrExecTool：刷新判定（写/执行记脏，只读不算） ----
test("isWriteOrExecTool: write tools and memories count", () => {
  for (const n of ["write", "edit", "multi_edit", "apply_patch", "notebook_edit", "mcp__openviking__write", "mcp__openviking__edit"]) {
    assert.equal(isWriteOrExecTool(n), true, n);
  }
});
test("isWriteOrExecTool: exec tools count", () => {
  for (const n of ["pwsh", "bash", "cmd", "run_command", "exec"]) assert.equal(isWriteOrExecTool(n), true, n);
});
test("isWriteOrExecTool: read-only tools do not count", () => {
  for (const n of ["read", "grep", "glob", "web_search", "web_fetch", "mcp__openviking__find", "mcp__openviking__read", "todo_check", "job_output"]) {
    assert.equal(isWriteOrExecTool(n), false, n);
  }
});

// ---- readJsonFile：容忍 UTF-8 BOM（2026-11-13 todo.json 被写 BOM 导致 parse-error） ----
test("readJsonFile: strips UTF-8 BOM", () => {
  const dir = mkdtempSync(join(tmpdir(), "bom-"));
  const f = join(dir, "x.json");
  writeFileSync(f, "\uFEFF{\"items\":[{\"type\":\"ask\"}]}", "utf8");
  assert.deepEqual(readJsonFile(f), { items: [{ type: "ask" }] });
  rmSync(dir, { recursive: true, force: true });
});
test("statusSummary/liveStatusText: BOM'd todo.json 不再变成 parse-error", () => {
  const dir = mkdtempSync(join(tmpdir(), "bom-"));
  const f = join(dir, "todo.json");
  writeFileSync(f, "\uFEFF{\"updated\":\"2026-11-13\",\"items\":[{\"id\":\"a\",\"text\":\"t\",\"type\":\"ask\"}]}", "utf8");
  const s = statusSummary({ todoFile: f });
  assert.equal(s.todo && s.todo.items, 1);
  const live = liveStatusText({ todoFile: f });
  assert.ok(live.includes("todo items=1"), live);
  assert.ok(!live.includes("parse-error"), live);
  rmSync(dir, { recursive: true, force: true });
});