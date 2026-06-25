---
author: qinyi
created_at: 2026-06-25T15:42:00
---

# Tasks

> 任务细节在 plan 阶段展开。本文件只列任务名称、对应文件路径、覆盖的 FR/D 决策。

## daemon 侧（sillyhub-daemon）

### task-daemon-idle-disable
- **文件**：`sillyhub-daemon/src/interactive/session-manager.ts`
- **覆盖**：FR-1, FR-2, D-001@v1
- **要点**：`DEFAULT_IDLE_TIMEOUT_SEC` 1800→0；`startIdleMonitor` 增 `>0` 守卫；`_idleTimer` 默认不启动；env 逃生口保留。

### task-daemon-idle-test
- **文件**：`sillyhub-daemon/src/interactive/__tests__/session-manager-idle-disabled.test.ts`（新增）
- **覆盖**：FR-1, FR-2, SC-2, SC-4
- **要点**：idle 定时器默认不启动；长 turn（持续 tool_use）不触发 end；env=1800 恢复旧行为。

## backend 侧（backend）

### task-backend-complete-lease-end
- **文件**：`backend/app/modules/daemon/lease/service.py`
- **覆盖**：FR-3, FR-4, FR-5, FR-6, D-002@v1
- **要点**：`complete_lease` 收尾链末尾增完成驱动 end 钩子；scan run（change_id=None + platform-managed）+ stage run（change_id 非空）主动 end；agent_session_id 取 `AgentRun.agent_session_id`；try/except warn 不阻塞。

### task-backend-facade-end
- **文件**：`backend/app/modules/daemon/lease/service.py`（facade 反向委托）+ `backend/app/modules/daemon/session/service.py`（end 落地）
- **覆盖**：FR-3, FR-4, D-002@v1
- **要点**：lease 子域经 `self._facade._end_session_for_completed_lease(...)` 委托 session 子域；复用现有 `ws_hub.send_session_control(session_end)` FR-05 链路。

### task-backend-lease-test
- **文件**：`backend/app/modules/daemon/tests/test_lease_service.py`
- **覆盖**：FR-3, FR-4, FR-5, FR-6, SC-1, SC-5, SC-6
- **要点**：scan lease 完成 → end_session 断言；stage lease 完成 → end_session 断言；多轮对话 → 不调 end；end 失败 → lease 仍 completed。

## 文档

### task-doc-sync
- **文件**：`.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md`
- **覆盖**：D-001@v1, D-002@v1
- **要点**：idle 回收默认禁用 + 完成驱动 end 契约更新。
