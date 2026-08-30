---
author: qinyi
created_at: 2026-06-28 12:31:26
change: 2026-06-28-daemon-subagent-transcript
---

# Tasks · daemon 子代理日志可见性

任务列表（只列名称 / 文件路径 / 覆盖的 FR + D + 风险）。细节（Wave 分组、依赖、验收点）在 plan 阶段展开。

## daemon（sillyhub-daemon）

| ID | 名称 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-01 | driver 开 forwardSubagentText | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts`（start options） | FR-01 / D-001@v1 / D-006@v1 / R-06 |
| task-02 | SessionState 加 subagentDepth + depth 算法 | `sillyhub-daemon/src/interactive/session-manager.ts`（SessionState + _onMessage） | FR-05 / D-007@v1 / R-04 |
| task-03 | partial buffer 按 parent 分桶隔离 | `sillyhub-daemon/src/interactive/session-manager.ts`（_partialBuffers/_bufferPartial/_clearPartialBufferSync/_flushPartial/_emitOverrideSignals/_resolveSegmentId） | FR-03 / D-002@v1 / **R-02 P0** |
| task-04 | agentSessionId 防御守卫 | `sillyhub-daemon/src/interactive/session-manager.ts`（_onMessage system/init） | FR-04 / D-003@v1 |
| task-05 | depth 注入转发（msg.depth） | `sillyhub-daemon/src/interactive/session-manager.ts`（_onMessage 转发前） | FR-05 / D-007@v1 |

## backend

| ID | 名称 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-06 | alembic migration（agent_run_logs 三列+索引） | `backend/migrations/versions/2026XXXX_subagent_log_columns.py`（新增） | FR-06 / D-004@v1 / **R-01 P0** |
| task-07 | ORM model + schema 加三字段 | `backend/app/modules/agent/model.py`（AgentRunLog）+ `backend/app/modules/agent/schema.py`（AgentRunLogEntry/Read DTO） | FR-06 / D-004@v1 |
| task-08 | _extract_sdk_messages 每条注入归属 | `backend/app/modules/daemon/run_sync/service.py:956` | FR-07 / D-008@v1 |
| task-09 | submit_messages 落库写三列 | `backend/app/modules/daemon/run_sync/service.py:278+` | FR-07 |

## frontend

| ID | 名称 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-10 | 日志行类型加三字段并透传 | `frontend/src/lib`（logsToTurns / agent-stream 类型）+ `frontend/src/components/agent-log/*` | FR-08 / D-005@v1 |
| task-11 | agent-log-viewer 徽标 + 深度渲染 | `frontend/src/components/agent-log-viewer.tsx` | FR-08 / D-005@v1 |

## verify

| ID | 名称 | 覆盖 |
|---|---|---|
| task-12 | daemon 单测：partial 隔离回归 + init 守卫 + depth 多层 | FR-03 / FR-04 / FR-05 / R-02 |
| task-13 | backend 单测：extract 透传 + 落库三列 + migration up/down（PG） | FR-06 / FR-07 / R-01 |
| task-14 | 前端渲染测试：徽标 + 深度（mock 日志快照） | FR-08 |
| task-15 | 端到端集成：真实 Claude 调 Task tool 派生子代理（含嵌套），断言 consume 收到带 parent_tool_use_id 的子代理 message + 日志可见归属 + 刷新不丢 | FR-01~FR-09 / **R-06** |

## 决策覆盖汇总

- D-001@v1 → task-01（归属字段来源，assistant+user 均带）
- D-002@v1 → task-03（partial 按 parent 分桶）
- D-003@v1 → task-04（agentSessionId 守卫）
- D-004@v1 → task-06 / task-07（归属承载=新增列）
- D-005@v1 → task-10 / task-11（分阶段平铺带标签）
- D-006@v1 → task-01（只 Claude）
- D-007@v1 → task-02 / task-05（daemon 维护 depth）
- D-008@v1 → task-08（归属每条注入，Grill X-001）

## 风险专项映射

- **R-01（P0 migration 链）** → task-06 + task-13（execute 前 grep 核对单一 head，PG 跑 up/down）
- **R-02（P0 partial 回归）** → task-03 + task-12（主 agent 单代理字节等价回归）
- **R-06（forwardSubagentText 实测）** → task-15（真实 Claude 端到端断言）
- R-03/R-04/R-05/R-07 → task-12/15 覆盖
