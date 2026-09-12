---
id: task-02
task_id: task-02
title: "messages.py 共识任务行 gather 前显式 commit"
title_zh: "messages.py 共识任务行先行提交"
status: pending
author: qinyi
created_at: 2026-09-12 22:20:00
goal: "use_consensus 分支任务行在 gather 前显式 commit（标量预取防 ORM expire），触发失败不再吞任务，sweeper 超时收口兜底闭环"
implementation: "在 _consensus_trigger_kwargs 定义后、asyncio.gather 前 await svc._session.commit()；commit 前标量预取 consensus_task.id 等，gather 段/收口段 ORM 引用改标量；仅 use_consensus 分支加 commit，普通路径零变化。"
target_files:
  - backend/app/modules/daemon/group/service/messages.py
allowed_paths:
  - backend/app/modules/daemon/group/service/messages.py
acceptance:
  - gather 前显式 commit 仅在 use_consensus 分支；普通路径零变化
  - test_group_consensus.py 21 用例不回归
verify: "uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus.py"
constraints: "commit 点前移不改成功路径终态；消息行既有 commit（268 行）顺序不变"
---
title_zh: "messages.py 共识任务行先行提交"
goal: "use_consensus 分支任务行在 gather 前显式 commit（标量预取防 ORM expire），触发失败不再吞任务，sweeper 超时收口兜底闭环"
acceptance:
  - gather 前显式 commit 仅在 use_consensus 分支；普通路径零变化
  - test_group_consensus.py 21 用例不回归

# task-02: messages.py 共识任务行 gather 前显式 commit

## 背景

use_consensus 分支 `create_consensus_task`（messages.py:328，flush-only）挂主事务；gather（:413）中任何非 AppError 异常 → 请求 500 → 主事务回滚 → 任务行被吞（消息已先 commit 落时间线——不一致状态，sweeper 无从兜底）。

## 要求

按 design §2.2：

1. gather 之前显式 `await svc._session.commit()`（位置：`_consensus_trigger_kwargs` 定义后、`asyncio.gather` 调用前；或 `group_consensus_task_created` 日志后集中处——选离 gather 最近且语义清晰处）。
2. commit 前标量预取（`consensus_task_id_val = consensus_task.id` 等），commit 后只用标量——检查 gather 段/收口段对 `consensus_task`/`consensus_coordinator` ORM 对象的引用，全部改用预取标量或确定 commit 后仍安全访问（新事务内访问属性会触发隐性刷新，避免）。
3. 仅 use_consensus 分支加 commit（普通路径零变化）。
4. 注释标「2026-09-12-group-trigger-lock-graceful design §2.2：任务与消息同生；触发失败由 sweeper 收口（D-006 闭环）」。

## 验收

- grep 可见 gather 前 commit；普通路径（use_consensus=False）无新增 commit。
- 既有 test_group_consensus.py 21 用例不回归（commit 点前移不改变成功路径终态）。
