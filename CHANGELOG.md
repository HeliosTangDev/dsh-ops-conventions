# Changelog

## 0.3.1（未发布）

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




