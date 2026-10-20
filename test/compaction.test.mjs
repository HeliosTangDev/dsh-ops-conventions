import assert from "node:assert/strict";
import { compactionHintText, compactionStats } from "../rule.mjs";

const fixture = {
  record: {
    rows: {
      contextTimeline: {
        val: {
          contextWindow: 1000000,
          events: [
            { seq: 10, kind: "inject", name: "openviking-memory" },
            { seq: 3084, kind: "compaction", tokens: 589573, count: 1211 },
            { seq: 5599, kind: "compaction", tokens: 455358, count: 939 },
          ],
        },
      },
      contextPressure: { val: { pressureTokens: 211806, contextWindow: 1000000 } },
    },
  },
};

const stats = compactionStats(fixture);
assert.equal(stats.count, 2, "数到两次压缩");
assert.equal(stats.percent, 21, "压力百分比按 pressionTokens/窗口算");
assert.equal(stats.last.seq, 5599, "last 取最近一次压缩");

const hint = compactionHintText(stats);
assert.match(hint, /压缩 2 次/, "提示里带次数");
assert.match(hint, /21%/, "提示里带占用率");

const none = compactionStats(null);
assert.equal(none.count, 0);
assert.equal(compactionHintText(none), null, "没压缩过不注入");

const archiveOnly = {
  record: { rows: { contextTimeline: { val: { events: [{ kind: "prune" }], archived: new Array(400).fill({}) } } } },
};
assert.equal(compactionStats(archiveOnly).count, 0, "archived 不算压缩次数");

console.log("compaction.test.mjs OK");
