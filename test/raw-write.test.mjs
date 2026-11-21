import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDenyWritePaths, denyWriteHit, rawWriteHit, isShellWrite } from "../rule.mjs";

const FILES = normalizeDenyWritePaths([
  "D:/software/ToolsUse/_tools/misc/IMPROVEMENTS.md",
  "D:\\software\\ToolsUse\\_tools\\misc\\DECISIONS.md\\",
  "",
]);

test("normalizeDenyWritePaths: slashes, case, trailing sep, junk", () => {
  assert.deepEqual(FILES, [
    "d:\\software\\toolsuse\\_tools\\misc\\improvements.md",
    "d:\\software\\toolsuse\\_tools\\misc\\decisions.md",
  ]);
  assert.deepEqual(normalizeDenyWritePaths(null), []);
  assert.deepEqual(normalizeDenyWritePaths("x"), []);
});

test("denyWriteHit: exact, case/slash insensitive, no bare-prefix match", () => {
  assert.equal(denyWriteHit("D:/SOFTWARE/ToolsUse/_tools/misc/IMPROVEMENTS.md", FILES), FILES[0]);
  assert.equal(denyWriteHit("D:\\software\\ToolsUse\\_tools\\misc\\IMPROVEMENTS.md.bak", FILES), "");
  assert.equal(denyWriteHit("D:\\software\\ToolsUse\\_tools\\misc\\other.md", FILES), "");
  assert.equal(denyWriteHit("", FILES), "");
});

test("rawWriteHit: file tools hit on path arg; content mention does not", () => {
  assert.equal(rawWriteHit("edit", { file_path: "D:\\software\\ToolsUse\\_tools\\misc\\DECISIONS.md" }, FILES), FILES[1]);
  assert.equal(rawWriteHit("write", { path: "D:\\software\\ToolsUse\\_tools\\misc\\DECISIONS.md" }, FILES), FILES[1]);
  assert.equal(rawWriteHit("write", { path: "D:\\software\\ToolsUse\\_tools\\todo\\todo.json" }, FILES), "");
  assert.equal(
    rawWriteHit("edit", { file_path: "D:\\x.md", new_string: "D:\\software\\ToolsUse\\_tools\\misc\\DECISIONS.md" }, FILES),
    "",
  );
});

test("rawWriteHit: shell write hits, shell read allowed", () => {
  assert.equal(
    rawWriteHit("pwsh", { command: "Add-Content -Path 'D:\\software\\ToolsUse\\_tools\\misc\\IMPROVEMENTS.md' -Value x" }, FILES),
    FILES[0],
  );
  assert.equal(rawWriteHit("pwsh", { command: "Get-Content 'D:\\software\\ToolsUse\\_tools\\misc\\IMPROVEMENTS.md'" }, FILES), "");
  assert.equal(rawWriteHit("pwsh", { command: "Get-ChildItem D:\\software\\ToolsUse\\_tools\\misc" }, FILES), "");
  assert.equal(isShellWrite("pwsh", { command: "Get-Content x" }), false);
});

test("rawWriteHit: sanctioned channels and read tools are exempt", () => {
  assert.equal(rawWriteHit("ops_write", { path: "D:\\software\\ToolsUse\\_tools\\misc\\IMPROVEMENTS.md" }, FILES), "");
  assert.equal(rawWriteHit("ops_run", { id: "improve", args: ["-List"] }, FILES), "");
  assert.equal(rawWriteHit("read", { file_path: "D:\\software\\ToolsUse\\_tools\\misc\\DECISIONS.md" }, FILES), "");
  assert.equal(rawWriteHit("pwsh", { command: "Set-Content a.txt b" }, []), "");
});
