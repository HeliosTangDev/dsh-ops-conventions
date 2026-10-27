# dsh-ops-conventions（操作约定门铃）

在 AI **动手前**把「你的操作约定清单」确定性地注入一次，并可选地硬拦截写操作，解决「约定记了，但干活时不提就不用」的问题。

> 插件本身**不含任何个人约定**：它只做「提醒 + 拦截 + 配置」。规则内容全部来自你自己的 `INDEX.md`（以及可选的补充文件）。

## 它做什么

- **注入门铃**：每个会话、每个约定版本注入一次，内容 = `read <你的 INDEX.md> 并执行清单` + 可选补充文本；约 1 行，不改 `VERSION` 不会重复刷屏。
- **版本变化再提醒**：改约定目录里的 `VERSION` 文件后，下一轮（任何轮次）会重新注入。
- **可选硬拦截**：本会话还没 `read` 过 `INDEX.md` 时，拒绝写类工具（`write`/`edit`/…，可加 `pwsh`/`bash`/`cmd` 等）；读过后本会话放行。
- **可选待办门**：配置 `todoFile` 后，还要求先跑一次 `todoCheckCmd` 校验器（防止报过时待办）。
- **可选维护报告摘要**：配置 `maintReport` 后，报告里有 Issues 就注入一条摘要。
- **可选结构门**：配置 `structGates` 后，写某个区域前必须先跑该区域的结构检查器。
- **注入日志**：每次注入/拦截都写日志，生效与否可核对。

## 安装

### 方式一：安装脚本（推荐）

```bash
git clone https://github.com/HeliosTangDev/dsh-ops-conventions.git
cd dsh-ops-conventions
node install.mjs                                  # 默认装到 ~/.dsh/profiles/desktop
node install.mjs /path/to/profile                 # 指定 profile
node install.mjs /path/to/profile --uninstall     # 卸载
```

### 方式二：自己加依赖

在 profile 的 `package.json` 里加：

```json
"dsh-ops-conventions": "https://github.com/HeliosTangDev/dsh-ops-conventions/releases/latest/download/dsh-ops-conventions.tgz"
```

然后在该 profile 目录执行 `pnpm install`，重启 DSH。

### 方式三：市场

在 dsh-m 市场里搜索 `dsh-ops-conventions` 安装。

## 配置

在 profile 的 `cordis.patch.yml` 里追加（所有字段都可选，不配也能用）：

```yaml
- id: dsh-ops-conventions
  name: "dsh-ops-conventions"
  config:
    skillsDir: "D:\\my-conventions"          # 你的约定目录（里面放 INDEX.md + VERSION）
    # bellExtra: "额外的提醒文本"              # 直接追加一行文本
    # bellExtraFile: "D:\\my-conventions\\BELL.txt"  # 或指向文件（每次注入现读，改文件不用重启）
    # enforce: false                          # 只提醒、不拦截
    # blockedTools: ["write","edit","multi_edit","apply_patch","notebook_edit","pwsh","bash"]
    # todoFile: "D:\\my-work\\tasks\\OPEN.md"
    # todoCheckCmd: "powershell -NoProfile -ExecutionPolicy Bypass -File D:\\tools\\todo_check.ps1"
    # maintReport: "D:\\my-work\\tasks\\MAINT-LATEST.md"
    # structGates:
    #   - id: docs
    #     pathRe: "docs[/\\\\]"               # 命中这些路径时……
    #     checkRe: "docs_check\\.py"          # 这条命令就是该门检查器
    #     checker: "python D:\\tools\\docs_check.py"
    # 可选：现场状态行（宿主版本 / 维护报告 / 待办条数），默认关闭
    # status: true
    # statusTodoJson: "D:\\my-work\\todo.json"       # 读条目数用
    # hostVersionFile: "D:\\tools\\host_version.txt" # 宿主版本缓存（由你自己的脚本写）
    # asarCandidates: ["C:/apps/DSH/resources/app.asar"]
    # 可选：版本引用核对（上一条回复写了非现场版本时警告），默认关闭
    # versionWarning: true
    # versionWarnFile: "D:\\my-work\\VERSION-WARN.md"
    # installedProfileDirs: ["C:/Users/me/.dsh/profiles/desktop"]
  disabled: false
```

### 最小约定目录

```
D:\my-conventions\
  INDEX.md     # 你的清单入口（写清“做什么事读哪份清单”）
  VERSION      # 一个数字；改它 = 让门铃重新注入
```

`INDEX.md` 示例：

```md
# 操作约定索引

| 要做的事 | 读这份 |
|---|---|
| 写/改脚本 | ops-scripts/SKILL.md |
| 改完验证 | ops-check/SKILL.md |
```

## 不配置会怎样

- 使用插件包自带的 `skills/` **示例清单**（会提示你去换成自己的目录）；
- 只拦截 `write/edit/multi_edit/apply_patch/notebook_edit`；
- 其余可选功能（待办门/维护摘要/结构门）全部关闭。

## 验证生效

```powershell
Get-Content "$env:USERPROFILE\.dsh\ops-conventions\ops-conventions.log" -Tail 5
```

应看到 `plugin loaded  skillsDir=...`、`inject vN chars=...`；被拦截时应看到 `guard deny ...`。

## 卸载

```bash
node install.mjs --uninstall
```

或从 profile `package.json` 删除依赖、`node_modules/dsh-ops-conventions`，并删掉 `cordis.patch.yml` 里对应条目，然后重启。

## 边界

- 这是「提醒执行器」，不是安全边界：它可以挡住误操作，但不能保证模型一定执行清单。
- 注入/拦截都在本机，不联网、不收集数据。
- 适配 DSH 0.2.x（Node 22 / 24），MIT 许可。
