import test from "node:test";
import assert from "node:assert/strict";
import { buildBareDenyRules, bareDenyHit } from "../rule.mjs";

const config = {
  denyBareCommands: [
    { id: "reindex-cli", pattern: "(?:^|[;&|]\\s*)(?:[^\\s;&|]*[\\\\/])?ov(?:\\.exe)?\\s+reindex\\b", hint: "ops_run mem-reindex-stale" },
    { id: "reindex-ps1", pattern: "(?:^|[;&|]\\s*)(?:[^\\s;&|]*[\\\\/])?(?:powershell|pwsh|cmd)(?:\\.exe)?\\b[^\\n]*mem-reindex|(?:^|[;&|]\\s*)[^\\s;&|]*mem-reindex(?:-stale)?\\.ps1", hint: "ops_run mem-reindex-stale" },
    { id: "habit-done", pattern: "(?:^|[;&|]\\s*)[^\\s;&|]*habit_inbox\\.ps1\\b[^\\n]*-done(?:s)?\\s+\\d", hint: "habit-inbox -DoneFromFile" },
  ],
};
const rules = buildBareDenyRules(config);

test("buildBareDenyRules: keeps valid rules, drops junk and bad regex", () => {
  assert.equal(rules.length, 3);
  assert.deepEqual(buildBareDenyRules({ denyBareCommands: [{ id: "x", pattern: "([", hint: "h" }, { pattern: "a" }, null, "nope"] }), []);
  assert.deepEqual(buildBareDenyRules({}), []);
});

test("bareDenyHit: bare ov reindex is blocked", () => {
  const hit = bareDenyHit("pwsh", { command: "ov reindex viking://user/default/memories --mode semantic_and_vectors" }, rules);
  assert.equal(hit.id, "reindex-cli");
  assert.match(hit.hint, /mem-reindex-stale/);
});

test("bareDenyHit: launching mem-reindex*.ps1 is blocked, reading it is not", () => {
  assert.equal(bareDenyHit("pwsh", { command: "powershell -File D:\\x\\mem-reindex.ps1 -Uri viking://a.md" }, rules).id, "reindex-ps1");
  assert.equal(bareDenyHit("pwsh", { command: "D:\\x\\mem-reindex-stale.ps1 -Quiet" }, rules).id, "reindex-ps1");
  assert.equal(bareDenyHit("pwsh", { command: "Get-Content D:\\x\\mem-reindex.ps1" }, rules), "");
});

test("bareDenyHit: free-text -Done is blocked; -List and -DoneFromFile are not", () => {
  assert.equal(bareDenyHit("pwsh", { command: 'habit_inbox.ps1 -Done 1 -Layer none -Why "x"' }, rules).id, "habit-done");
  assert.equal(bareDenyHit("pwsh", { command: "habit_inbox.ps1 -List" }, rules), "");
  assert.equal(bareDenyHit("pwsh", { command: "habit_inbox.ps1 -DoneFromFile D:\\w\\_reports\\habit_done.json" }, rules), "");
});

test("bareDenyHit: only shell tools are checked; ops_run and read are exempt", () => {
  assert.equal(bareDenyHit("ops_run", { id: "mem-reindex-stale", args: ["-Quiet"] }, rules), "");
  assert.equal(bareDenyHit("read", { file_path: "D:\\x\\mem-reindex.ps1" }, rules), "");
});

test("bareDenyHit: no rules means no hit", () => {
  assert.equal(bareDenyHit("pwsh", { command: "ov reindex x" }, []), "");
});
