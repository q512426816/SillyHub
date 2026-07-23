---
id: task-06
title: mcp_tools.converge_mission 改可重入（逐个 merge + 冲突返回标记给主 agent + 重入 git merge --continue + R-07 轮次上限失败回退）+ 单测
title_zh: converge_mission 改可重入冲突解决 + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/tests/test_converge_mission_reentrant.py
expects_from:
  task-05:
    - contract: FinalizerMergeResult
      needs: [merged_branches, pending_conflicts]
goal: >
  converge_mission 改可重入——调 task-05 拿 merge 结果，有冲突返回 {status:conflict, conflicts} 给主 agent 自己 SDK 解决（不在 backend 写文件），重入检测 merge in progress 继续，R-07 轮次超限 git merge --abort + mission 标人工。
implementation:
  - 读 mcp_tools.py converge_mission(:293) 当前实现
  - 调 task-05 finalize_execute_mission → pending_conflicts 非空 → 返回 {status:conflict, conflicts:[{file, marker_lines}]} 给主 agent tool 调用方
  - 重入（主 agent 解决后再调）→ 检测 merge in progress → HostFsDelegate 跑 git merge --continue（或合下一分支）
  - R-07 解冲突轮次计数 per mission（存 AgentMission 或 run metadata），超限（默认 3）→ git merge --abort + mission status=needs_manual + worker 副本保留
  - 解决过程写 agent_run_logs（主 agent SDK Read/Write 天然经日志）
  - 单测覆盖：成功路径 / 冲突返回 / 重入 continue / 超限回退
acceptance:
  - 冲突时 tool 返回 {status:conflict, conflicts}（主 agent 自己 SDK 解决）
  - 重入能继续合并（git merge --continue）
  - R-07 超限 → git merge --abort + mission 标 needs_manual
  - mypy 绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_converge_mission_reentrant.py -q
  - cd backend && uv run mypy app/modules/agent/mcp_tools.py
constraints:
  - 主 agent 自己 SDK Read/Write 解决冲突（backend 不写文件，无需新 host_fs write RPC，X-004）
  - R-07 轮次上限可配（默认 3）
  - 不破坏既有 converge_mission_for_completed_run 调用链
---
