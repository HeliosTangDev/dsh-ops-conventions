# 操作约定注入（dsh-ops-conventions）

把「操作约定」在**动手前**确定性注入上下文，解决「约定记了但干活时不提就不用」的问题。

## 它做什么

- **版本变化后下一轮就注入，不再等下一个操作轮**：不按「像不像要动手」过滤，闲聊轮也会注入；每会话每版本只注入一次（约 70 token）。
- **同一会话同版本只注入一次**：不刷屏。
- **约定版本变化自动再提醒**：改 `VERSION` 后，下一轮（任何类型）会重新注入。
- **注入日志**：每次注入记一行（含选中的约定目录、索引是否存在），生效与否可核对。
- **硬拦截（默认开）**：操作类轮次里，本会话还没 `read` 过 `INDEX.md` 时，`write`/`edit` 等写类工具会被直接拒绝，并提示先读索引；读过后本会话放行。闲聊轮次不拦；shell 默认不拦（可配置）。
- **零配置可用**：包内自带 `skills/` 示例清单；也可以指向你自己的目录，或 OpenViking 里存的那份。

## 为什么会有这个插件

作者是一名 DSH 日常用户（学生，用 DSH + OpenViking 管理学习和工具工作流），遇到的问题很具体：

- 把「写脚本前先看清单」「改文件前先备份」这类操作约定写进了 OpenViking 技能和记忆；
- 但真正干活时，模型并不会稳定地主动去读它们——**约定记了，干活时不提就不用**，等于白记；
- 靠提示词或 `AGENTS.md` 也不稳：要么每轮全量注入太费 token，要么模型想起来才看。

于是和 AI 助手一起做了这个小插件：每会话每版本注入一条极短的门铃（入口清单路径 + 版本号），约定版本一改，下一轮就重新出现——不等到「像要动手」的那一轮。后来发现「注入了也可能不执行」，就补了硬拦截：操作类轮次里没读索引前，写操作直接过不去。

**关于代码**：需求、取舍、验证由作者决定；具体实现是与 AI 助手协作完成的。

**为什么公开**：相信「约定记了但干活不提就不用」不是个例，才把它整理出来上传，希望能帮到有同样需求的人。如果你遇到同样的问题，欢迎直接拿去用，也欢迎把你的场景告诉我，一起改进。

## 安装

### 方式一：安装脚本（推荐，跨平台、零依赖）

```bash
git clone https://github.com/HeliosTangDev/dsh-ops-conventions.git
cd dsh-ops-conventions
node install.mjs                       # 默认装到 ~/.dsh/profiles/desktop
node install.mjs /path/to/profile      # 指定 profile
node install.mjs /path/to/profile --uninstall   # 卸载
```

它会：复制到 `<profile>/node_modules/dsh-ops-conventions`、在 `package.json` 的 `dependencies` 登记、把包名加进 `dsh.profile.bundles`（不加不会被加载）。

### 方式二：手动

1. 把整个仓库复制到 `<profile>/node_modules/dsh-ops-conventions`；
2. 编辑 `<profile>/package.json`：
   ```json
   "dependencies": { "dsh-ops-conventions": "0.2.0" },
   "dsh": { "profile": { "bundles": [ ..., "dsh-ops-conventions" ] } }
   ```

> 注意：`package.json` 里必须有 `dsh.bundle.patch` 指向 `cordis.patch.yml`（本包已带）。缺了它，插件管理器会报「没有声明组合包」，且**不会被加载**。

### 装完

- **热重载**：DSH 插件页 → 找到 `dsh-ops-conventions` → 关掉再打开（改 `skills/` 或配置时不用重启）。
- 改的是**代码**（`index.mjs` / `rule.mjs`）时，关掉再打开不保证重新 import，**重启 DeepSeek Harness** 最稳。

## 配置

| 配置项 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `skillsDir` | `DSH_OPS_CONVENTIONS_DIR` | 包内 `skills/` | 约定目录，需含 `INDEX.md`；`VERSION` 可有可无 |
| `logFile` | `DSH_OPS_CONVENTIONS_LOG` | `~/.dsh/ops-conventions/ops-conventions.log` | 注入 / 拦截日志 |
| `enforce` | — | `true` | 是否启用硬拦截；`false` = 只注入门铃 |
| `blockedTools` | — | `write` `edit` `multi_edit` `apply_patch` `notebook_edit` | 拦截的写类工具名；要连 shell 一起拦就自行加 `bash` / `pwsh` |

解析顺序（会**逐个检查目录里真的有 `INDEX.md`**，取第一个有效的）：

1. 配置项 `skillsDir`
2. 环境变量 `DSH_OPS_CONVENTIONS_DIR`
3. **包内 `skills/`**（随包发布，开箱即用）
4. OpenViking 实际存储：`~/.openviking/data/viking/default/user/default/memories/ops-conventions`
5. `~/.dsh/ops-conventions/skills`

示例（写进 profile 的 `cordis.patch.yml`）：

```yaml
- id: dsh-ops-conventions
  name: "dsh-ops-conventions"
  config:
    skillsDir: "D:/my-conventions/skills"
    enforce: true
    # blockedTools: ["write", "edit", "bash"]
```

## 约定目录结构

```
skills/
├── INDEX.md          # 入口清单（注入文本里给的就是它的路径）
├── VERSION           # 版本号；改它 → 下一次操作轮重新注入
└── ops-scripts/
    └── SKILL.md      # 各类清单，INDEX.md 里引用
```

自带 6 类示例：`ops-scripts`（脚本/后台）、`ops-notes`（笔记）、`ops-files`（文件目录）、`ops-check`（自检）、`ops-longtask`（长任务）、`ops-dsh`（DSH/插件）。可以直接改成你自己的。

## 机制

- 监听 `agent/pre-step`（waterfall），在模型调用前判断最后一条用户消息像不像"要动手"（工具词 或 动作词+对象词）。
- 命中且该会话该版本未注入过 → 追加一条 `instructions` 来源的消息。
- **硬拦截**监听 `tools/pre-execute`（waterfall）：当轮用户消息像要动手、且本会话还没**成功** `read` 过 `INDEX.md` 时，对写类工具返回 `deny`（理由里带索引绝对路径），模型照做后重试即可通过；`tools/result` 观察成功的 INDEX 读取后放行。
- 钩子自身异常一律 **fail-open**（放行）并写日志；`skillsDir` 里没有 `INDEX.md` 时不拦。
- 任何异常都吞掉，不影响正常对话；多会话各自独立判断。
- 日志里可核对：`inject vN`、`guard deny`、`guard index-read`、`guard loaded enforce=...`。

## 常见问题

**Q：插件市场里搜不到？**
A：市场只索引 npm / GitHub 上的包，本地安装的不会出现在搜索结果里；在「已装」列表里能看到。

**Q：卡片显示「异常：这个包没有声明组合包」？**
A：`package.json` 缺 `dsh.bundle.patch`。本包已带；如果你自己改了包，记得保留。

**Q：模型说 `skill xxx is unknown`？**
A：那是会话启动时的技能目录快照导致的，与插件无关。直接用 `read` 读注入里给的那个 `INDEX.md` 路径即可。

**Q：写文件被拒绝，理由是「硬拦截」？**
A：本会话还没 `read` 过 `INDEX.md`。按理由里给的路径读一次（并执行对应清单），再重试原操作即可；不想要这个行为，把配置 `enforce` 设为 `false`。

**Q：注入的提醒会显示在对话里？**
A：会，作为一条来源为插件的消息。长度约 70 token，一个会话只出现一次（版本变了再一次）。

## License

MIT

## Star

如果这个插件对你有用，欢迎在 GitHub 上点个 ⭐ Star，让更多 DSH 用户看到。
