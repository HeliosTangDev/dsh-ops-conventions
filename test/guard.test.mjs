// 集成测试：把 index.mjs 的两处导入替换成桩，模拟 ctx 与工具调用，验证硬拦截链路。
// 纯内存 + 临时目录，不依赖 DSH 运行时。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = fileURLToPath(new URL("..", import.meta.url));

async function loadPlugin() {
  const dir = mkdtempSync(join(tmpdir(), "opsconv-guard-"));
  const skills = join(dir, "skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, "INDEX.md"), "# index\n", "utf8");
  writeFileSync(join(skills, "VERSION"), "17\n", "utf8");
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
  return { handlers, indexPath: join(skills, "INDEX.md"), versionFile: join(skills, "VERSION") };
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

test("硬拦截：未读 INDEX 拒绝写工具，读过后放行，闲聊不拦", async () => {
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

  // 4) 闲聊轮次不拦
  const s3 = session("s3");
  await enterTurn(handlers, s3, "今天天气怎么样");
  assert.equal((await tryTool(handlers, s3, "write")).kind, "allow");

  // 5) 无 session 的调用 fail-open
  const noSession = await handlers.get("tools/pre-execute")(
    { name: "write", arguments: {} },
    async () => ({ kind: "allow" }),
  );
  assert.equal(noSession.kind, "allow");
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
