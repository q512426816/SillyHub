---
author: qinyi
created_at: 2026-08-29 21:05:48
---

# pre-commit 在并行会话同仓（busy tree）时静默不完成提交

## 现象

工作树存在**其它并行会话的未暂存改动**（同一仓库同时有两个 agent 会话在干活）时，
`git commit` 触发本仓 pre-commit hook（`.git/hooks/pre-commit` → pre-commit 框架跑
`backend/.pre-commit-config.yaml` 的 ruff-format / ruff-check）后，**提交静默不落上**：

- 输出只有一行 `[INFO] Restored changes from C:\Users\qinyi\.cache\pre-commit\patchXXXXXXXX-XXXXX.`
- **没有** `[main <hash>] ...` 提交结果行，也没有任何错误行
- `git log` 核实：HEAD 未移动，改动仍 staged/working tree——表面像"提交成功"，实际没有

2026-08-29 当天三轮实测（multi-agent-platform 主仓，与另一并行 agent 会话同仓工作）：

1. merge 提交（origin/main 16 提交合并，手解 daemon.ts 冲突后）——首次不落，重试落上；
2. alembic merge 迁移提交（单文件）——首次不落，重试落上；
3. 流式 tar 修复提交（两文件，ruff 两项全 Passed）——首次不落，重试落上。

三轮共同点：提交瞬间工作树里有并行会话的**未暂存**改动（hook 需 stash/restore 它们）。

## 疑似根因

pre-commit 框架的 stash/restore 机制与并行会话的工作集竞争：hook 结束时
`Restored changes` 分支打印 INFO 后，某条路径的退出码/流程被吞（具体在
pre-commit 框架哪一层待定位；本仓 hook 仅两个 ruff 钩子，且第 3 轮实测
两项钩子均显示 Passed，排除钩子本身失败）。管道 `| tail` 截断会让静默失败
更难察觉（退出码不可见），但非根因——第 1/2 轮无管道同样不落。

## 影响

- 提交静默丢失，必须人工 `git log` 核实；连续操作（提交→下一步假设已落）会踩空
- 诱使操作者用 `--no-verify` 绕 hook「先把活干完」——违反 CLAUDE.md 规则 10，
  本会话 2026-08-29 已实际发生一次（merge 提交，已记录于该变更 verify-result）
- 并行会话同仓是 SillySpec 多 agent 工作流的常态场景，此坑会高频复现

## 临时绕过（已验证）

1. **重试**：同命令单独再跑一次 `git commit`，三轮均第二次成功（竞争窗口过去）
2. 提交后必查 `git log --oneline -1` 确认落上，再进行下一步
3. 禁止用 `--no-verify` 绕过（规则 10）；确需绕过时必须如实记录

## 建议修复方向

- 本仓 hook 侧：busy tree（存在 unstaged 改动）时 hook **fail-loud**——输出明确的
  失败原因与退出码，而不是 INFO 后静默；或 pre-commit 升级后验证该场景是否已修
- 流程侧：sillyspec 封装 git commit 的路径（如有）应感知「无 commit 结果行」这一
  失败形态并显式报错，不能依赖调用方自查 git log

## 处置记录（2026-08-30 定时收口，缓解落地 + 根因定性上游）

1. **根因定性（上游设计限制）**：查证 pre-commit 官方 tracker——并发进程改动工作树与 hook 的 stash/restore 窗口竞态是该框架的已知设计限制（pre-commit#2803「Add an option to test staged files without stashing unstaged changes」/ #2235「Alternative to stashing files」），无「静默不落提交」的对应 bug 修复。4.6.1（2026-07-21）/4.6.2（2026-08-10）changelog 均无 stash/并发相关修复（仅 language:node npm 兼容与 pre-push 性能）——**升级 4.6.0→4.6.2 无益，不升**。
2. **hook 侧 fail-loud 不可行（分析结论）**：提交未落时 git 不会执行任何 post-hook（post-commit 只在提交成功后跑），git 自身无检测点；修改 `.git/hooks/pre-commit`（生成文件）会被 `pre-commit install` 覆盖。**唯一可靠检测点是调用方**。
3. **落地缓解（平台仓 CLAUDE.md 规则 12 扩展）**：「提交后必须核实落库——`git log --oneline -1` 确认 HEAD 已移动；busy tree 竞态静默不落（仅 `[INFO] Restored changes` 无提交结果行）则原命令重试（实测二次即成），禁止 `--no-verify`」——临时绕过三条全部规则化，agent 会话自动遵循。
4. **流程侧（sillyspec 封装感知）**：核实 sillyspec 仓无 git commit 封装路径（昨日遗留的 wt-commit.js 实验已删除、未合入），新建封装不在本坑范围且 agent 手动 `git commit` 不会自动采用——由规则 12 覆盖。

遗留：上游若发布 stash 竞态相关修复（关注 #2803 走向）可再评估升级。本地可行动作已全部落地 → 归档。
