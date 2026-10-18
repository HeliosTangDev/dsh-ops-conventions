# 操作约定索引（动手前先读这张卡）

> 这是插件自带的示例清单，随包发布、零配置可用。
> 想换成自己的目录：设 `skillsDir`（或环境变量 `DSH_OPS_CONVENTIONS_DIR`），目录里放 `INDEX.md` + `VERSION`。

| 要做的事（触发词） | 读这份 |
|---|---|
| 写/改脚本、起后台任务、跑批、监控、采样、启动器、要能中断续跑 | [ops-scripts/SKILL.md](ops-scripts/SKILL.md) |
| 记笔记、整理笔记目录、建章节/索引/导图/术语表 | [ops-notes/SKILL.md](ops-notes/SKILL.md) |
| 建/移/删/归档文件、重排目录、清中间产物、备份回滚 | [ops-files/SKILL.md](ops-files/SKILL.md) |
| 改完自检、验证、批量收尾校验、给结论前取证 | [ops-check/SKILL.md](ops-check/SKILL.md) |
| 长任务/批量/定时/长时段监控、查看·中断·恢复后台任务 | [ops-longtask/SKILL.md](ops-longtask/SKILL.md) |
| DSH 插件查找/安装/升级/开关、宿主升级、兼容判定 | [ops-dsh/SKILL.md](ops-dsh/SKILL.md) |

## 元规则

1. 产生新约定 → 归入某一类 → 改对应 `SKILL.md` → 更新本索引 → 改 `VERSION` 版本号（插件会在下一次操作轮重新提醒）。
2. 没有合适的类 → 新建 `ops-<名>` 并加一行。
3. 不要只把约定写进记忆（那样等于"不提就不执行"）。

## 版本

`VERSION` 文件里的数字变化后，插件会在下一次"像要动手"的轮次重新注入一次提醒。
