// 离线模拟：伪造 session/event 的用户消息，验证“事件 → 收件行”整条判据。
// 运行：node test/habit-sim.test.mjs   （沙箱内 node --test 会 spawn EPERM，故直接跑本文件）
import test from "node:test";
import assert from "node:assert/strict";
import { habitRow } from "../rule.mjs";

const SID = "session-sim-0001";

test("sim: corrective user message becomes an inbox row", () => {
  const row = habitRow(SID, "user", "user/message", "为啥这个状态实时同步一直搞不好（正好测试新机制）");
  assert.ok(row, "should capture");
  assert.equal(row.session, SID);
  assert.equal(row.marker, "为啥");
  assert.ok(row.text.includes("实时同步"));
});

test("sim: neutral user message is ignored", () => {
  assert.equal(habitRow(SID, "user", "user/message", "好的，继续"), null);
});

test("sim: short corrective text is ignored", () => {
  assert.equal(habitRow(SID, "user", "user/message", "为啥"), null);
});

test("sim: assistant text is ignored", () => {
  assert.equal(habitRow(SID, "assistant", "assistant/message", "为什么这次又没写现场时间？"), null);
});

test("sim: actual session event shape (data.role + content text)", () => {
  // 日志实证的形态：type=user/message role=user dataKeys=content,source,role,id
  const data = { role: "user", content: "为什么这次没有触发？", source: "web", id: "m1" };
  const row = habitRow(SID, data.role, "user/message", data.content);
  assert.ok(row);
  assert.equal(row.marker, "为什么");
});

test("sim: injected bell text is not a user habit signal", () => {
  const bell = "「操作约定 v92」动手前必须 read D:\\software\\ToolsDev\\ops-skills\\INDEX.md 并执行对应清单";
  assert.equal(habitRow(SID, "user", "user/message", "[操作约定 v92] 动手前必须 read D:\\software\\ToolsDev\\ops-skills\\INDEX.md 并执行对应清单"), null);
});

test("sim: injected memory context is not a user habit signal", () => {
  const ctx = "<openviking-context>\nRelevant memory from OpenViking. 之前说过的内容";
  assert.equal(habitRow(SID, "user", "user/message", ctx), null);
});