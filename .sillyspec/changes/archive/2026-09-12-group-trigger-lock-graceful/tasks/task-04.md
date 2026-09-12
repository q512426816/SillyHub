---
id: task-04
task_id: task-04
title: "群链路 208 回归 + 真实环境并发前后对照复验"
title_zh: "回归与真实环境前后对照"
status: pending
author: qinyi
created_at: 2026-09-12 22:20:00
goal: "208 存量回归 + ruff/mypy + verify_consensus 独立库并发双消息复验（无 500/任务落库/sweeper 收口 aborted），与修复前归档证据成对照"
implementation: "worktree 跑群链路 9 文件回归；ruff check/format+mypy 变更文件；uvicorn（verify_consensus 库）并发双消息场景复验：断言无 500、消息/任务行均落库、sweeper 对未收口任务超时收口 aborted；证据落 verify-result.md Runtime Evidence。"
target_files:
  - NEW:backend/app/modules/daemon/tests/test_group_trigger_lock.py
allowed_paths:
  - backend/app/modules/daemon/tests/
acceptance:
  - 208+新增全绿；ruff/mypy 绿
  - 真实复验无 500、任务落库、sweeper 收口 aborted
verify: "群链路 9 文件 pytest + 真实环境 curl/psql 断言链"
constraints: "独立库零污染共享 DB；环境沿用 archive/2026-09-10 搭建方式"
---
title_zh: "群链路回归与真实环境前后对照复验"
goal: "208 存量回归 + ruff/mypy + verify_consensus 独立库并发双消息复验（无 500/任务落库/sweeper 收口 aborted），与修复前归档证据成对照"
acceptance:
  - 群链路 208 + 新增用例全绿；ruff/mypy 变更文件绿
  - 真实复验：无 500、任务行落库、sweeper 收口 aborted，前后对照落 verify-result.md

# task-04: 回归 + 真实环境复验

## 要求

1. **存量回归**：worktree 内跑群链路 9 文件（test_group_p1/p2/chat_management/project/direct/cross_mention/mention_pipeline/bridge_projection/consensus）208 用例全绿。
2. **质量门**：ruff check/format + mypy 变更文件全绿。
3. **真实环境复验**（verify_consensus 独立库 + worktree uvicorn，环境沿用 archive/2026-09-10 的搭建方式）：
   - 场景=并发双消息触发同批两成员（daemon 缺位）；
   - 修复后断言：无 500（部分失败 4xx 收集或 200）、消息行与任务行均落库、sweeper 对未收口任务超时收口 aborted；
   - 对照归档证据（修复前 500 + 任务蒸发）形成前后对照。
4. 前后对照证据落 verify-result.md Runtime Evidence。

## 验收

- 208 + 新增用例全绿；ruff/mypy 绿；真实复验证据链完整（日志 + DB 查询断言）。
