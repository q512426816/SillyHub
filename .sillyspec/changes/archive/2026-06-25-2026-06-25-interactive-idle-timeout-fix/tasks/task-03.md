---
id: task-03
title: backend complete_lease 收尾增 scan/stage 完成驱动 end 钩子
priority: P0
wave: W1
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-3, FR-4, FR-5, FR-6]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
author: qinyi
created_at: 2026-06-25T15:52:00+08:00
---

# task-03: complete_lease 完成驱动 end 钩子

> 来源：design.md Phase 2（D-002@v1）/ plan.md Wave1 task-03。
> 本质：`complete_lease` 收尾链末尾对 scan/stage run 主动调 end_session，补上断裂的收尾链。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/lease/service.py` | `complete_lease`（278）收尾链末尾增 end 钩子 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-3 | scan 完成主动 end | change_id=None + platform-managed → end |
| FR-4 | stage 完成主动 end | change_id 非空 → end |
| FR-5 | 多轮对话不自动 end | 非 platform-managed 跳过 |
| FR-6 | end 失败不阻塞 lease | try/except warn |

## 实现要求

1. 在 `complete_lease` 收尾链末尾（post_scan 校验之后、`daemon_lease_completed` log 之前）插入钩子
2. 判定 `should_end`：`agent_run.change_id is not None`（stage）或 `getattr(agent_run, "spec_strategy", None) == "platform-managed"`（scan）
3. 取 `agent_run.agent_session_id`（model.py:195 字段，**非** lease metadata）
4. `should_end and agent_session_id` → `await self._facade._end_session_for_completed_lease(agent_session_id=str(...), reason="task_completed")`
5. 整段 try/except，异常 warn log（`complete_lease_end_session_failed`），不阻塞

## 边界处理

- agent_session_id 为 None → 跳过 end，lease 仍 completed
- 多轮对话（非 platform-managed 且 change_id None）→ 跳过
- facade 调用抛异常 → warn log，lease 完成不受影响
- 已 ended session → facade 内部幂等 no-op

## 验收标准

| 条件 | 预期 |
|---|---|
| scan lease 完成 | end_session 被调用 |
| stage lease 完成 | end_session 被调用 |
| 多轮对话 lease 完成 | end_session 未调用 |
| end 抛异常 | lease 仍 completed |
