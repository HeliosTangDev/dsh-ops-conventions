# Changelog

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
