// 配置外置（B 方案）：把「本机路径」这类易变的键放进插件自己的 JSON，
// profile 的 cordis.patch.yml 只留开关，减少手改 YAML 的面。
//
// 规则（有意做窄）：
//   · 只有 YAML 里显式写 configFile 时才读外部文件；读不到/坏了就完全按 YAML 跑（fail-open）。
//   · 合并是浅合并：同一个键 YAML 优先，并把被覆盖的键名记下来供日志输出（避免"两套口径"）。
//   · 数组整体替换，不做元素级合并——配置是声明式的，半合并比不合并更难排查。

/** 纯合并：把文件里的配置作为底，YAML 显式键盖上。 */
export function mergeExternalConfig(yamlConfig, fileConfig) {
  const base = yamlConfig && typeof yamlConfig === "object" ? yamlConfig : {};
  if (!fileConfig || typeof fileConfig !== "object") return { config: null, overrides: [] };
  const overrides = Object.keys(fileConfig).filter(
    (k) => k !== "configFile" && Object.prototype.hasOwnProperty.call(base, k),
  );
  return { config: { ...fileConfig, ...base }, overrides };
}

/**
 * 功能开关表（2026-11-21，A 方案）：把散在配置里的布尔开关收拢成一张表。
 * 语义**只能减不能加**：某功能必须先在配置里配好（如 `status: true`、`narrowTool: true`），
 * `features: { x: false }` 才能把它关掉；单独 `features: { x: true }` 不会凭空打开没配置的功能。
 * 未知键忽略，`features` 不是对象时当没写。
 */
export function resolveFeatures(config = {}) {
  const c = config && typeof config === "object" ? config : {};
  const raw = c.features && typeof c.features === "object" && !Array.isArray(c.features) ? c.features : {};
  const has = (v) =>
    typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : v === true || (!!v && typeof v === "object");
  const base = {
    bell: true, // 门铃注入默认开；features.bell=false 可关
    indexGate: c.enforce !== false, // 硬拦截默认开
    todoGate: has(c.todoFile),
    structGate: Array.isArray(c.structGates) && c.structGates.length > 0,
    replyCheck: Array.isArray(c.replyChecks) && c.replyChecks.length > 0,
    planGate: c.planGate === true,
    statusLine: c.status === true,
    maintHint: has(c.maintReport),
    signals: has(c.signalsFile),
    versionWarn: c.versionWarning === true,
    statusTool: c.statusTool === true,
    opsRun: c.narrowTool === true,
    opsWrite: c.writeTool === true,
    rawWriteGate: Array.isArray(c.denyRawWritePaths) && c.denyRawWritePaths.length > 0,
    bareCommandGate: Array.isArray(c.denyBareCommands) && c.denyBareCommands.length > 0,
  };
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (raw[key] === false) out[key] = false;
  }
  return out;
}

/**
 * 读外部配置文件并合并。
 * @param {object} yamlConfig profile 里写的 config
 * @param {(file: string) => any} readJson 读 JSON 的函数（生产用 rule.mjs 的 readJsonFile）
 * @returns {{file: string, config: object|null, overrides: string[], error: string}}
 */
export function readExternalConfig(yamlConfig, readJson) {
  const file = yamlConfig?.configFile;
  if (typeof file !== "string" || !file.trim()) {
    return { file: "", config: null, overrides: [], error: "" };
  }
  const target = file.trim();
  let raw;
  try {
    raw = readJson(target);
  } catch (err) {
    return { file: target, config: null, overrides: [], error: String(err?.message ?? err) };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { file: target, config: null, overrides: [], error: "config file is not a JSON object" };
  }
  const { config, overrides } = mergeExternalConfig(yamlConfig, raw);
  return { file: target, config, overrides, error: "" };
}
