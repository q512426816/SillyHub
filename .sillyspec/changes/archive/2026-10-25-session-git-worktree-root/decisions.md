---
author: flow-machine-draft
created_at: 2026-10-25T12:23:43.245Z
---
# 决策记录（Decisions）— 2026-10-25-session-git-worktree-root

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：探测层多一次 RPC（stat 5s）加在每轮 60s 轮询上——离线场景先 stat 失败（静默 miss，≈即时）再 git_status 502，延迟增加可忽略；正常场景 stat 是本地文件 lstat，毫秒级。次风险：current_change_id 有值但 agent 实际已 apply 回主仓继续干、worktree 未清理——探测命中显示工作树分支（非 agent 实际工作目录），语义偏差存在但方向正确（该 change 的隔离环境分支正是用户关心的），接受为显式边界（收口评审裁决）。 试过放弃的方案：① 从会话日志 stdout 文本解析 agent 输出的 worktree 路径——自然语言解析脆弱、覆盖率不可控，放弃；② daemon 侧实时跟踪 agent 进程 cwd——agent 的 cd 是 harness Bash 内 shell 状态，外部进程不可见，机制上不可行，放弃；③ sillyspec worktree create/apply 时回调平台 API 登记——跨系统契约变更（CLI/npm 包 + daemon + backend 三端），且存量已创建的 worktree 无登记回填，重；留作后续正路（平台 worktree 注册表），本变更先零侵入探测。
