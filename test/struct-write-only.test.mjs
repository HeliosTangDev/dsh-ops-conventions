import test from "node:test";
import assert from "node:assert/strict";
import { buildStructGates, structGatesFor } from "../rule.mjs";

const config = {
  structGates: [
    { id: "docs", pathRe: "repo[\\\\/]docs", checkRe: "check\\.py", checker: "python check.py", writeOnly: true },
    { id: "legacy", pathRe: "legacy[\\\\/]area", checkRe: "check\\.py", checker: "python check.py" },
  ],
};
const gates = buildStructGates(config);

test("buildStructGates: writeOnly defaults to false", () => {
  assert.equal(gates.find((g) => g.id === "docs").writeOnly, true);
  assert.equal(gates.find((g) => g.id === "legacy").writeOnly, false);
});

test("writeOnly gate: shell read-only command no longer triggers", () => {
  assert.deepEqual(structGatesFor({ command: "Get-ChildItem D:/repo/docs" }, gates, "pwsh"), []);
  assert.deepEqual(structGatesFor({ command: "Get-Content D:/repo/docs/a.md" }, gates, "pwsh"), []);
});

test("writeOnly gate: shell write still triggers", () => {
  assert.deepEqual(structGatesFor({ command: "Set-Content D:/repo/docs/a.md x" }, gates, "pwsh"), ["docs"]);
  assert.deepEqual(structGatesFor({ command: "Remove-Item D:/repo/docs/a.md" }, gates, "pwsh"), ["docs"]);
});

test("writeOnly gate: file-write tools still trigger (path arg)", () => {
  assert.deepEqual(structGatesFor({ file_path: "D:/repo/docs/a.md" }, gates, "edit"), ["docs"]);
  assert.deepEqual(structGatesFor({ path: "D:/repo/docs/a.md" }, gates, "write"), ["docs"]);
});

test("writeOnly gate: explicitly read-only tools are skipped", () => {
  assert.deepEqual(structGatesFor({ file_path: "D:/repo/docs/a.md" }, gates, "read"), []);
  assert.deepEqual(structGatesFor({ path: "D:/repo/docs/a.md" }, gates, "grep"), []);
});

test("writeOnly gate: unknown capability stays fail-closed", () => {
  assert.deepEqual(structGatesFor({ args: ["D:/repo/docs/a.md"] }, gates, "ops_run"), ["docs"]);
  assert.deepEqual(structGatesFor({ path: "D:/repo/docs/a.md" }, gates, "ops_write"), ["docs"]);
});

test("legacy gate without writeOnly keeps old behaviour (shell read still triggers)", () => {
  assert.deepEqual(structGatesFor({ command: "Get-ChildItem D:/legacy/area" }, gates, "pwsh"), ["legacy"]);
  assert.deepEqual(structGatesFor({ command: "reg add HKCU\\X" }, gates, "pwsh"), []);
});
