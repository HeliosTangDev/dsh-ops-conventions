# 操作约定注入（dsh-ops-conventions）

把「操作约定」在**动手前**确定性注入上下文，解决「约定记了但干活时不提就不用」的问题。

## 它做什么

- **只在"像要动手"的轮次注入**：命中工具/动作关键词时才加一段极短的提醒（约 50 token），闲聊零成本。
- **同一会话同版本只注入一次**：不刷屏。
- **约定版本变化自动再提醒**：改 `VERSION` 文件后，下一次操作轮会重新注入。
- **注入日志**：每会话每次注入都记一行，便于核对是否生效。
- **配合 OpenViking**：操作约定本身存放在 OpenViking 技能里（或任意目录的 `INDEX.md`），本插件负责在动手前把入口提出来。

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
