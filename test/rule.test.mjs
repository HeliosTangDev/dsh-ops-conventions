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
  isShellWrite,
  isTodoCheck,
  isWriteTool,
  needsGuard,
  normalizeSessionId,
  projectionFileCandidates,
  isTodoRead,
  isToolsCheck,
  structGatesFor,
  structCheckIds,
  touchesToolArea,
  shouldInject,
  readVersion,
  reminderText,
  resolveSkillsDir,
  skillsDirCandidates,
  lastUserText,
  STRUCT_GATES,
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

test("注入文本：含版本号、索引路径与常驻约定", () => {
  const t = reminderText("8", "D:/x/INDEX.md");
  assert.ok(t.includes("v8"));
  assert.ok(t.includes("D:/x/INDEX.md"));
  for (const s of ["待会儿做", "结论与入口", "备份", "哈希", "由你定", "只改工具区", "换会话自决", "开场先扫", "_tasks", "不许吞", "绝对路径", "不问", "推断", "旧快照", "四件套", "放宽", "A/B/C", "_secrets", "主线", "可修", "candidates"]) {
    assert.ok(t.includes(s), `missing: ${s}`);
  }
  assert.ok(t.length < 950, `too long: ${t.length}`);
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

// ---- 0.5.0：待办镜像 tasks/OPEN.md ----

test("硬拦截：已读待办镜像的判定", () => {
  const todo = "D:\\software\\ToolsDev\\tasks\\OPEN.md";
  assert.equal(isTodoRead("read", { file_path: todo }, todo), true);
  assert.equal(isTodoRead("read", { file_path: "D:/software/ToolsDev/tasks/OPEN.md" }, todo), true);
  assert.equal(isTodoRead("read_file", { path: "d:/x/tasks/open.md" }, todo), true);
  assert.equal(isTodoRead("read", { file_path: "D:/x/notes.md" }, todo), false);
  assert.equal(isTodoRead("write", { file_path: todo }, todo), false);
  assert.equal(isTodoRead("read", { file_path: todo }, ""), false);
});

test("硬拦截：有镜像时必须跑校验器（读镜像不算）", () => {
  const todo = "D:/x/tasks/OPEN.md";
  const needCheck = denyReason("D:/x/INDEX.md", "17", todo);
  assert.ok(needCheck.includes("todo_check.ps1"), "应要求跑校验器");
  const noMirror = denyReason("D:/x/INDEX.md", "17", null);
  assert.ok(!noMirror.includes("todo_check.ps1"), "没有镜像时不强求校验器");
});

test("注入文案：给出镜像路径时提示跑校验器", () => {
  const withTodo = reminderText("18", "D:/x/INDEX.md", "D:/x/tasks/OPEN.md");
  assert.ok(withTodo.includes("todo_check.ps1"));
  assert.ok(!withTodo.includes("二选一"));
  const withoutTodo = reminderText("18", "D:/x/INDEX.md");
  assert.ok(!withoutTodo.includes("待办校验器"));
});
test("硬拦截：跑待办校验器（todo_check.ps1 / todo.cmd）的识别", () => {
  assert.equal(
    isTodoCheck("pwsh", { command: "powershell -NoProfile -File D:\\software\\ToolsUse\\_tools\\todo_check.ps1" }),
    true,
  );
  assert.equal(isTodoCheck("bash", { command: "cd /d D:/x && ./todo.cmd" }), true);
  assert.equal(isTodoCheck("pwsh", { command: "Get-Content D:/x/tasks/OPEN.md" }), false);
  assert.equal(isTodoCheck("read", { file_path: "D:/x/_tools/todo_check.ps1" }), false);
  assert.equal(isTodoCheck("pwsh", { command: "echo hi" }), false);
});

test("shell 写操作识别：pwsh 里的写命令要拦，只读命令不拦", () => {
  const write = [
    ["pwsh", { command: "Remove-Item D:\\x -Force" }],
    ["pwsh", { command: "Set-Content -Path a.txt -Value x" }],
    ["pwsh", { command: "Copy-Item a b" }],
    ["pwsh", { command: "echo hi > out.txt" }],
    ["bash", { command: "rm -rf dist" }],
    ["pwsh", { command: "git push origin main" }],
    ["pwsh", { command: "ov skills add D:/x -y" }],
    ["pwsh", { command: "node D:\\software\\ToolsDev\\dsh-ops-conventions\\release.mjs --push-only" }],
  ];
  for (const [name, args] of write) assert.equal(isShellWrite(name, args), true, `${name} ${JSON.stringify(args)}`);

  const readOnly = [
    ["pwsh", { command: "Get-ChildItem D:\\x" }],
    ["pwsh", { command: "Select-String -Path a.txt -Pattern foo" }],
    ["pwsh", { command: "git status --porcelain" }],
    ["pwsh", { command: "node --test test/" }],
    ["read", { file_path: "D:\\x\\a.txt" }],
    ["write", { file_path: "D:\\x\\a.txt" }],
  ];
  for (const [name, args] of readOnly) assert.equal(isShellWrite(name, args), false, `${name} ${JSON.stringify(args)}`);
});
test("写类工具按名字识别：内置与 MCP 写工具都算，shell/read 不算", () => {
  const yes = ["write", "edit", "multi_edit", "apply_patch", "mcp__openviking__write", "mcp__openviking__edit",
    "mcp__openviking__add_resource", "mcp__openviking__add_skill", "dshm_install", "dshm_upgrade", "dshm_toggle"];
  for (const n of yes) assert.equal(isWriteTool(n), true, n);
  const no = ["read", "pwsh", "bash", "web_search", "mcp__openviking__search", "mcp__openviking__remember", "agent_teams_status"];
  for (const n of no) assert.equal(isWriteTool(n), false, n);
});

test("shell 里读 INDEX/OPEN.md 也算已读", () => {
  const idx = "D:\\software\\ToolsDev\\ops-skills\\INDEX.md";
  const todo = "D:\\software\\ToolsDev\\tasks\\OPEN.md";
  assert.equal(isIndexRead("pwsh", { command: `Get-Content "${idx}"` }, idx), true);
  assert.equal(isIndexRead("pwsh", { command: "Get-ChildItem D:\\x" }, idx), false);
  assert.equal(isTodoRead("pwsh", { command: `type "${todo}"` }, todo), true);
  assert.equal(isTodoRead("read", { file_path: todo }, todo), true);
  assert.equal(isTodoRead("pwsh", { command: "git status" }, todo), false);
});
test("白名单矩阵：只读工具放行，写/未知工具一律要求先读约定", () => {
  // 放行：明确只读（内置 + MCP + 未来的只读命名）
  const allowed = ["read", "read_file", "glob", "grep", "list", "ls", "status", "get",
    "web_fetch", "web_search", "weather", "mcp__openviking__read", "mcp__openviking__find",
    "mcp__openviking__search", "mcp__openviking__list", "mcp__openviking__health",
    "agent_teams_status", "mcp__openviking__get_acl", "domain_search", "platform_search", "present"];
  for (const n of allowed) assert.equal(needsGuard(n, {}), false, `应放行: ${n}`);

  // 拦：内置写、MCP 写、dshm、调度、团队、以及"未来新增的未知工具"
  const blocked = ["write", "edit", "mcp__openviking__write", "mcp__openviking__edit",
    "mcp__openviking__remember", "mcp__openviking__add_resource", "mcp__openviking__add_skill",
    "dshm_install", "dshm_toggle", "schedule_create", "agent_teams_create", "agent_teams_spawn_member",
    "some_future_tool", "mcp__newsrv__upload", "todo_write"];
  for (const n of blocked) assert.equal(needsGuard(n, {}), true, `应拦: ${n}`);

  // shell：只读命令放行，写命令拦
  assert.equal(needsGuard("pwsh", { command: "Get-Process" }), false);
  assert.equal(needsGuard("pwsh", { command: "Remove-Item x" }), true);
  assert.equal(needsGuard("bash", { command: "ls -la" }), false);
});
test("会话 id 归一与投影缓存候选名：带/不带 session- 前缀都能命中", () => {
  const uuid = "cada2fe1-130a-4c63-9914-204fb6449855";
  assert.equal(normalizeSessionId("session-" + uuid), uuid);
  assert.equal(normalizeSessionId("session_" + uuid), uuid);
  assert.equal(normalizeSessionId(uuid), uuid);
  assert.deepEqual(projectionFileCandidates("session-" + uuid), ["session-" + uuid + ".json", uuid + ".json"]);
  assert.deepEqual(projectionFileCandidates(uuid), ["session-" + uuid + ".json", uuid + ".json"]);
  assert.deepEqual(projectionFileCandidates(""), []);
});
test("结构门：跑 tools_check.py 才放行工具区写操作", () => {
  assert.equal(isToolsCheck("pwsh", { command: "python D:\\software\\ToolsUse\\_tools\\misc\\tools_check.py" }), true);
  assert.equal(isToolsCheck("pwsh", { command: "python -m http.server" }), false);
  assert.equal(isToolsCheck("read", { file_path: "D:/software/ToolsUse/_tools/misc/tools_check.py" }), false);

  assert.equal(touchesToolArea({ file_path: "D:\\software\\ToolsUse\\TOOLS.md" }), true);
  assert.equal(touchesToolArea({ command: "copy a D:\\software\\ToolsDev\\x" }), true);
  assert.equal(touchesToolArea({ file_path: "D:\\TANG\\blog\\a.md" }), false);
  assert.equal(touchesToolArea({}), false);
});
test("通用结构门：按区域匹配检查器，加区域只加配置", () => {
  // 工具区 → tools 门
  assert.deepEqual(structGatesFor({ file_path: "D:\\software\\ToolsUse\\TOOLS.md" }), ["tools"]);
  assert.deepEqual(structGatesFor({ command: "copy a D:\\software\\ToolsDev\\x" }), ["tools"]);
  // 笔记区 → notes 门
  assert.deepEqual(structGatesFor({ file_path: "D:\\TANG\\blog\\article\\course\\x\\a.md" }), ["notes"]);
  // 两个区都碰到 → 两个门
  assert.deepEqual(structGatesFor({ paths: ["D:/software/ToolsUse/a", "D:/TANG/blog/article/course/b"] }).sort(), ["notes", "tools"]);
  // 无关路径 → 无门
  assert.deepEqual(structGatesFor({ file_path: "C:\\Users\\x\\a.txt" }), []);
  // 识别检查器调用
  assert.deepEqual(structCheckIds("pwsh", { command: "python D:\\software\\ToolsUse\\_tools\\misc\\tools_check.py" }), ["tools"]);
  assert.deepEqual(structCheckIds("pwsh", { command: "python D:\\software\\ToolsUse\\_tools\\misc\\notes_check.py" }), ["notes"]);
  assert.deepEqual(structCheckIds("pwsh", { command: "git status" }), []);
  // 每个门都有可执行的检查命令
  for (const g of STRUCT_GATES) assert.ok(g.checker && g.checker.length > 10, g.id);
});
import { maintHintText } from "../rule.mjs";
test("维护报告摘要：无 Issues 不注入，有 Issues 带出来", () => {
  assert.equal(maintHintText("# x\n\n## Issues\n- none\n"), "");
  assert.equal(maintHintText("# x\n"), "");
  const h = maintHintText("# x\n\n## Issues\n- a broken\n- b broken\n\n## Actions taken\n");
  assert.ok(h.includes("[维护报告] 2 项待处理"), h);
});
