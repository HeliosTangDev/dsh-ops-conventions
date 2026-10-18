# 操作约定注入（dsh-ops-conventions）

把「操作约定」在**动手前**确定性注入上下文，解决「约定记了但干活时不提就不用」的问题。

## 它做什么

- **只在"像要动手"的轮次注入**：命中工具/动作关键词时才加一段极短的提醒（约 50 token），闲聊零成本。
- **同一会话同版本只注入一次**：不刷屏。
- **约定版本变化自动再提醒**：改 `VERSION` 文件后，下一次操作轮会重新注入。
- **注入日志**：每会话每次注入都记一行，便于核对是否生效。
- **配合 OpenViking**：操作约定本身存放在 OpenViking 技能里（或任意目录的 `INDEX.md`），本插件负责在动手前把入口提出来。

## 为什么会有这个插件

作者是一名 DSH 日常用户（学生，用 DSH + OpenViking 管理学习和工具工作流），遇到的问题很具体：

- 把「写脚本前先看清单」「改文件前先备份」这类操作约定写进了 OpenViking 技能和记忆；
- 但真正干活时，模型并不会稳定地主动去读它们——**约定记了，干活时不提就不用**，等于白记；
- 靠提示词或 `AGENTS.md` 也不稳：要么每轮全量注入太费 token，要么模型想起来才看。

于是和 AI 助手一起做了这个小插件：每轮判断「这句话像不像要动手」，像就注入一条极短的门铃（入口清单路径 + 版本号），其余情况零成本。

**关于代码**：需求、取舍、验证由作者决定；具体实现是与 AI 助手协作完成的。这个仓库公开的初衷是「自己遇到的问题大概率别人也会遇到」，欢迎按自己的工作流改造。

## 安装

```bash
# 以本地目录安装（推荐，可随时改）
dsh plugin --profile <profile> add link:/path/to/dsh-ops-conventions
# 或发布到 npm 后
dsh plugin --profile <profile> add dsh-ops-conventions
```

> 若用 `link:` 安装而插件依赖 `@deepseek-ai/dsh-llm`，请确保宿主 profile 的 `node_modules` 能被解析（或改用复制安装）。

## 配置

插件接受两个可选项（写在 `cordis.patch.yml` 的 `config` 里，或环境变量）：

| 配置项 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `skillsDir` | `DSH_OPS_CONVENTIONS_DIR` | `~/.dsh/ops-conventions/skills` | 约定目录，需包含 `INDEX.md` 与 `VERSION` |
| `logFile` | `DSH_OPS_CONVENTIONS_LOG` | `~/.dsh/ops-conventions/ops-conventions.log` | 注入日志路径 |

示例：

```yaml
- insert:
    - id: dsh-ops-conventions
      name: 'dsh-ops-conventions'
      config:
        skillsDir: 'D:/my-conventions/skills'
```

## 约定目录结构

```
skills/
├── INDEX.md    # 入口清单（注入文本里会给它的路径）
├── VERSION     # 版本号；改它就会触发重新注入
└── ops-*.md    # 各类清单（可选，INDEX 里引用）
```

## 机制

- 监听 `agent/pre-step`（waterfall），在模型调用前判断最后一条用户消息是否像"要动手"。
- 命中且该会话该版本未注入过，就追加一条 `instructions` 来源的用户消息。
- 任何异常都吞掉，不影响正常对话。
- 多会话各自独立判断、各自注入。

## License

MIT

## Star

如果这个插件对你有用，欢迎在 GitHub 上点个 ⭐ Star，让更多 DSH 用户看到。
