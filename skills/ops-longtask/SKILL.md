---
name: ops-longtask
description: 跑长任务/后台任务时必过的清单。用于批量跑批、定时采样、长时段监控、需要中途中断再续跑的任务，以及查看/中断/恢复后台任务。覆盖任务目录约定、taskrun 参数、pid.txt 与 progress.txt、断点续跑与熔断、后台输出只有助手能读、K 中断与 G 恢复、长时段监控不要挂 harness。
tags:
- 长任务
- 后台
- 跑批
- 约定
---

# ops-longtask — 长任务/后台任务清单

## 起任务前

1. 任务目录：`_tasks\<任务名>-<年月>\`（清单、脚本、日志、状态都在里面）。
2. 用跑批器（不要手写循环）：
   `powershell -File _tools\taskrun.ps1 -Items <清单> -CommandFile <模板> -State <状态> -Log <日志> -DonePattern <完成标志> -MaxConsecutiveFailures 5 -VerifyCommand <校验>`
3. 命令模板**放文件**用 `-CommandFile`（`-Command` 带引号会被 `powershell -File` 拆散、错绑参数）。
4. 脚本自己写 `pid.txt`；有进度写 `progress.txt`（`42/60` 或 `40%`）。
5. 写 `job.txt`（用途/命令/日志/启动时间）。

## 运行中

- 进度看 `jobs.cmd`（根目录双击）：任务进度条、剩余时间、ok/fail。
- `K` 中断（已完成项保留，最多重做当前项）；`G` 恢复（后台重跑，自动跳过已完成）。
- **harness 内 job 的 stdout 只有助手能读** → 一切结论必须落进日志/状态文件，用户才看得见。
- **长时段监控（数小时）不要挂 harness 内 job**：会被回收 → 做成独立 `.cmd` 双击运行。
- 连败熔断（默认 5）触发就停下来查后端，不要继续空跑。

## 收尾

- 跑完执行外部校验（`-VerifyCommand`），核对行数/去重数/目标产物。
- 结论（失败项、根因、修法）写进记忆或 `TOOLS.md`，然后删除 `_tasks\` 下该目录（要留档移 `_archive\`）。

