---
id: task-05
title: backend router GET /logs 加 ?tool_kind= 多选 query
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P1
depends_on: [task-01]
blocks: [task-09]
requirement_ids: [FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/service.py
goal: GET /logs 支持 ?tool_kind= 多选筛选，便于按工具种类查询日志（前端筛选后端可选支撑）
implementation: router.py:385-403 加 tool_kind Query(None) 逗号分隔多选；service get_run_logs 加 tool_kind 参数 WHERE channel=tool_call AND tool_kind IN(...)
acceptance: ?tool_kind=sillyspec,skill 筛选生效；不传返回全部（向后兼容）；单工具也生效；走索引
verify: cd backend && uv run pytest tests/modules/agent/test_router.py -v（task-09 覆盖）
constraints: D-003；不传 tool_kind 行为不变（§9 兼容）；多选逗号分隔与前端 active set join 对齐
provides:
  - contract: GET_logs_tool_kind_query
    fields: [tool_kind]
expects_from:
  task-01:
    - contract: AgentRunLogEntry
      needs: [tool_kind]
---

# task-05 · backend GET /logs ?tool_kind= API

## goal

GET `/workspaces/{ws}/agent/runs/{run_id}/logs` 加可选 `?tool_kind=` 多选 query，支撑按工具种类筛选查询。覆盖 design §7 REST API、FR-07。

## implementation

1. **router.py:385-403** GET /logs 加 `tool_kind: str | None = Query(None, description="逗号分隔多选工具种类，仅筛 channel=tool_call 行；不传返回全部")`（Query 风格参照 ppm/problem/router.py:89、ppm/kanban/router.py:66）。
2. **service.py `get_run_logs`** 加 `*, tool_kind: str | None = None`：非空时 `split(",")` → WHERE `channel='tool_call' AND tool_kind IN (...)`；为空返回全部（向后兼容）；非 tool_call 行不参与 tool_kind 筛选。
3. 利用 task-01 的 `ix_agent_run_logs_tool_kind` 索引。

## 验收标准

- [ ] `?tool_kind=sillyspec,skill` 返回 channel=tool_call 且 tool_kind IN (sillyspec,skill)
- [ ] 不传 tool_kind → 返回全部日志（向后兼容，§9）
- [ ] 单工具 `?tool_kind=sillyspec` 也生效
- [ ] 查询走 `ix_agent_run_logs_tool_kind` 索引

## verify

- `cd backend && uv run pytest tests/modules/agent/test_router.py -v`
- task-09 集成测试覆盖 API 筛选

## constraints

- 多选用逗号分隔 str（与前端 active set `join(",")` 对齐，design §7 示例一致），不走 `list[str]` 多次传参。
- 不传 tool_kind 行为不变（§9 兼容性）。
- 本任务无新迁移，依赖 task-01 的列+索引就绪。
