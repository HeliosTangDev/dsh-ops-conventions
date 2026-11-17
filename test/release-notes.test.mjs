// 发布说明抽取器测试：CI 的 release body 依赖它，抽错比没有更糟，所以覆盖边界。
import test from "node:test";
import assert from "node:assert/strict";

import { extractReleaseNotes, buildReleaseNotes } from "../scripts/release-notes.mjs";

const SAMPLE = [
  "## 0.9.7（2026-11-20）",
  "",
  "- 新增 A",
  "- 修复 B",
  "",
  "### 子标题不进边界",
  "",
  "- 仍在 0.9.7 里",
  "",
  "## 0.9.6（续，2026-11-16 / 11-18）",
  "",
  "- 续段内容",
  "",
  "## 0.9.6（2026-11-08）",
  "",
  "- 旧段内容",
  "",
  "## 0.9.5（2026-11-08）",
  "",
  "- 不该被带出",
  "",
].join("\n");

test("抽取指定版本：只取该段，遇到下一个版本的 ## 停止", () => {
  const out = extractReleaseNotes(SAMPLE, "0.9.7");
  assert.match(out, /新增 A/);
  assert.match(out, /仍在 0.9.7 里/); // ### 子标题不算边界
  assert.doesNotMatch(out, /续段内容|旧段内容|不该被带出/);
});

test("同一版本多段按文件顺序拼接（0.9.6 续 + 旧段）", () => {
  const out = extractReleaseNotes(SAMPLE, "0.9.6");
  assert.match(out, /续段内容/);
  assert.match(out, /旧段内容/);
  assert.doesNotMatch(out, /不该被带出|新增 A/);
  assert.equal(out.indexOf("续段内容") < out.indexOf("旧段内容"), true);
});

test("接受 v 前缀与带后缀的标题", () => {
  assert.match(extractReleaseNotes(SAMPLE, "v0.9.6"), /续段内容/);
  assert.match(extractReleaseNotes(SAMPLE, " 0.9.7 "), /新增 A/);
});

test("CRLF 换行同样可解析", () => {
  const crlf = SAMPLE.replace(/\n/g, "\r\n");
  assert.match(extractReleaseNotes(crlf, "0.9.7"), /新增 A/);
});

test("找不到版本：抽取返回空，build 给兜底文本不回空", () => {
  assert.equal(extractReleaseNotes(SAMPLE, "1.2.3"), "");
  const body = buildReleaseNotes(SAMPLE, "1.2.3");
  assert.match(body, /CHANGELOG\.md/);
  assert.match(body, /1\.2\.3/);
  assert.equal(body.trim().length > 0, true);
});
