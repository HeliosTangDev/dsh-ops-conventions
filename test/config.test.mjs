// B 方案：配置外置（路径类放 JSON、YAML 只留开关）的合并逻辑测试。
// 关键约定：YAML 显式键优先于 JSON；读不到/解析失败时完全按 YAML 跑（fail-open，不改变现行为）。
import test from "node:test";
import assert from "node:assert/strict";

import { mergeExternalConfig, readExternalConfig, resolveFeatures, FEATURE_GROUPS } from "../config.mjs";

test("没有 configFile：不读文件，返回空结果（行为不变）", () => {
  const r = readExternalConfig({ skillsDir: "D:\\a" }, () => {
    throw new Error("should not read");
  });
  assert.equal(r.file, "");
  assert.equal(r.config, null);
  assert.deepEqual(r.overrides, []);
  assert.equal(r.error, "");
});

test("JSON 提供 YAML 没有的键：合并进来", () => {
  const r = readExternalConfig(
    { configFile: "D:\\cfg.json", enabled: true },
    () => ({ skillsDir: "D:\\s", todoFile: "D:\\t", replyChecks: [{ id: "x" }] }),
  );
  assert.equal(r.error, "");
  assert.equal(r.config.skillsDir, "D:\\s");
  assert.equal(r.config.todoFile, "D:\\t");
  assert.deepEqual(r.config.replyChecks, [{ id: "x" }]);
  assert.equal(r.config.enabled, true);
});

test("两边都有的键：YAML 优先，并记进 overrides", () => {
  const r = readExternalConfig(
    { configFile: "D:\\cfg.json", skillsDir: "D:\\yaml-wins", enabled: false },
    () => ({ skillsDir: "D:\\json-loses", enabled: true }),
  );
  assert.equal(r.config.skillsDir, "D:\\yaml-wins");
  assert.equal(r.config.enabled, false);
  assert.deepEqual(r.overrides.sort(), ["enabled", "skillsDir"]);
});

test("数组整体替换（不做元素级合并）", () => {
  const r = readExternalConfig(
    { configFile: "D:\\cfg.json", blockedTools: ["write"] },
    () => ({ blockedTools: ["write", "edit", "pwsh"] }),
  );
  assert.deepEqual(r.config.blockedTools, ["write"]);
});

test("读文件抛错（不存在/坏 JSON）：记 error，不抛异常，config 为 null", () => {
  const r = readExternalConfig({ configFile: "D:\\missing.json" }, () => {
    throw new Error("ENOENT: no such file");
  });
  assert.match(r.error, /ENOENT/);
  assert.equal(r.config, null);
  assert.deepEqual(r.overrides, []);
});

test("文件内容不是对象（数组/字符串/数字）：报 error，不当配置用", () => {
  for (const bad of [[], "text", 42, null]) {
    const r = readExternalConfig({ configFile: "D:\\cfg.json" }, () => bad);
    assert.equal(r.config, null);
    assert.match(r.error, /object/);
  }
});

test("mergeExternalConfig：没有文件配置时返回 null（不凭空造配置）", () => {
  assert.deepEqual(mergeExternalConfig({ a: 1 }, null), { config: null, overrides: [] });
  assert.deepEqual(mergeExternalConfig({ a: 1 }, undefined), { config: null, overrides: [] });
});

test("configFile 自身保留在合并结果里（供插件日志与状态行使用）", () => {
  const r = readExternalConfig({ configFile: "D:\\cfg.json" }, () => ({ skillsDir: "D:\\s" }));
  assert.equal(r.config.configFile, "D:\\cfg.json");
});

// 2026-11-21（开关表 A）：features 只能"关"，不能凭空打开没配置的功能
test("features 表：默认继承旧布尔键，features 里的 false 可关掉", () => {
  const base = {
    status: true,
    versionWarning: true,
    statusTool: true,
    narrowTool: true,
    writeTool: true,
    planGate: true,
    structGates: [{ id: "tools" }],
    replyChecks: [{ id: "x" }],
    todoFile: "D:\\t.md",
    maintReport: "D:\\m.md",
    signalsFile: "D:\\s.log",
  };
  const f = resolveFeatures(base);
  assert.equal(f.planGate, true);
  assert.equal(f.opsRun, true);
  assert.equal(f.opsWrite, true);
  assert.equal(f.structGate, true);
  assert.equal(f.replyCheck, true);
  assert.equal(f.todoGate, true);
  assert.equal(f.bell, true);
  assert.equal(f.indexGate, true);

  const off = resolveFeatures({ ...base, features: { planGate: false, opsRun: false, opsWrite: false, structGate: false, replyCheck: false, todoGate: false, bell: false, indexGate: false } });
  assert.equal(off.planGate, false);
  assert.equal(off.opsRun, false);
  assert.equal(off.opsWrite, false);
  assert.equal(off.structGate, false);
  assert.equal(off.replyCheck, false);
  assert.equal(off.todoGate, false);
  assert.equal(off.bell, false);
  assert.equal(off.indexGate, false);
});

test("features 表：true 也不能打开没配置的功能（只能减不加）", () => {
  const f = resolveFeatures({ features: { planGate: true, opsRun: true, statusLine: true, versionWarn: true, statusTool: true, opsWrite: true } });
  assert.equal(f.planGate, false);
  assert.equal(f.opsRun, false);
  assert.equal(f.statusLine, false);
  assert.equal(f.versionWarn, false);
  assert.equal(f.statusTool, false);
  assert.equal(f.opsWrite, false);
  assert.equal(f.structGate, false);
  assert.equal(f.replyCheck, false);
  assert.equal(f.todoGate, false);
  assert.equal(f.maintHint, false);
  assert.equal(f.signals, false);
});

test("features 表：未知键忽略、非对象 features 当没写", () => {
  const f1 = resolveFeatures({ status: true, features: { nope: false } });
  assert.equal(f1.statusLine, true);
  const f2 = resolveFeatures({ status: true, features: "bad" });
  assert.equal(f2.statusLine, true);
});
// 2026-11-22（A 方案：功能分区）：组级开关一次关掉一整组的子系统
test("功能分区：conventions 组关掉整组，其它组不受影响", () => {
  const base = {
    status: true, versionWarning: true, statusTool: true, narrowTool: true, writeTool: true,
    planGate: true, structGates: [{ id: "tools" }], replyChecks: [{ id: "x" }],
    todoFile: "D:\\t.md", maintReport: "D:\\m.md", signalsFile: "D:\\s.log",
    denyBareCommands: ["x"], denyRawWritePaths: ["y"],
  };
  assert.deepEqual(FEATURE_GROUPS.conventions.length, 8);
  const off = resolveFeatures({ ...base, features: { conventions: false } });
  for (const k of FEATURE_GROUPS.conventions) assert.equal(off[k], false, k);
  assert.equal(off.statusLine, true);
  assert.equal(off.opsRun, true);
  const off2 = resolveFeatures({ ...base, features: { execTools: false } });
  assert.equal(off2.opsRun, false);
  assert.equal(off2.opsWrite, false);
  assert.equal(off2.bell, true);
});

test("功能分区：组名写 true 不能打开没配置的组，未知组忽略", () => {
  const f = resolveFeatures({ features: { conventions: true, observability: true, execTools: true, nope: false } });
  assert.equal(f.bell, true); // bell 默认开
  assert.equal(f.planGate, false); // 没配置就还是 off
  assert.equal(f.statusLine, false);
  assert.equal(f.opsRun, false);
});