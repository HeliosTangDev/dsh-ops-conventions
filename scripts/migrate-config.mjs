// 一次性迁移工具（B 方案）：把 profile 里 dsh-ops-conventions 的「路径类键」
// 从 cordis.patch.yml 挪进插件自己的 JSON，YAML 只留下开关 + configFile 指针。
//
// 用法：
//   node scripts/migrate-config.mjs --profile-yaml <cordis.patch.yml> --json <out.json>            # 只预演
//   node scripts/migrate-config.mjs --profile-yaml <...> --json <out.json> --write                  # 真写（先备份 YAML）
//
// 验收内建：迁移前后「插件实际生效的 config」必须深度相等，否则不写任何文件、退出码 1。
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require_ = createRequire(import.meta.url);

function loadYaml() {
  const candidates = [
    "yaml",
    "C:/Users/TANG/.dsh/profiles/desktop/node_modules/yaml",
    "C:/Users/TANG/.dsh/profiles/web/node_modules/yaml",
    "D:/software/DSH/resources/app.asar/node_modules/yaml",
  ];
  for (const c of candidates) {
    try {
      return require_(c);
    } catch {}
  }
  return null;
}

const ENTRY_ID = "dsh-ops-conventions";
// 只搬“本机路径/路径数组”，其余（开关、策略数组）留在 YAML。
const PATH_KEYS = [
  "skillsDir",
  "logFile",
  "bellExtraFile",
  "todoFile",
  "todoCheckCmd",
  "maintReport",
  "signalsFile",
  "hostVersionFile",
  "versionWarnFile",
  "replyWarnFile",
  "todoLastFile",
  "statusTodoJson",
  "memoryDir",
  "statusRepoDir",
  "planFile",
  "narrowConfigFile",
  "narrowRoot",
  "asarCandidates",
  "installedProfileDirs",
];

function parseArgs(argv) {
  const out = { write: false, dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") { out.write = true; out.dryRun = false; }
    else if (a === "--dry-run") { out.dryRun = true; out.write = false; }
    else if (a === "--profile-yaml") out.profileYaml = argv[++i];
    else if (a === "--json") out.json = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.profileYaml || !out.json) throw new Error("need --profile-yaml and --json");
  return out;
}

function findEntryIndex(doc) {
  if (!Array.isArray(doc)) throw new Error("patch yaml is not a top-level array");
  const idx = doc.findIndex((row) => row && row.id === ENTRY_ID);
  if (idx < 0) throw new Error(`entry ${ENTRY_ID} not found`);
  return idx;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const yaml = loadYaml();
  if (!yaml) throw new Error("yaml module not found (tried profile node_modules and app.asar)");

  const text = readFileSync(args.profileYaml, "utf8");
  const doc = yaml.parse(text);
  const idx = findEntryIndex(doc);
  const entry = doc[idx];
  const original = { ...(entry.config || {}) };

  const jsonConfig = {};
  const yamlConfig = {};
  for (const [k, v] of Object.entries(original)) {
    if (PATH_KEYS.includes(k)) jsonConfig[k] = v;
    else yamlConfig[k] = v;
  }
  yamlConfig.configFile = args.json;

  // 验收：合并结果（去掉新增的 configFile 指针）必须与迁移前完全一致（浅合并语义与插件一致）
  const merged = { ...jsonConfig, ...yamlConfig };
  const { configFile: _cfgPointer, ...mergedRest } = merged;
  assert.deepEqual(mergedRest, original, "migrated config differs from original");

  const lines = [];
  lines.push(`entry=${ENTRY_ID} pathKeys=${Object.keys(jsonConfig).length} yamlKeys=${Object.keys(yamlConfig).length}`);
  lines.push(`json  -> ${args.json} (${Object.keys(jsonConfig).length} keys)`);
  lines.push(`yaml  -> ${Object.keys(yamlConfig).join(", ")}`);
  lines.push("equivalence: OK (merged === original)");
  if (args.dryRun) {
    lines.push("dry-run: nothing written");
    console.log(lines.join("\n"));
    return;
  }

  const jsonText = JSON.stringify(jsonConfig, null, 2) + "\n";
  writeFileSync(args.json, jsonText, "utf8");
  lines.push(`wrote json (${Buffer.byteLength(jsonText)} bytes)`);

  // 用 YAML 重新序列化「只这一个 entry」，其余 entry 原样保留
  const newEntry = { ...entry, config: yamlConfig };
  const head = doc.slice(0, idx);
  const tail = doc.slice(idx + 1);
  const dump = (rows) => (rows.length ? yaml.stringify(rows).trimEnd() : "");
  const nextText = [dump(head), dump([newEntry]), dump(tail)].filter(Boolean).join("\n") + "\n";

  const backup = `${args.profileYaml}.bak-migrate-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  copyFileSync(args.profileYaml, backup);
  writeFileSync(args.profileYaml, nextText, "utf8");

  // 读回校验：新 YAML 解析出的 entry config 与预期一致；备份存在
  const back = yaml.parse(readFileSync(args.profileYaml, "utf8"));
  const backEntry = back.find((r) => r && r.id === ENTRY_ID);
  const backMerged = { ...JSON.parse(readFileSync(args.json, "utf8")), ...(backEntry.config || {}) };
  const { configFile: _backPointer, ...backRest } = backMerged;
  assert.deepEqual(backRest, original, "read-back merged config differs from original");
  assert.ok(existsSync(backup), "backup file missing");
  lines.push(`yaml rewritten; backup=${backup}`);
  lines.push("read-back equivalence: OK");
  console.log(lines.join("\n"));
}

try {
  main();
} catch (err) {
  console.error("MIGRATE FAILED: " + (err?.message ?? String(err)));
  process.exit(1);
}
