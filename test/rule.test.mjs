// 纯逻辑测试（不依赖 DSH 运行时）：node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_BLOCKED_TOOLS,
  denyReason,
  isBlockedTool,
  isIndexRead,
  shouldInject,
  readVersion,
  reminderText,
  resolveSkillsDir,
  skillsDirCandidates,
  lastUserText,
} from "../rule.mjs";

test("触发判断：操作类句子命中", () => {
  for (const s of [
    "帮我写个备份脚本",
    "把笔记整理一下",
    "这个月 dsh 插件有更新吗，升级一下",
    "跑批任务中断了怎么恢复",
    "把 english/quiz.mp4 移到 _media",
    "帮我改一下 index.mjs 的文案",
    "把配置里的路径换成 D:/x",
  ]) {
    assert.equal(shouldInject(s), true, s);
  }
});

test("触发判断：闲聊不命中", () => {
  for (const s of ["今天天气怎么样", "你好呀", "讲个笑话", ""]) {
    assert.equal(shouldInject(s), false, s);
  }
});

test("版本读取：VERSION / version.json / 缺失", () => {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-"));
  try {
    writeFileSync(join(dir, "VERSION"), "8\n", "utf8");
    assert.equal(readVersion(join(dir, "VERSION")), "8");

    const dir2 = join(dir, "v2");
    mkdirSync(dir2);
    writeFileSync(join(dir2, "version.json"), '{"version":"9"}', "utf8");
    assert.equal(readVersion(join(dir2, "VERSION")), "9");

    assert.equal(readVersion(join(dir, "nope")), "1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("注入文本：含版本号、索引路径与 6 行常驻约定", () => {
  const t = reminderText("8", "D:/x/INDEX.md");
  assert.ok(t.includes("v8"));
  assert.ok(t.includes("D:/x/INDEX.md"));
  for (const s of ["待会儿做", "先给结论与入口", "备份", "哈希", "由本人拍板", "只修改工具区", "关会话", "开场先扫", "_tasks", "不许吞", "绝对路径", "不问", "推断", "权限"]) {
    assert.ok(t.includes(s), `missing: ${s}`);
  }
  assert.ok(t.length < 700, `too long: ${t.length}`);
});

test("路径解析：有 INDEX.md 的目录优先，其次包内 skills", () => {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-"));
  try {
    const custom = join(dir, "custom");
    mkdirSync(custom);
    writeFileSync(join(custom, "INDEX.md"), "# index", "utf8");
    assert.equal(resolveSkillsDir({ skillsDir: custom }), custom);

    // 不存在的配置目录会被跳过（落回候选里第一个真实存在的）
    const got = resolveSkillsDir({ skillsDir: join(dir, "missing") });
    assert.notEqual(got, join(dir, "missing"));
    assert.ok(skillsDirCandidates({}).length >= 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("取最后一条用户消息", () => {
  assert.equal(
    lastUserText([
      { role: "user", content: "第一条" },
      { role: "assistant", content: "回复" },
      { role: "user", content: [{ type: "text", text: "最后一条" }] },
    ]),
    "最后一条",
  );
  assert.equal(lastUserText(undefined), "");
});

test("硬拦截：写工具默认拦截，只读/未知工具放行", () => {
  assert.ok(DEFAULT_BLOCKED_TOOLS.includes("write"));
  assert.equal(isBlockedTool("write"), true);
  assert.equal(isBlockedTool("Edit"), true);
  assert.equal(isBlockedTool("apply_patch"), true);
  assert.equal(isBlockedTool("read"), false);
  assert.equal(isBlockedTool("bash"), false);
  assert.equal(isBlockedTool("unknown_tool"), false);
});

test("硬拦截：已读 INDEX 的判定", () => {
  const idx = "D:\\software\\ToolsDev\\ops-skills\\INDEX.md";
  assert.equal(isIndexRead("read", { file_path: idx }, idx), true);
  assert.equal(isIndexRead("read", { file_path: "D:/software/ToolsDev/ops-skills/INDEX.md" }, idx), true);
  assert.equal(isIndexRead("read_file", { path: idx }, idx), true);
  assert.equal(isIndexRead("read", { file_path: "D:/x/notes.md" }, idx), false);
  assert.equal(isIndexRead("write", { file_path: idx }, idx), false);
  assert.equal(isIndexRead("read", { uris: ["viking://user/default/skills/ops-check/SKILL.md"] }, idx), false);
});

test("硬拦截：拒绝理由包含索引路径与版本", () => {
  const r = denyReason("D:/x/INDEX.md", "17");
  assert.ok(r.includes("D:/x/INDEX.md"));
  assert.ok(r.includes("v17"));
  assert.ok(r.includes("read"));
});
