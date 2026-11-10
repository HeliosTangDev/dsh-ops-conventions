## 0.9.6（2026-11-08）

### 总开关 enabled

- 配置 `enabled: false` 时 `apply()` 记一行 `plugin disabled by config.enabled=false (no hooks registered)` 后直接返回：插件保持加载，但零注入、零拦截、零扫描、不注册 `ops_status`。
- 默认 `true`（不配等于开）。改开关需重启（配置在启动时读）。
- 测试先行：先写 `enabled:false` 应注册 0 个钩子（RED：实际 4 个），再实现（GREEN）。

### 常驻检查刷新修复（2026-11-10）

- 背景：会话内自动刷新只记 `checks refresh scheduled`，`last-fast.json` 永不更新；250ms 密轮询 45 秒未见子进程（日志 14:38Z）。
- 修：`spawn` 改用绝对路径 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（宿主 PATH 可能不含该目录，原先异步 ENOENT 无人接管），并补 `error` / `exit` 监听，失败原因写进插件日志。
- 验证：`node --check` 通过，rule 38/38、guard 8/8；装入 desktop/web 后待重载确认日志出现 `checks refresh exit`。

## 0.9.5（2026-11-08）

### 捕获选择逻辑按 TDD 重做（先红后绿）

- 新增 `isSummaryLike()` 与 `betterAssistantText()`：摘要不占位、非摘要取更长者；测试先写（RED：模块无导出）再实现（GREEN）。
- index.mjs 捕获逻辑改用这两个纯函数，替代内联判断，便于回归测试。
- 流程补硬：门铃 v91 与 `ops-check` 新增「测试先行与先方案」硬性节；`checks.json` 新增 `plugin-tests`（rule + guard 单测必须全绿）作为机械兜底。

## 0.9.4（2026-11-08）

### 只取回复正文，排除 Thinking

- 0.9.3 日志显示被捕获的是 `head="Key observations:"` / `"Now we see the real bug clearly:"`——那是模型的思考文本，被当成“上一条回复”。
- 新增 `pickAssistantText()`：只拼 `type` 为空或 `text` 的内容块，排除 `reasoning/thinking/tool-*`；捕获与扫描都改用它。
- 单测覆盖：reasoning+text 混合时只取 text；纯 reasoning 返回空。

## 0.9.3（2026-11-08）

### 修复“把真实回复当摘要跳过”

- 0.9.2 的跳过条件包含“正文前 300 字符里出现 `User pushes back` 等”，结果一条正文引用日志原文的真实回复（3304 字符）被当摘要跳过，缓存里只剩工具调用旁白（159 字符），因此扫描永远命中不到。
- 现在只跳过“开头就是 `User / The user / Assistant / Summary / Conversation summary`”的整段摘要，并记录被跳过文本的 `head=`。

## 0.9.2（2026-11-08）

### 回复时间新鲜度检查 + 修复“扫错文本”

- 新增 `replyTimeCheck`：取上一条回复里**最后一个** `@HH:mm`，与本轮时间比较；超过 `maxAgeMinutes`（默认 10）或落在未来（默认 5 分钟）即判违规。
- 修复 0.9.0/0.9.1 的“扫错文本”：日志抓到被扫描文本以 `User pushes back:` 等摘要开头（会话压缩摘要冒充了上一条回复），导致违规永不命中。捕获时跳过摘要类文本并记录 `head=`，便于核对。
- 边界：只校验**最后一处**时间戳；引用历史时间（旧日志）可能误报，可把阈值调大或改成只查“现场状态”段。

## 0.9.1（2026-11-08）

### 回复扫描加诊断日志（定位“违规未触发”）

- 每次扫描都记一行 `reply-scan len=… hits=… ids=… head="前60字符"`，用于确认“被扫描的到底是哪条回复、命中了哪条规则”。
- 背景：0.9.0 上线后，一条故意不带采样时间的回复没有产生 `reply-check`。可能是取错回复文本（缓存/会话 id），也可能是规则未生效；先加证据再改逻辑，不凭猜测改。

## 0.9.0（2026-11-08）

### replyChecks 支持 require 与门禁升级

- 规则新增可选 `require`：`pattern` 命中后，若 `require` 不命中才记为违规。例：说到 `bell=vN` 但全文没有 `@HH:mm` → 违规。
- 新增可选 `replyCheckBlock: true`：上一轮回复违规 → **本轮拒绝写类工具**，直到下一轮扫描确认合规；同一违规连续两轮自动解除（防误报死锁），只读与校验器命令始终放行。
- 边界不变：只能在下一轮发现并惩罚，不能阻止违规回复发出。

## 未发布：ops_status.todo 用判定值；信号提示去个人化；本会话提示（2026-11-08）

- `ops_status.todo` 改为 `{items, declared:{ask,machine}, verdict:{open,done,ask,wait,err}}`：`ask` 不再按条目类型计数（曾出现 `ask:1` 与 `done=1` 并存的矛盾）。
- 信号提示文字去掉个人路径（原写 `_tools\misc\IMPROVEMENTS.md`），改为通用句子；需要自定义时用新配置 `signalsHint`。
- 保留 `signalsFile`/`statusRepoDir` 等均为可选配置，默认关闭，不写死任何机器路径。
## 未发布：ops_status 补 git/标记；拒绝原因具体化；本会话信号提示（2026-11-07）

- ops_status 新增 epo（读 .git refs：head/originMain/pushed）与 maintMarker，一次调用拿全现场。
- 守卫拒绝的 msg 从 `guard` 细化为 `gate=struct:<id>` / `gate=plan` / `gate=todo`。
- 信号提示新增「本会话」路径：本会话累计 ≥3 条且距上次提示 >20 分钟时提示一次（其他会话仍 ≥2 条、每会话一次）。
- 测试 31 pass / 0 fail（含 statusSummary repo 字段用例）。
## 未发布：事件信号（工具失败 / 守卫拒绝）→ 可观测 + 一次性提示（2026-11-07）

- 新增 `signalsFile` 配置：工具调用失败（`tools/result` 的 `isError`）与守卫拒绝各写一行
  `ISO  kind=fail|deny  sid=…  tool=…  msg=…`；文件超过 256 KB 自动裁到最近 200 行。
- 新增纯函数 `signalSummary(text, excludeSid, opts)` / `signalHintText(summary)`（`rule.mjs`，带单测）。
- 每会话一次：最近 24h 内**其他会话**累计 ≥2 条信号时，注入一行「记入 IMPROVEMENTS.md 或大的直接改」。
- 三个 profile 已加 `signalsFile: D:\software\ToolsDev\tasks\SIGNALS.log`；备份 `_backups\profile-signals-20261107`。
- 测试：`node --test --test-isolation=none` 30 pass / 0 fail。

## 0.8.2（2026-11-01）

### ops_status 注册修复

- 注册失败根因：`defineTool` 要求 `output: { schema, render }`；之前只给 `parameters` + `execute`，宿主在注册时读 `output.render` 抛 `Cannot read properties of undefined (reading 'render')`（日志证据：`status tool skipped: Cannot read properties of undefined (reading 'render')`）。
- 修复：补 `output.schema` 与 `output.render`（JSON 文本渲染）。

## 0.8.1（2026-11-01）

### 结构门支持按工具类型限定（tools）

- `structGates` 每项新增可选 `tools: ["pwsh","cmd",...]`：只有这些工具的调用才判定该门。
- 动机：环境门（`reg add`/`Set-Service` 等关键词）对 `edit`/`write` 也生效，导致**编辑提到这些命令的文档也被拦**；限定为 shell 后，文档编辑不再误拦，真实命令仍拦截。
- `structGatesFor(args, gates, toolName)` 新增第三个参数（不传则维持旧行为，向后兼容）；测试覆盖三种情形（shell 命中、edit 不命中、无 toolName 时命中）。

## 0.8.0（2026-11-01）

### 新增回复合规扫描 replyChecks（输出型约定的事后硬化）

- 新增配置 `replyChecks: [{id, pattern, message}]`：在**下一轮** pre-step 检查上一条助手回复，命中注入一条 `[回复核对]` 警告并写入 `replyWarnFile`（按 session + 命中集合去重，避免刷屏）。
- 与 `versionWarning` 共用“上一轮回复”的取值链路（messages → prevReplyBySid → 缓存），规则本身完全由个人配置提供，插件不含任何具体规则。
- 边界：这是事后扫描，只能发现并提醒，不能阻止已发出的回复；不用于替代清单。
- 测试：`checkReply` 单测覆盖命中、无命中、非法正则、两段式检查与误报防护（全过）。

## 0.7.0（2026-11-01）

### 新增只读状态工具 ops_status

- `config.statusTool: true` 时注册 agent 工具 `ops_status`：一次返回门铃 VERSION、插件包版本、待办条数（items/ask/open）、维护报告 Issues 数、记忆库 `.md` 数量与最近更新时间、最近注入/拦截日志摘要。
- 全部只读、路径来自配置（`statusTodoJson` / `todoLastFile` / `maintReport` / `memoryDir` / `logFile`）；未配置的段直接省略。
- 工具用动态 `import("@deepseek-ai/dsh-tools")` 注册：宿主没提供该模块时只记日志，不影响门铃与守卫。
- 默认关闭；README 补配置说明，`statusSummary()` 有单测（含空配置不抛错）。

## 0.6.2（2026-10-29）

### 个人路径配置化、校验器管道白名单

- **去个人化收尾（2026-10-28）**：`status` 现场状态行与 `versionWarning` 版本核对改为配置驱动、默认关闭；路径全部由 `statusTodoJson` / `hostVersionFile` / `asarCandidates` / `versionWarnFile` / `installedProfileDirs` 传入，运行期文件里已无个人绝对路径；删除两处没人用的工具区专用函数。
- **校验器命令允许显示类管道**：`检查器 | Select-Object -Last 3` 曾因“管道一律拒绝”导致跑检查器被结构门自锁；现允许管道右侧为显示类 cmdlet（Select-Object/Format-*/Out-*/Sort/Measure/ConvertTo-Json/findstr/more），`| iex`、`| Remove-Item` 仍拒绝。
- **门铃绑定按渲染文本**：只改代码注释/重构不再强制升 VERSION；改真正注入文本才要求同批升版。

### 版本核对：改用上一轮完整回复 + 警告文件轮转（2026-10-28）


- **会话 id 不一致的接线修复（同日追加）**：观测到一次 `prevTurn=3414`（说明接线本身可行），但下一次 `turn/start` 又变 0——`session/event` 的 sid 与 `agent/pre-step` 的 sid 可能不同。现改为：`turn/start` 同时搬「事件 sid」与「实际累积的 sid」，并维护 `prevReplyGlobal` 兜底；scan 在 per-sid 为空时用全局值；capture/scan/turn 日志都带 `sid=`，下次能直接看出是否同 id。测试 25 pass，三端 index.mjs 哈希一致（`426864563948`）。

- **修复比对源**：`lastAsstBySid` 在 `turn/start` 被清空，因此 scan 比的其实是当前轮的半截回复（日志长期 `asst=0`）。新增 `prevReplyBySid`：`turn/start` 时先把上一轮累积的最长回复挪过去再清空；scan 顺序改为「messages 里的回复 → prevReplyBySid → 当前累积」，日志增加 `prevTurn=`。
- **VERSION-WARN.md 有界**：新增 `appendRotated()`（保留最近 300 行），不再无限增长。
- 测试 `node --test --test-isolation=none`：25 pass / 0 fail；`sync.cmd` + `update-all.mjs` 已装三端（index.mjs 哈希一致）。

### install.mjs：默认钉本地不可变 tgz（原 0.6.1 草稿）

- **不再默认写成 GitHub latest 固定名 URL**：该地址背后的字节每次发版都会变，而 pnpm 锁记的是当时看到的 integrity —— 一发新版就 `ERR_PNPM_TARBALL_INTEGRITY`（或按旧锁装回旧版本，2026-10-27 实测踩到）。现在默认把本机 `_cache\<name>-<version>.tgz`（或仓库根同名文件）复制到 `<profile>\_local\`，依赖写成 `file:./_local/<name>-<version>.tgz`，字节永久不变。
- 想保留旧行为用 `--pin latest`；`--pin <版本|URL|file:...>` 与 `--no-pin` 不变；本机没有对应 tgz 时退回 latest 并打警告。
- 2026-10-27 三端（desktop/web/test）已按此重装，`pnpm install --frozen-lockfile` 三端均通过。
### v0.6.0（2026-10-26）：回归通用插件（不含个人约定）

- **门铃正文通用化**：只保留「read INDEX.md + 每会话每版本一次 + 收尾按清单自检」，删掉所有作者个人规则（待办校验器、四件套、_tasks、命令式措辞、旧快照等）。
- **个人规则外置**：新增 `bellExtra` / `bellExtraFile` 配置——用户把自己的补充规则写在文件里（每次注入现读，改文件不用重启）。
- **可选功能全部改为配置驱动，默认关闭**：`todoFile`/`todoCheckCmd`（待办门）、`maintReport`（维护摘要）、`structGates`（结构门）。
- **修复结构门被早退跳过的 bug**：之前「已读 INDEX 且无待办」会提前 return，导致结构门永远不生效；现在结构门先判。
- **可选待办门**：只认真的跑过校验器；校验器命令白名单仅放行单条命令（禁 `; && || |` 与文件重定向）。
- **`blockedTools` 真正生效**：此前只写进日志，现在参与判定；建议追加 `pwsh`/`bash`/`cmd` 等。
- 测试重写为通用版：`rule` 16 项、`guard` 6 项全过；README 重写为「怎么用到你自己的约定」。


### v64（2026-10-25 20:17）：报状态必须在本轮内重跑现场命令

- 正文改成：「旧快照/记忆卡只作线索，**报状态必须在本轮内跑现场命令**：更早的数字一律作废，写回复前重跑；**同轮内若发生写/推送/改文件也要重跑**。每条状态附命令与采样时间（例：`git status -sb @20:05`），没带=没查」。
- 为什么 v63 不够（记为归因错误）：v63 只要求"写出命令+时间"，没规定**必须本轮重跑、跨轮作废**，后果是仍可贴一条旧命令的时间戳冒充刚查。真正根因是**执行没做**，不是原句有歧义——原句「报状态先跑现场命令」本来就没歧义，是把"没执行"误判成"规则不清"。
- 正文改动需重启宿主才加载（`rule.mjs` 启动时读一次，`VERSION` 每轮读）；重启前会看到"版本号 v64 + 旧正文"，属预期。
- 同批：`ops-skills\VERSION` 62 → 63 → **64**（v63 未真正生效过，直接覆盖为 v64）；`bell_state.json` 绑定 64（sha256 `10D88F3B…`）；`conventions_registry.json` 12 条 22 处，`conventions_map exit=0`。
- 测试：`node --test --test-isolation=none` **34 pass / 0 fail**。

### 规则与守卫补丁 v56–v61（2026-10-24 ~ 10-25，补记）

- **v56**：正文「状态当场取」→「旧快照/记忆卡只作线索，报状态先跑现场命令」（提交 `8a1a3bd`）。
- **v57**：正文「改配置先备份」→「备份 profile 四件套并备回滚，只改最小项、改后验证能启动」（`177889a`）。
- **v58**：待办门禁改为**必须运行 `todo_check`**，读 `OPEN.md` 不再算数（`eb0323a`）。
- **v59**：汇报格式改为命令式——要本人做的事写「命令 + 全路径参数」，不写「建议」（`7080bc5`）。
- **v60**：守卫修缺陷——校验器命令进白名单、`blockedTools` 真正生效、shell 写入加固（`573c866`）。这是对 v58 引入死锁（要求跑校验器，而 `pwsh` 在拦截名单里）的机制补救。
- **v61**：新增「遇到问题先归因：笔误改掉即可；逻辑错误/考虑不周必须写教训并改机制补救，不能只说下次注意」（`0b500ad`）。
- 已知遗留：`ops-skills\VERSION` 被单独改成 62，正文与 `bell_state.json` 绑定仍是 61，版本号与内容错位；本段补记后应重跑 `sync.cmd` 收口。

### install.mjs：把「钉依赖」收进安装脚本，装插件不再需要手写 PowerShell

- 事故背景（2026-10-24）：桌面端 2:11:54–2:20:27 连崩 7 次，根因是 profile 的 `package.json` 被 `ConvertTo-Json | Set-Content -Encoding utf8` 写成带 UTF-8 BOM；宿主 `readProfileManifest` 是 `readFileSync(utf8)` + 直接 `JSON.parse`，遇 BOM 抛 `DesktopHostFatalError` 后静默退出，现象「双击没反应」。那一步本身属于安装流程（装完门铃把依赖钉到 GitHub tarball），却落到了手写 PowerShell 上——所以把这一步收进脚本。
- 默认行为改为钉 `https://github.com/HeliosTangDev/dsh-ops-conventions/releases/latest/download/dsh-ops-conventions.tgz`；新增 `--pin <版本|URL|file:路径>`（版本号自动展开成版本名资产 URL）、`--pin=` 等号写法、`--no-pin`（保留旧行为：裸版本号）与 `-h/--help`。
- 写盘防炸：写前备份 `package.json.bak-<时间>`；写后读回自检「无 BOM + JSON 可解析 + `dependencies` 与 `bundles` 均已生效」，失败自动回滚并以退出码 1 结束。
- 实测（临时 profile，不碰真实配置）：默认 712 B、`--pin 0.5.10` 720 B、`file:` 674 B、`--no-pin` 617 B —— 全部无 BOM、无 CRLF、2 空格缩进；连跑两次文件哈希一致（幂等）；`dump-config` 退出码 0、1276 行、含 `# == dsh-ops-conventions`；`--uninstall` 后依赖、bundles、`node_modules` 目录均清干净；`--pin` 缺值退出码 1。
- README 安装段同步：用法表格、默认钉 URL 的理由，以及「手改清单别用 PowerShell `Set-Content -Encoding utf8`」的告警。

## 0.5.10 — 2026-10-22

### 改动

- 门铃：加「提到约定（含复述旧约定）先判层再当场落位：跨类的进门铃、某类的进清单、参考的进偏好与实体；只写记忆=没写成，落位后读回」（VERSION 43→44，688 字符）。
- 修复结构门死锁：`tools/pre-execute` 先放行「结构检查器调用」本身（`structCheckIds` 命中即 `next()`）；否则待办镜像未读时，连 `python tools_check.py` 都会被结构门拒掉，永远无法放行。

## 0.5.9 — 2026-10-22

### 结构门改成通用机制（不再只认工具区）

- 教训：汤海峰提的是**通用要求**（"有结构、有整理"适用于所有区域），我却先做了一个只认工具区的专用门 —— 又造特例。规则应当一次做成通用机制。
- 现在：STRUCT_GATES 配置表，每条 = {id, pathRe（区域路径）, checkRe（检查器文件名）, checker（给的命令）}。
  - 	ools：software/(toolsuse|toolsdev) → 	ools_check.py
  - 
otes：log/article/course → 新增的 
otes_check.py（只读检查：BOM/CRLF/全角空格/内联样式/文件命名）
- 加新区域**只加一条配置**，不动运行逻辑。
- 守卫：写某区域时若本会话没跑过该区域检查器 → deny 并给出该检查器的命令；跑一次即放行（避免整理时被自己锁死）。
- 单测：19 → 20 条，含"两个区域同时命中"与"每个门都必须有可执行命令"。
## 0.5.8 — 2026-10-22

### 新增：结构门（第三道硬拦截）

- 背景：约定里写着"工具区不许平铺 / 归档要有 README / events 满 200 跑 GC / _backups 只放日期目录"，但**只有文字没有检查**，结果平铺攒到 21 个文件、两个归档目录缺 README、events 涨到 235 才被发现（2026-10-22 审计）。
- 现在：**写工具区（路径含 software/ToolsUse 或 software/ToolsDev）之前，本会话必须跑过一次** python D:\software\ToolsUse\_tools\misc\tools_check.py，否则守卫拒绝并给出该命令。
- 只对工具区的写操作生效：写笔记、写博客不受影响；跑一次（无论结果）即放行，避免"整理时被自己拦住"的死锁。
- 新函数：isToolsCheck()（识别检查器调用）、	ouchesToolArea()（识别工具区路径）；会话标记 STRUCT_CHECKED。
- 单测新增 1 条（4 正例 + 4 反例）。
## 0.5.7 — 2026-10-21

### 修复：压缩提示从未触发（路径拼错）

- 现象：会话投影缓存里明明有 compaction 事件（本机实测某会话 3 次 / 248 条事件），但插件日志里 compaction baseline / compaction hint **一条都没有**。
- 根因：projectionPath(sid) 用 `session-{sid}.json` 拼路径，而 DSH 传进来的 sid **本身已带 session- 前缀** → 拼成 session-session-*.json，找不到文件，
eadCompactionStats 永远返回 null。
- 修复：新增 
ormalizeSessionId()（剥前缀）与 projectionFileCandidates()（返回候选文件名），projectionPath 先按候选名精确查、再按裸 uuid 前缀扫目录；带/不带前缀都能命中。
- 单测：新增 1 条（带 session-/session_/裸 uuid 三种输入归一 + 候选名 + 空输入）。
## 0.5.6 — 2026-10-21

### 新增：待办校验器也算「已校验」（B 方案，硬拦而非文案）

- 之前硬拦只认两个动作：read `INDEX.md`、read 待办镜像 `tasks\OPEN.md`。而镜像本身是**快照**，会过期——实例：21:12 写"1 个提交未推"，实则在 21:30 前已推，仍被当成待办报了出来。
- 现在新增第三个可观测动作：**在 shell 里运行待办校验器**（`todo_check.ps1` / `todo.cmd`，新函数 `isTodoCheck`）。本会话**读镜像**或**跑过校验器**任一成立即放行；日志分别记 `guard todo-read` / `guard todo-check`。
- 拒绝理由与门铃文案同步改成"read 镜像 **或** 运行 `todo_check.ps1`（二选一；报待办前必须先跑校验，镜像只是快照）"。

### 为什么不是"往门铃文案加一句"

门铃有两层：注入（`reminderText`）与硬拦（`tools/pre-execute` 的 guard）。**只在文案里加句子仍然不是硬拦**——guard 没有对应判定就拦不住。要做成硬拦，必须给 guard 一个可观测动作；待办校验器正好是它。

## 0.5.4 — 2026-10-21

### 改变策略：黑名单 → 白名单（未知即拦）

- 之前是**黑名单**：只拦"已知的写工具"，所以每出现一种新写法（shell、MCP、子代理、无会话…）就漏一次，需要逐个补口——这是"守正门、放后门"。
- 现在改成**白名单**：只有**明确只读**的工具名（
ead/search/find/glob/grep/list/ls/status/get/query/inspect/fetch/health/version/...）才放行；**其余一律要求先读约定**，包括：
  - 内置写工具与 shell 写命令（同前）；
  - MCP 未知工具（如 mcp__newsrv__upload）；
  - dshm_*、schedule_*、gent_teams_* 等会改状态的工具；
  - **将来插件/宿主新增的任何工具**——不需要再改代码，默认就被纳入。
- 新增 isReadOnlyTool() / 
eedsGuard()；单测用**工具矩阵**覆盖：18 个应放行 + 17 个应拦 + 3 个 shell 命令。
## 0.5.3 — 2026-10-21

### 修复

- **无会话上下文不再放行**：子代理 / 其它 agent 上下文没有 session，原先 if (!sess) return next() 直接绕过守卫。现在改用**全局「已读」标记**兜底（任一上下文读过 INDEX.md/OPEN.md 即置位），仍按写类动作拦截；日志写 guard no-session using-global idx=…。
## 0.5.2 — 2026-10-21

### 修复（把守卫的绕过路径全部堵掉）

- **动作优先于文本**：原先只有"本轮用户消息像要动手"（shouldInject）才拦 → 用户说「继续 / 那算了」时写操作**完全不拦**。现在改为：**只要是写类调用就判定**，与用户措辞无关。
- **写类工具按名字识别**：原先只认固定名单（write/edit/multi_edit/apply_patch/notebook_edit）→ **MCP 写工具全部绕过**（mcp__openviking__write/edit/add_resource/add_skill、dshm_install/upgrade/toggle）。现在按名字模式匹配，内置与 MCP 一视同仁。
- **shell 写操作**（0.5.1 已做）：pwsh/bash 命令串含写动词/重定向即拦。
- **shell 读也算已读**：用 Get-Content/cat/	ype/Select-String 读 INDEX.md、OPEN.md 也置"已读"，减少"读了却被拦"的误判。
- **放行原因可观测**：
o-session / enforce-off / 
o-index 三种放行都会写日志（guard skip reason=...），审计能看出守卫是否真在跑。
- 单测 15/15 通过（新增：写类工具名 12 正例 + 7 反例；shell 读识别 5 例）。
## 0.5.1 — 2026-10-21

### 修复

- **硬拦截补口**：原先只拦 write/edit/multi_edit/apply_patch/notebook_edit，**shell 类工具（pwsh/ash）不在名单**，导致"用命令行写文件/跑命令"可以整条绕过守卫（2026-10-21 实测：多轮用 pwsh 写文件未被拦）。
- 新增 isShellWrite()：shell 工具的命令串里出现写类动词（Set-Content/Copy-Item/Remove-Item/
m/mv/> 重定向/git push|tag|commit/ov write|rm|skills add/
pm i|publish/
elease.mjs/schtasks/
eg add）即视为写操作，纳入同一守卫；只读命令（Get-ChildItem/git status/
ode --test）不拦。
- 单测 13/13 通过（新增 8 正例 + 6 反例）。
# Changelog

## 0.5.5 — 2026-10-21

### 修复（守卫 fail-open，v0.5.4 的 Release CI 也卡在这里）

- 无 session 上下文时 `sess.id` 与 `sess[READ_TODO]` 会抛 TypeError，被 catch 吞掉后走 `next()` 放行——0.5.3 声称「无 session 不再放行」实际没生效。改为 `sess?.id` / `sess?.[READ_TODO]`。
- 同步过时单测：0.5.2 起「写类调用即判定、与措辞无关」，测试里「闲聊不拦」与「无 session 放行」两条断言改为 deny。
- 本地验证：rule 16/16、guard 3/3、compaction OK。

## 0.5.0 — 2026-10-20

### 新增

- **待办镜像硬拦**：约定目录上一级的 `tasks\OPEN.md`（如 `D:\software\ToolsDev\tasks\OPEN.md`）存在时，写类工具除了要求 `read INDEX.md`，还要求 `read` 该镜像（`isTodoRead`；日志 `guard deny … needTodo=true` / `guard todo-read`）。
  理由：门铃原来只硬拦「read INDEX」，而「开场先扫 tasks 与 sessions」只是注入文案、无任何检测 —— 2026-10-20 就漏在这里（换会话后只写当前任务待办）。
- 门铃文案与硬拦截的拒绝理由都会指明镜像路径；镜像不存在时自动退化为只拦 INDEX，避免在没放该文件的机器上误拦。

## 0.4.2 — 2026-10-20

### 修复

- 去掉 `rule.mjs` 开头的 UTF-8 BOM：v0.4.1 的 Release CI 在「Reject BOM in release files」步骤失败（`run 39415392296`），因此 0.4.1 只有 tag、没有 Release。全仓库复查后仅此一处 BOM，其余文件干净。

## 0.4.1 — 2026-10-20

> 0.4.0 的提交已进 main 但从未打 tag / 出 Release（`--push-only` 只推了 main），两批改动合并到本版一次发布。

### 新增

- **会话压缩提示**（机械触发，不靠模型自己感觉"会话长了"）：读 DSH 会话投影缓存 `~/.dsh/storages/session_projcache/sessions/session-<id>.json` 的 `contextTimeline.val.events`，数 `kind === "compaction"` 的条目；次数增加时注入一句话，提示「若主线已收尾可考虑换会话」。只读数据、按 `mtime+size` 缓存；从未压缩过则一个字不注入。新增 `compactionStats` / `compactionHintText` 与 `test/compaction.test.mjs`（真实会话样本：2 次压缩）。

### 改动

- 门铃常驻约定把「收尾或进入等待时提一句关会话」改为「换不换会话由本人决定，只有收到『会话压缩提示』时按提示判一次」。
- 首次看到某个会话时只记基线、不提示：旧会话里「以前压缩过」的次数不会被当成刚发生；之后 count 增加才注入。
- 门铃交互规则加入「结尾分两段：待办（要你做/在等）在前、自检（只写已发生的验证）在后，不混写」。

## 0.3.2 — 2026-10-20

### 改动

- 门铃扩充：开场扫描 `tasks`/`sessions` 与工作区 `_tasks` 残留；失败报原文不吞；删除/移动/覆盖前确认路径、先复制再删旧；不问「要不要」；结论带证据、查不到不瞎猜；时间当场取；工作区外写先申请一次放宽权限；交互三件（结论+入口一次列全、直白中文、拍板才给 A/B/C）；harness 操作控制（不手改运行时状态、改配置先备份、凭证只从 `_secrets` 读、不擅自升级/重启）；一会话一主线。

## 0.3.1 — 2026-10-20

### 改动

- 门铃文案加入 6 行跨类常驻约定（不说「待会儿做」、先给结论与入口、备份/回滚、收益＜成本就停、只改工具区、关会话提醒）与收尾三件（自检/记忆归并/`_tasks` 清空），避免依赖会被 OpenViking 抽取模板整份重写、主动删掉「常驻约定」段的 `profile.md`。

## 0.3.0（未发布）

### 新增

- **注入时机调整**：不再等操作轮；`VERSION` 变化后的**下一轮**就注入（闲聊轮也算），同一会话同版本仍只注入一次；新会话首轮也会注入一次。
- **硬拦截（enforce）**：操作类轮次里，本会话还没 `read` 过 `INDEX.md` 时，`tools/pre-execute` 直接拒绝 `write` / `edit` / `apply_patch` 等写类工具，拒绝理由带索引绝对路径；`read` 到 `INDEX.md` 后本会话放行。fail-open：钩子自身异常时放行并记日志；`skillsDir` 里没有 `INDEX.md` 时不拦。
- 配置项：`enforce`（默认 `true`）、`blockedTools`（默认 write/edit/multi_edit/apply_patch/notebook_edit，可自行加 `bash`/`pwsh` 连 shell 一起拦）。
- 日志：每次拒绝记 `guard deny`，每次标记已读记 `guard index-read`，加载时记 `guard loaded enforce=...  blocked=...`。
- 观察：用 `tools/result` 判定「成功的 INDEX 读取」才记已读，读失败不误放行。

## 0.2.2 — 2026-10-19

### 修复

- 发布包 package.json 曾被写到带 UTF-8 BOM，DSH 解析报 Unexpected token，安装被回滚且 node_modules 未重装，连带丢失 dsh-context。0.2.2 的 tgz 已确认无 BOM。
- release.mjs 增加发版前 BOM 拦截：package.json / cordis.patch.yml / index.mjs / rule.mjs / install.mjs 任一文件带 BOM 即中止发版（本地手工 pack 不会走 CI 的检查，所以源头也拦一道）。

## 0.2.1 — 2026-10-18

### 修复

- peerDependencies 里 @deepseek-ai/dsh-llm 的范围改为带**显式预发布分支**（>=0.1.0-rc.6 <0.2.0-0 || >=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-rc.1 <0.2.2-0 || >=0.2.2-rc.1 <0.3.0-0）。原声明看似很宽，但按 node-semver 规则**匹配不到 0.2.1-rc.2 这类预发布宿主**，会让用户遇到 ERESOLVE。已用 semver 机器验证：0.1.0-rc.6 / 0.2.0-rc.2 / 0.2.1-rc.2 通过，0.3.x 被排除。
### 修复（CI）
- CI 的测试步骤原先用 `node --test test/`（传目录）在 GitHub 的 Node 22/24 环境下失败（未取到日志原文，仅知该步失败）；改为直接执行测试文件，
pm test 也改为官方自动发现的 `node --test`。

## 0.2.0 — 2026-10-18

面向第三方使用的第一版。

### 新增

- **包内自带 `skills/`**：6 类示例清单（脚本、笔记、文件、自检、长任务、DSH），装上零配置即可用。
- **跨平台安装脚本 `install.mjs`**：零依赖，自动登记 `dependencies` 与 `dsh.profile.bundles`，支持 `--uninstall`；兼容带 BOM 的 `package.json`。
- **路径自适应**：配置 → 环境变量 → 包内 `skills/` → OpenViking 实际存储 → `~/.dsh/ops-conventions/skills`，逐个检查目录里是否真有 `INDEX.md`。
- **注入日志**：记录选中的约定目录、`INDEX.md` 是否存在、注入的版本与会话，便于核对是否生效。
- **文档**：README 重写（两种安装方式、配置、目录结构、FAQ），说明「市场搜不到」「bundle 声明」「skill unknown」等常见疑问。

### 变更

- 注入措辞改为强制性表述（"跳过=未完成"），并补充"`skill` 工具报 unknown 时直接读文件"的兜底说明。
- 注入文本约 70 token；同一会话同一版本只注入一次。

### 修复

- 发行文件统一去掉 BOM（BOM 会破坏 `#!` 与 YAML frontmatter）。

## 0.1.0 — 2026-10-18

- 首个可用版本：按关键词判断"像不像要动手"，命中则注入极短提醒；同一会话同一版本只注入一次，版本变化自动再注入。




