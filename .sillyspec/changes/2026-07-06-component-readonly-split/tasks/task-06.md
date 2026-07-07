---
id: task-06
title: change 废 _sync_change_workspaces + ChangeSummary.workspace_ids + 删 ChangeWorkspace 模型
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-005@V1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/workspace/model.py
goal: >
  废弃 change_workspaces 投影链路（D-005）：删 `_sync_change_workspaces` 及其调用、`ChangeSummary` 去 `workspace_ids`、删 `ChangeWorkspace` 模型；变更的权威主存储仍是 `changes.affected_components` 字符串数组，不动。
implementation:
  - `change/service.py:1201-1244` 删除 `_sync_change_workspaces` 方法
  - 删除其调用处（`change/service.py:1049` 附近）
  - `change/schema.py` 中 `ChangeSummary` 移除 `workspace_ids` 字段（或置空数组，按现有消费方决定；倾向直接删字段）
  - `workspace/model.py:201-226` 删除 `ChangeWorkspace` 模型类（表本身由 task-12 migration DROP）
  - 检查前端是否消费 `workspace_ids`，若有则同步（task-08 处理 lib 层）
acceptance:
  - `grep _sync_change_workspaces backend/app` 无命中
  - `grep workspace_ids backend/app/modules/change` 无命中（schema 已去字段）
  - 变更创建/详情链路正常，`affected_components` 字符串数组未动
verify:
  - cd backend && python -m pytest tests/modules/change/ -q
  - cd backend && python -m pytest tests/modules/workspace/ -q
constraints:
  - `changes.affected_components` JSON 字符串数组不动（变更功能权威主存储）
  - 表 `change_workspaces` 的 DROP 留给 task-12 migration
  - 删 `workspace_ids` 前先看 task-01 清单确认前端消费点，协调 task-08
---

