// 集成测试（通用版）：替换 index.mjs 的导入为桩，模拟 ctx 与工具调用，验证注入与硬拦截。
// 纯内存 + 临时目录，不依赖 DSH 运行时。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = fileURLToPath(new URL("..", import.meta.url));

async function loadPlugin(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-guard-"));
  const skills = join(dir, "skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, "INDEX.md"), "# index\n", "utf8");
  writeFileSync(join(skills, "VERSION"), "17\n", "utf8");
  // 测试隔离：不要把本机真实维护报告注入进来
  process.env.OPS_MAINT_REPORT = join(dir, "MAINT-NONE.md");
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
    { skillsDir: skills, logFile: join(dir, "log.txt"), ...extra },
  );
  return {
    dir,
    handlers,
    indexPath: join(skills, "INDEX.md"),
    versionFile: join(skills, "VERSION"),
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

async function tryTool(handlers, sess, name, args = { file_path: "D:/tmp/x.txt" }) {
  return handlers.get("tools/pre-execute")(
    { name, arguments: args, agent: { session: sess } },
    async () => ({ kind: "allow" }),
  );
}

function markRead(handlers, sess, indexPath, isError = false) {
  handlers.get("tools/result")(
    { name: "read", arguments: { file_path: indexPath }, agent: { session: sess } },
    { isError },
  );
}

test("注入：首轮注入一次，同版本不重复；版本变化下一轮再注入", async () => {
  const { handlers, versionFile } = await loadPlugin();
  const s = session("s1");
  const r1 = await enterTurn(handlers, s, "今天天气怎么样");
  assert.equal(r1.messages.length, 2);
  const injected = JSON.stringify(r1.messages[1]);
  assert.ok(injected.includes("操作约定"));
  assert.ok(injected.includes("INDEX.md"));
  assert.ok(!injected.includes("只提醒一次") === false); // 通用文案包含「只提醒一次」

  const r2 = await enterTurn(handlers, s, "继续聊");
  assert.equal(r2.messages.length, 1);

  writeFileSync(versionFile, "18\n", "utf8");
  const r3 = await enterTurn(handlers, s, "随便聊聊");
  assert.equal(r3.messages.length, 2);
});

test("硬拦截：未读 INDEX 拒写；读过放行；只读命令始终放行", async () => {
  const { handlers, indexPath } = await loadPlugin();
  const s = session("s-guard");
  await enterTurn(handlers, s, "帮我改个脚本");

  const denied = await tryTool(handlers, s, "write");
  assert.equal(denied.kind, "deny");
  assert.ok(denied.reason.includes("INDEX.md"));
  assert.equal((await tryTool(handlers, s, "read")).kind, "allow");

  markRead(handlers, s, indexPath);
  assert.equal((await tryTool(handlers, s, "write")).kind, "allow");

  const s2 = session("s-fail");
  await enterTurn(handlers, s2, "整理目录");
  markRead(handlers, s2, indexPath, true);
  assert.equal((await tryTool(handlers, s2, "edit")).kind, "deny");
});

test("可选待办门（配置 todoFile 才启用）：读镜像不放行，必须跑校验器", async () => {
  const { dir } = await loadPlugin();
  const todoFile = join(dir, "todo", "OPEN.md");
  mkdirSync(join(dir, "todo"), { recursive: true });
  writeFileSync(todoFile, "# todo\n", "utf8");
  const { handlers, indexPath } = await loadPlugin({ todoFile });

  const s = session("s-todo");
  await enterTurn(handlers, s, "帮我改个脚本");
  markRead(handlers, s, indexPath);
  markRead(handlers, s, todoFile);
  const stillDenied = await tryTool(handlers, s, "write");
  assert.equal(stillDenied.kind, "deny");
  assert.ok(stillDenied.reason.includes("todo_check"));

  handlers.get("tools/result")(
    {
      name: "pwsh",
      arguments: { command: "powershell -NoProfile -File D:\\x\\todo_check.ps1" },
      agent: { session: s },
    },
    {},
  );
  assert.equal((await tryTool(handlers, s, "write")).kind, "allow");
});

test("可选待办门：校验器被串联时仍拒绝", async () => {
  const { dir } = await loadPlugin();
  const todoFile = join(dir, "todo", "OPEN.md");
  mkdirSync(join(dir, "todo"), { recursive: true });
  writeFileSync(todoFile, "# t\n", "utf8");
  const { handlers, indexPath } = await loadPlugin({ todoFile });
  const s = session("s-chain");
  await enterTurn(handlers, s, "改脚本");
  markRead(handlers, s, indexPath);
  const chained = await tryTool(handlers, s, "pwsh", {
    command: "powershell -NoProfile -File D:\\x\\todo_check.ps1 ; Remove-Item D:\\x -Force",
  });
  assert.equal(chained.kind, "deny");
});

test("可选结构门：配置后写该区域前必须先跑检查器", async () => {
  const { handlers, indexPath } = await loadPlugin({
    structGates: [
      { id: "docs", pathRe: "docs[/\\\\]", checkRe: "docs_check\\.py", checker: "python docs_check.py" },
    ],
  });
  const s = session("s-struct");
  await enterTurn(handlers, s, "改文档");
  markRead(handlers, s, indexPath);
  const denied = await tryTool(handlers, s, "write", { file_path: "D:/repo/docs/a.md" });
  assert.equal(denied.kind, "deny");
  assert.ok(denied.reason.includes("docs_check.py"));

  handlers.get("tools/result")(
    { name: "pwsh", arguments: { command: "python docs_check.py" }, agent: { session: s } },
    {},
  );
  assert.equal((await tryTool(handlers, s, "write", { file_path: "D:/repo/docs/a.md" })).kind, "allow");
});

test("可选维护报告：配置 maintReport 才注入 Issues 摘要", async () => {
  const { dir } = await loadPlugin();
  const report = join(dir, "MAINT.md");
  writeFileSync(report, "# r\n\n## Issues\n- broken a\n", "utf8");
  const { handlers } = await loadPlugin({ maintReport: report });
  const r = await enterTurn(handlers, session("s-maint"), "你好");
  assert.ok(JSON.stringify(r.messages).includes("维护报告"));
});
