// 仓库级 BOM 检查（2026-11-22）：CI 的 release 工作流会拒绝含 BOM 的 json/yml/mjs/md，
// 但本地在 push 前看不到；这里让 `node --test` 直接失败，避免"打完 tag 才发现 release 红"。
// 背景：test/plan-file.test.mjs 被编辑器带上 UTF-8 BOM，导致 v0.14.1 的 release 在第一步就退出。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const GATED = /\.(json|yml|yaml|mjs|md)$/i;
const SKIP_DIRS = new Set([".git", "node_modules", "_cache", "_local"]);

function scan(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      scan(p, hits);
      continue;
    }
    if (!GATED.test(name)) continue;
    const b = readFileSync(p);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) hits.push(relative(root, p));
  }
  return hits;
}

test("仓库文件不得带 UTF-8 BOM（CI 的 release 门禁会拒）", () => {
  const hits = scan(root);
  assert.deepEqual(hits, [], `带 BOM 的文件：${hits.join(", ")}`);
});
