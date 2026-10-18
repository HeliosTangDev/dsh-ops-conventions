---
name: ops-scripts
description: 写脚本或起后台任务前必过的检查清单。用于任何 .ps1/.cmd/.bat/.py 的编写修改、起后台 job、做跑批/监控/采样/启动器、或需要「中断后能续跑」的长任务。覆盖 pid.txt 与 progress.txt、ASCII 与 BOM 编码、-CommandFile 传参、长窗口回收、幂等续跑与熔断、变量名冲突等已知坑。
tags:
- 脚本
- powershell
- 后台任务
- 约定
---

# ops-scripts — 写脚本/起后台任务时的检查清单

> 权威细节在 `<工具区>\TOOLS.md`（「已知坑」与工具行）和相关记忆。本技能只负责**触发 + 清单**。

## 必做（写完先自查）

1. **长跑脚本第一件事写 pid.txt**（看板据此实时判活、按 `K` 中断）：
   ```powershell
   ("$PID") | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'pid.txt') -Encoding ASCII
   ```
2. **有进度就写 progress.txt**：`42/60` 或 `40%`。
3. **编码**：`.ps1` 要么纯 ASCII，要么**带 BOM 的 UTF-8**（PS 5.1 把无 BOM 中文按 GBK 读 → 静默解析失败）。用编辑器工具改过 BOM 文件后**必须补 BOM**。
4. **复杂模板参数走 `-CommandFile`**：`-Command 'xx "yy"'` 经 `powershell -File` 会被拆散并错绑到别的参数（表现为静默 exit 1）。
5. **长时段监控不要挂 harness 内 job**（会话结束会被回收）→ 独立 `.cmd` 双击运行。
6. **幂等续跑**：每完成一项立即落盘，中断/关窗/重启后重跑只跑剩下的，最多重做"当前那一项"。
7. **连续失败熔断**：默认连败 5 次自动停，并提示"后端可能坏了，修好重跑即续跑"。
8. **PowerShell 陷阱**：局部变量别与参数同名（`$Items`/`$items` 互相覆盖）；函数别返回 hashtable/数组（会被 unroll，单元素数组退化成字典）；`cmd /c` 会吃掉 `viking://` 这类 URI，改用 `powershell -Command`。
9. **起后台 job 写 `job.txt`**（用途/命令/日志/启动时间），中间产物进 `_tasks\<任务>\`。

## 收尾

- 能加 `-DryRun`/`-Once` 的先冒烟，再真正启动。
- 改完立刻实测，不要"看着对"就交。
- 任务结束清理中间产物（留档就整目录移 `_archive\`）。

