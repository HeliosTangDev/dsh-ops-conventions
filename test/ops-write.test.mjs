// Pure-logic tests for the ops_write guard layer (2026-11-21): node test/ops-write.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWriteWhitelist,
  isWritePathAllowed,
  prepareWriteContent,
} from "../rule.mjs";

test("normalizeWriteWhitelist keeps absolute paths, lowercases and strips trailing sep", () => {
  const out = normalizeWriteWhitelist([
    "D:\\software\\ToolsUse\\_tools\\todo\\",
    "d:\\software\\toolsuse\\_tools\\mem\\mem_index.py",
    "relative/path.ps1",
    "",
    null,
  ]);
  assert.deepEqual(out, [
    "d:\\software\\toolsuse\\_tools\\todo",
    "d:\\software\\toolsuse\\_tools\\mem\\mem_index.py",
  ]);
});

test("isWritePathAllowed: exact file match and directory prefix", () => {
  const wl = normalizeWriteWhitelist([
    "D:\\software\\ToolsUse\\_tools\\todo\\",
    "D:\\software\\ToolsUse\\_tools\\mem\\mem_index.py",
  ]);
  assert.equal(isWritePathAllowed("D:\\software\\ToolsUse\\_tools\\todo\\todo_check.ps1", wl).ok, true);
  assert.equal(isWritePathAllowed("D:\\software\\ToolsUse\\_tools\\mem\\mem_index.py", wl).ok, true);
  assert.equal(isWritePathAllowed("D:\\software\\ToolsUse\\_tools\\mem\\mem_audit.py", wl).ok, false);
});

test("isWritePathAllowed rejects traversal and system areas", () => {
  const wl = normalizeWriteWhitelist(["D:\\software\\ToolsUse\\_tools\\todo\\"]);
  assert.equal(isWritePathAllowed("D:\\software\\ToolsUse\\_tools\\todo\\..\\..\\evil.ps1", wl).ok, false);
  assert.equal(isWritePathAllowed("C:\\Users\\TANG\\.dsh\\profiles\\web\\package.json", wl).ok, false);
  assert.equal(isWritePathAllowed("relative\\todo.ps1", wl).ok, false);
});

test("prepareWriteContent adds a BOM for .ps1 with non-ASCII and no BOM", () => {
  const r = prepareWriteContent("D:\\x\\a.ps1", "Write-Output '你好'", {});
  assert.equal(r.ok, true);
  const bytes = Buffer.from(r.content, "utf8");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("prepareWriteContent keeps .json free of BOM and validates JSON", () => {
  const ok = prepareWriteContent("D:\\x\\a.json", '{"a":1}', {});
  assert.equal(ok.ok, true);
  const bytes = Buffer.from(ok.content, "utf8");
  assert.equal(bytes[0], 0x7b); // '{'
  const bad = prepareWriteContent("D:\\x\\a.json", "{oops", {});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /JSON/);
});

test("prepareWriteContent rejects oversize content", () => {
  const big = "x".repeat(600 * 1024);
  const r = prepareWriteContent("D:\\x\\a.txt", big, {});
  assert.equal(r.ok, false);
});
