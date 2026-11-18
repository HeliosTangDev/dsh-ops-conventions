// 窄工具（窄白名单宿主执行）逻辑框架测试。
// 设计约束（2026-11-17 结论）：只暴露「脚本 id + 受限参数」；路径来自白名单，
// 不接受任意 path/args/cwd；spawn 不用 shell；超时与输出上限强约束。
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseNarrowConfig,
  planNarrowRun,
  runNarrow,
  callerAllowed,
} from "../narrow.mjs";

const ROOT = "D:\\software\\ToolsUse";
const OK_PATH = "D:\\software\\ToolsUse\\_tools\\todo\\todo_check.ps1";

test("parseNarrowConfig：合法条目入表，非法条目报错并被丢弃", () => {
  const { scripts, errors } = parseNarrowConfig(
    {
      rootDir: ROOT,
      scripts: [
        { id: "todo", path: OK_PATH, allowedArgs: ["-Json"] },
        { id: "", path: OK_PATH },
        { id: "rel", path: "todo_check.ps1" },
        { id: "escape", path: "D:\\software\\ToolsUse\\..\\Windows\\System32\\cmd.exe" },
        { id: "outside", path: "D:\\other\\outside.ps1" },
        { id: "todo", path: OK_PATH },
        { id: "missingpath" },
      ],
    },
    { rootDir: ROOT },
  );
  assert.deepEqual([...scripts.keys()], ["todo"]);
  assert.equal(errors.length >= 6, true);
  assert.equal(
    errors.some((e) => /根目录|root/i.test(e)),
    true,
  );
});

test("parseNarrowConfig：路径必须落在 rootDir 之内（含大小写与斜杠差异）", () => {
  const { scripts, errors } = parseNarrowConfig(
    {
      rootDir: ROOT,
      scripts: [
        { id: "slash", path: "d:/software/ToolsUse/_tools/a.ps1" },
        { id: "outside", path: "D:\\software\\ToolsDev\\a.ps1" },
      ],
    },
    { rootDir: ROOT },
  );
  assert.deepEqual([...scripts.keys()], ["slash"]);
  assert.equal(errors.length, 1);
});

test("planNarrowRun：未知 id / 未授权参数 / 超长参数一律拒绝", () => {
  const { scripts } = parseNarrowConfig(
    {
      rootDir: ROOT,
      scripts: [{ id: "todo", path: OK_PATH, allowedArgs: ["-Json"] }],
    },
    { rootDir: ROOT },
  );

  assert.equal(planNarrowRun(scripts, "nope").ok, false);
  assert.equal(planNarrowRun(scripts, "todo", ["-Force"]).ok, false);
  assert.equal(planNarrowRun(scripts, "todo", ["-Json", "-Json"]).ok, true);
  assert.equal(planNarrowRun(scripts, "todo", ["x".repeat(500)]).ok, false);
  assert.equal(planNarrowRun(scripts, "todo", [123]).ok, false);

  const plan = planNarrowRun(scripts, "todo", ["-Json"]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.argv, [OK_PATH, "-Json"]);
  assert.equal(plan.cwd, ROOT);
});

test("planNarrowRun：没有 allowedArgs 的脚本不允许任何参数", () => {
  const { scripts } = parseNarrowConfig(
    { rootDir: ROOT, scripts: [{ id: "bare", path: OK_PATH }] },
    { rootDir: ROOT },
  );
  assert.equal(planNarrowRun(scripts, "bare").ok, true);
  assert.equal(planNarrowRun(scripts, "bare", ["-Json"]).ok, false);
});

test("runNarrow：不用 shell、cwd 固定、按条目超时与输出上限执行", async () => {
  const calls = [];
  const fakeSpawn = (file, argv, opts) => {
    calls.push({ file, argv, opts });
    return { ok: true, code: 0, stdout: "hello", stderr: "", timedOut: false };
  };
  const res = await runNarrow(
    {
      id: "todo",
      path: OK_PATH,
      cwd: ROOT,
      timeoutMs: 1500,
      maxOutputBytes: 4096,
      launcher: [],
    },
    ["-Json"],
    { spawn: fakeSpawn, audit: () => {} },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.shell, false);
  assert.equal(calls[0].opts.timeoutMs, 1500);
  assert.equal(calls[0].opts.cwd, ROOT);
  assert.deepEqual(calls[0].argv, [OK_PATH, "-Json"]);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, "hello");
});

test("runNarrow：launcher 前置固定解释器，输出按 maxOutputBytes 截断并标记", async () => {
  const calls = [];
  const fakeSpawn = (file, argv, opts) => {
    calls.push({ file, argv, opts });
    return { ok: true, code: 0, stdout: "x".repeat(100), stderr: "", timedOut: false };
  };
  const res = await runNarrow(
    {
      id: "todo",
      path: OK_PATH,
      cwd: ROOT,
      timeoutMs: 1000,
      maxOutputBytes: 10,
      launcher: ["powershell", "-NoProfile", "-File"],
    },
    [],
    { spawn: fakeSpawn, audit: () => {} },
  );

  assert.equal(calls[0].file, "powershell");
  assert.deepEqual(calls[0].argv, ["-NoProfile", "-File", OK_PATH]);
  assert.equal(res.stdout.length, 10);
  assert.equal(res.truncated, true);
});

test("runNarrow：超时与非零退出如实上报，并写审计行", async () => {
  const audit = [];
  const timeoutSpawn = () => ({
    ok: false,
    code: 124,
    stdout: "",
    stderr: "",
    timedOut: true,
    error: "timeout",
  });
  const res = await runNarrow(
    { id: "slow", path: OK_PATH, cwd: ROOT, timeoutMs: 5, maxOutputBytes: 100, launcher: [] },
    [],
    { spawn: timeoutSpawn, audit: (l) => audit.push(l) },
  );
  assert.equal(res.timedOut, true);
  assert.equal(res.code, 124);
  assert.equal(audit.length, 1);
  assert.match(audit[0], /slow/);
});

test("runNarrow：spawn 抛错时不把异常抛给工具层", async () => {
  const res = await runNarrow(
    { id: "boom", path: OK_PATH, cwd: ROOT, timeoutMs: 5, maxOutputBytes: 100, launcher: [] },
    [],
    { spawn: () => { throw new Error("spawn ENOENT"); }, audit: () => {} },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /ENOENT/);
});

test("授权维度：workspaces 必填（默认拒绝），* 表示全局", () => {
  const { scripts } = parseNarrowConfig(
    {
      rootDir: ROOT,
      scripts: [
        { id: "scoped", path: OK_PATH, workspaces: [ROOT] },
        { id: "global", path: OK_PATH, workspaces: ["*"] },
        { id: "unscoped", path: OK_PATH },
      ],
    },
    { rootDir: ROOT },
  );
  const scoped = scripts.get("scoped");
  const global = scripts.get("global");
  const unscoped = scripts.get("unscoped");

  assert.equal(callerAllowed(scoped, { workspace: ROOT }).ok, true);
  assert.equal(callerAllowed(scoped, { workspace: "D:\\software\\ToolsDev" }).ok, false);
  assert.equal(callerAllowed(scoped, { workspace: ROOT + "\\_tools" }).ok, true);
  assert.equal(callerAllowed(scoped, { workspace: "d:/SOFTWARE/toolsuse/" }).ok, true);
  assert.equal(callerAllowed(scoped, {}).ok, false);

  assert.equal(callerAllowed(global, { workspace: "Z:\\whatever" }).ok, true);
  assert.equal(callerAllowed(global, {}).ok, true); // 全局条目不依赖工作区
  assert.equal(callerAllowed(unscoped, { workspace: ROOT }).ok, false);
  assert.match(callerAllowed(unscoped, { workspace: ROOT }).reason, /workspaces/);
});

test("授权维度：sessions 作为额外收窄，不写则不限制会话", () => {
  const { scripts } = parseNarrowConfig(
    {
      rootDir: ROOT,
      scripts: [
        { id: "s1", path: OK_PATH, workspaces: ["*"], sessions: ["session-abc"] },
        { id: "s2", path: OK_PATH, workspaces: ["*"] },
      ],
    },
    { rootDir: ROOT },
  );
  assert.equal(callerAllowed(scripts.get("s1"), { workspace: ROOT, sid: "session-abc" }).ok, true);
  assert.equal(callerAllowed(scripts.get("s1"), { workspace: ROOT, sid: "session-xyz" }).ok, false);
  assert.equal(callerAllowed(scripts.get("s2"), { workspace: ROOT, sid: "session-xyz" }).ok, true);
});

test("授权维度：非法 workspaces/sessions 条目被丢弃并报错", () => {
  const { scripts, errors } = parseNarrowConfig(
    {
      rootDir: ROOT,
      scripts: [
        { id: "bad1", path: OK_PATH, workspaces: "D:\\x" },
        { id: "bad2", path: OK_PATH, workspaces: ["relative\\path"] },
        { id: "ok", path: OK_PATH, workspaces: [ROOT] },
      ],
    },
    { rootDir: ROOT },
  );
  assert.equal(scripts.has("bad1"), false);
  assert.equal(scripts.has("bad2"), false);
  assert.equal(scripts.has("ok"), true);
  assert.equal(errors.length >= 2, true);
});
