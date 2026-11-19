// B 方案：配置外置（路径类放 JSON、YAML 只留开关）的合并逻辑测试。
// 关键约定：YAML 显式键优先于 JSON；读不到/解析失败时完全按 YAML 跑（fail-open，不改变现行为）。
import test from "node:test";
import assert from "node:assert/strict";

import { mergeExternalConfig, readExternalConfig } from "../config.mjs";

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
