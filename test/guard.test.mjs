// 集成测试：把 index.mjs 的两处导入替换成桩，模拟 ctx 与工具调用，验证硬拦截链路。
// 纯内存 + 临时目录，不依赖 DSH 运行时。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = fileURLToPath(new URL("..", import.meta.url));

async function loadPlugin(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-guard-"));
  const skills = join(dir, "skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, "INDEX.md"), "# index\n", "utf8");
  writeFileSync(join(skills, "VERSION"), "17\n", "utf8");
  // 0.5.0：可选生成待办镜像 <dir>\tasks\OPEN.md（约定目录的上一级）
  if (opts.withTodo) {
    mkdirSync(join(dir, "tasks"), { recursive: true });
    writeFileSync(join(dir, "tasks", "OPEN.md"), "# 待办镜像\n", "utf8");
  }
  writeFileSync(join(dir, "stub.mjs"), "export function createUserMessage(p){ return { role: 'user', ...p }; }\n");
  const ruleHref = pathToFileURL(join(srcDir, "rule.mjs")).href;
  const code = readFileSync(join(srcDir, "index.mjs"), "utf8")
    .replace('from "./rule.mjs"', `from "${ruleHref}"`)
    .replace('from "@deepseek-ai/dsh-llm"', 'from "./stub.mjs"');
  writeFileSync(join(dir, "index-test.mjs"), code);

  const { apply } = await import(pathToFileURL(join(dir, "index-test.mjs")).href);
  const handlers = new Map();
  apply(
    { logger: { info() {} }, on(name, fn) { handlers.set(name, fn); } },
    { skillsDir: skills, logFile: join(dir, "log.txt") },
  );
  return {
    handlers,
    indexPath: join(skills, "INDEX.md"),
    versionFile: join(skills, "VERSION"),
    todoPath: join(dir, "tasks", "OPEN.md"),
  };
}

function session(id) {
  return { id };
}

async function enterTurn(handlers, sess, text) {
  const decision = { kind: "enter", messages: [{ role: "user", content: text }] };
  return handlers.get("agent/pre-step")(
    { agent: { session: sess }, messages: decision.messages },
    async () => decision,
  );
}

async function tryTool(handlers, sess, name) {
  return handlers.get("tools/pre-execute")(
    { name, arguments: { file_path: "D:/tmp/x.txt" }, agent: { session: sess } },
    async () => ({ kind: "allow" }),
  );
}

function markRead(handlers, sess, indexPath, isError = false) {
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: indexPath }, agent: { session: sess } },
    { isError },
  );
}

test("硬拦截：未读 INDEX 拒绝写工具，读过后放行，闲聊轮次也拦", async () => {
  const { handlers, indexPath } = await loadPlugin();

  // 1) 操作类轮次 + 未读 INDEX → 写工具被拒；只读仍放行
  const s1 = session("s1");
  await enterTurn(handlers, s1, "帮我改个脚本");
  const denied = await tryTool(handlers, s1, "write");
  assert.equal(denied.kind, "deny");
  assert.ok(denied.reason.includes("INDEX.md"));
  assert.equal((await tryTool(handlers, s1, "read")).kind, "allow");

  // 2) 成功读到 INDEX 后放行
  markRead(handlers, s1, indexPath);
  assert.equal((await tryTool(handlers, s1, "write")).kind, "allow");

  // 3) 读失败不算已读
  const s2 = session("s2");
  await enterTurn(handlers, s2, "把笔记整理一下");
  markRead(handlers, s2, indexPath, true);
  assert.equal((await tryTool(handlers, s2, "edit")).kind, "deny");

  // 4) 闲聊轮次也拦（0.5.2 起：写类调用即判定，与用户措辞无关）
  const s3 = session("s3");
  await enterTurn(handlers, s3, "今天天气怎么样");
  assert.equal((await tryTool(handlers, s3, "write")).kind, "deny");

  // 5) 无 session 的调用用全局「已读」标记兜底：全局未读 → 拒绝（0.5.3 起不再直接放行）
  const noSession = await handlers.get("tools/pre-execute")(
    { name: "write", arguments: {} },
    async () => ({ kind: "allow" }),
  );
  assert.equal(noSession.kind, "deny");
});

test("注入：下一轮即注入（含闲聊），同会话同版本只一次", async () => {
  const { handlers, versionFile } = await loadPlugin();
  const s = session("s-inj");

  // 新会话首轮（闲聊）就注入一次
  const r1 = await enterTurn(handlers, s, "今天天气怎么样");
  assert.equal(r1.messages.length, 2);
  assert.ok(JSON.stringify(r1.messages[1]).includes("操作约定"));

  // 同版本不再注入
  const r2 = await enterTurn(handlers, s, "继续聊");
  assert.equal(r2.messages.length, 1);

  // 版本变化：下一轮（闲聊）立刻注入
  writeFileSync(versionFile, "18\n", "utf8");
  const r3 = await enterTurn(handlers, s, "随便聊聊");
  assert.equal(r3.messages.length, 2);

  // 再次同版本不注入
  const r4 = await enterTurn(handlers, s, "还是闲聊");
  assert.equal(r4.messages.length, 1);

  // 另一个会话首轮也注入一次
  const s2 = session("s-inj2");
  const r5 = await enterTurn(handlers, s2, "你好");
  assert.equal(r5.messages.length, 2);
});

test("硬拦截：只读镜像不再放行；必须跑 todo_check.ps1", async () => {
  const { handlers, indexPath, todoPath } = await loadPlugin({ withTodo: true });
  const s = session("s-todo");
  await enterTurn(handlers, s, "帮我改个脚本");

  // 读 INDEX + 读镜像 → 还是被拒（读规则不算校验）
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: indexPath }, agent: { session: s } },
    {},
  );
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: todoPath }, agent: { session: s } },
    {},
  );
  const stillDenied = await tryTool(handlers, s, "write");
  assert.equal(stillDenied.kind, "deny");
  assert.ok(stillDenied.reason.includes("todo_check.ps1"));

  // 跑过校验器之后才放行
  handlers.get("tools/result")(
    {
      name: "pwsh",
      arguments: { command: "powershell -NoProfile -File D:\\software\\ToolsUse\\_tools\\todo\\todo_check.ps1" },
      agent: { session: s },
    },
    {},
  );
  assert.equal((await tryTool(handlers, s, "write")).kind, "allow");

  // 校验器失败（isError）不算
  const s2 = session("s-todo-fail");
  await enterTurn(handlers, s2, "整理一下目录");
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: indexPath }, agent: { session: s2 } },
    {},
  );
  handlers.get("tools/result")(
    {
      name: "pwsh",
      arguments: { command: "powershell -NoProfile -File D:\\software\\ToolsUse\\_tools\\todo\\todo_check.ps1" },
      agent: { session: s2 },
    },
    { isError: true },
  );
  assert.equal((await tryTool(handlers, s2, "edit")).kind, "deny");

  // 注入文案里应提示跑校验器
  const r = await enterTurn(handlers, session("s-todo-inj"), "把笔记整理一下");
  assert.ok(JSON.stringify(r.messages).includes("todo_check.ps1"));
});

test("硬拦截：不读镜像、改为跑 todo_check.ps1 也应放行（B 方案的硬拦动作）", async () => {
  const { handlers, indexPath } = await loadPlugin({ withTodo: true });
  const s = session("s-todo-check");
  await enterTurn(handlers, s, "帮我改个脚本");

  // 只读 INDEX + 没读镜像 → 仍拦
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: indexPath }, agent: { session: s } },
    {},
  );
  assert.equal((await tryTool(handlers, s, "write")).kind, "deny");

  // 用 pwsh 跑待办校验器 → 视为已完成「报前先校验」，放行
  handlers.get("tools/result")(
    {
      name: "pwsh",
      arguments: { command: "powershell -NoProfile -File D:\\software\\ToolsUse\\_tools\\todo_check.ps1" },
      agent: { session: s },
    },
    {},
  );
  assert.equal((await tryTool(handlers, s, "write")).kind, "allow");

  // 只读命令里有 todo_check 字样但工具是 read → 不算（必须是 shell 执行）
  const s2 = session("s-todo-check-neg");
  await enterTurn(handlers, s2, "把配置改一下");
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: indexPath }, agent: { session: s2 } },
    {},
  );
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: "D:/x/_tools/todo_check.ps1" }, agent: { session: s2 } },
    {},
  );
  assert.equal((await tryTool(handlers, s2, "write")).kind, "deny");
});
