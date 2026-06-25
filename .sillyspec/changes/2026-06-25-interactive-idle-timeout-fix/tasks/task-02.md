---
id: task-02
title: backend session 子域增 facade 完成驱动 end 委托方法
priority: P0
wave: W1
depends_on: []
blocks: [task-03]
requirement_ids: [FR-3, FR-4]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/lease/service.py
author: qinyi
created_at: 2026-06-25T15:52:00+08:00
---

# task-02: backend facade 完成驱动 end 委托方法

> 来源：design.md Phase 3（D-002 落地）/ plan.md Wave1 task-02。
> 本质：lease 子域经 `self._facade._end_session_for_completed_lease(...)` 委托 session 子域，复用现有 FR-05 `session_end` 链路。须在 task-03 前定义。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/session/service.py` | 新增 `_end_session_for_completed_lease` 方法 |
| 修改 | `backend/app/modules/daemon/lease/service.py` | facade 引用入口（实际调用在 task-03） |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-3/4 | scan/stage 完成主动 end | 提供跨域 end 委托方法 |

## 实现要求

1. session 子域新增 `async def _end_session_for_completed_lease(self, agent_session_id: str, reason: str = "task_completed") -> None`
2. 内部复用现有 end 落地逻辑（`ws_hub.send_session_control(session_end)`，session/service.py:765 附近）
3. 幂等：session 已 ended/不存在 → no-op（不抛）
4. 对齐 D-006 facade 反向委托模式（参考 `_run_post_scan_validation` / `_trigger_stage_completion_callback`）

## 边界处理

- agent_session_id 为空/不存在 → no-op
- session 已 ended → no-op（幂等）
- send_session_control 失败 → 抛出由调用方（task-03）try/except

## 验收标准

| 条件 | 预期 |
|---|---|
| 方法存在且可被 lease 子域经 facade 调用 | 通过 |
| 已 ended session 调用 | no-op 不抛 |
