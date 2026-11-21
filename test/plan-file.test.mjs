import test from "node:test";
import assert from "node:assert/strict";
import { planFileFor } from "../rule.mjs";

test("planFileFor: session workspace wins over the configured path", () => {
  assert.equal(planFileFor("D:\\global\\tasks\\PLAN.md", "D:\\software\\ToolsUse"), "D:\\software\\ToolsUse\\_tasks\\PLAN.md");
});

test("planFileFor: trailing separators are trimmed", () => {
  assert.equal(planFileFor("", "D:\\work\\"), "D:\\work\\_tasks\\PLAN.md");
  assert.equal(planFileFor("", "D:\\work\\/"), "D:\\work\\_tasks\\PLAN.md");
});

test("planFileFor: forward-slash workspace keeps forward slashes", () => {
  assert.equal(planFileFor("", "D:/work"), "D:/work/_tasks/PLAN.md");
});

test("planFileFor: no workspace falls back to the configured path", () => {
  assert.equal(planFileFor("D:\\global\\tasks\\PLAN.md", ""), "D:\\global\\tasks\\PLAN.md");
  assert.equal(planFileFor("D:\\global\\tasks\\PLAN.md", "   "), "D:\\global\\tasks\\PLAN.md");
});

test("planFileFor: nothing configured and no workspace gives empty", () => {
  assert.equal(planFileFor("", ""), "");
  assert.equal(planFileFor(undefined, undefined), "");
});
