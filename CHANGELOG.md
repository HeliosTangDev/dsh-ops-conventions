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
- 根因：projectionPath(sid) 用 `session-{sid}.json` 拼路径，而 DSH 传进来的 sid **本身已带 session- 前缀** → 拼成 session-session-*.json，找不到文件，eadCompactionStats 永远返回 null。
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
- 现在改成**白名单**：只有**明确只读**的工具名（ead/search/find/glob/grep/list/ls/status/get/query/inspect/fetch/health/version/...）才放行；**其余一律要求先读约定**，包括：
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
- 新增 isShellWrite()：shell 工具的命令串里出现写类动词（Set-Content/Copy-Item/Remove-Item/m/mv/> 重定向/git push|tag|commit/ov write|rm|skills add/
pm i|publish/elease.mjs/schtasks/eg add）即视为写操作，纳入同一守卫；只读命令（Get-ChildItem/git status/
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




