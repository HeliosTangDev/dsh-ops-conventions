# Changelog

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




