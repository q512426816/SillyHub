---
id: task-05
title: backend complete_lease 完成驱动 end 单测
priority: P1
wave: W2
depends_on: [task-03]
blocks: []
requirement_ids: [FR-3, FR-4, FR-5, FR-6]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_lease_service.py
author: qinyi
created_at: 2026-06-25T15:52:00+08:00
---

# task-05: complete_lease 完成驱动 end 单测

> 来源：plan.md Wave2 task-05 / SC-1, SC-5, SC-6。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/tests/test_lease_service.py` | scan/stage 完成→end 断言 + 容错 |

## 实现要求（TDD）

1. scan lease 完成（change_id=None + spec_strategy=platform-managed + agent_session_id 非空）→ mock facade，断言 `_end_session_for_completed_lease` 被调用，reason=task_completed
2. stage lease 完成（change_id 非空）→ 断言被调用
3. 多轮对话 lease 完成（非 platform-managed + change_id None）→ 断言未调用
4. facade 抛异常 → 断言 lease.status 仍 completed（容错）
5. agent_session_id 为 None → 断言未调用，lease 仍 completed

## 验收标准

| 条件 | 预期 |
|---|---|
| 5 用例 | 全通过 |
| cd backend && uv run pytest tests/test_lease_service.py | pass |
