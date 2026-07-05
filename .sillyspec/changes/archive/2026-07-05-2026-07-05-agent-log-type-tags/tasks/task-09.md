---
id: task-09
title: backend 集成单测（迁移 + 落库 + publish + API）
author: qinyi
created_at: 2026-07-05 10:05:43
priority: P1
depends_on: [task-01, task-02, task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/tests/modules/agent/test_agent_run_log_tool_kind.py
goal: 集成测试覆盖 task-01/04/05 产出（迁移正反+双路径落库+publish 两处+API 筛选）
implementation: 新建 test_agent_run_log_tool_kind.py 五段：迁移正反/batch 主+兜底+stdout NULL/interactive _extract_sdk/publish 两处/API 四 case
acceptance: 迁移正反；落库填列正确（interactive+batch 双路径）；publish 两处含字段；API 筛选生效；SQLite 单测全绿；提示 PG 验证迁移链
verify: cd backend && uv run pytest tests/modules/agent/test_agent_run_log_tool_kind.py -v
constraints: R-01 迁移链断裂 SQLite 测不出须 PG；SQLite naive datetime 比较 _as_utc；不绑死 SQL 函数名（断言行数+字段值）；与 task-02 unit test 互补（本 task 测集成链路）
provides:
  - contract: integration_tests
    fields: [test_agent_run_log_tool_kind]
expects_from:
  task-01:
    - contract: AgentRunLogEntry
      needs: [tool_kind]
  task-02:
    - contract: classify_tool_kind
      needs: [classify_tool_kind]
  task-04:
    - contract: AgentRunLog 落库
      needs: [tool_kind, published_logs_payload]
  task-05:
    - contract: GET_logs_tool_kind_query
      needs: [tool_kind]
---

# task-09 · backend 集成单测

## goal

集成测试覆盖 task-01/02/04/05 的产出链路：迁移正反 + 双路径落库 + publish 两处 + API 筛选。覆盖 design §8/§9/§10 R-01、FR-01/04/05/06/07。

## implementation

新建 `backend/tests/modules/agent/test_agent_run_log_tool_kind.py`，五段：
1. **迁移测试**：upgrade 后 `agent_run_logs` 有 `tool_kind` 列 + `ix_agent_run_logs_tool_kind` 索引；downgrade 后列+索引消失（正反可逆）。
2. **batch 落库（FR-05）**：`submit_messages` 收到带 tool_kind 的 tool_call message → 落库 tool_kind 正确；msg 无 tool_kind 但 content 是 tool_call JSON → JSON.parse 兜底识别；stdout 文本行 tool_kind=NULL。
3. **interactive 落库（FR-04）**：`_extract_sdk_messages` 收到 btype=tool_use 的 SDK block → 打标正确。
4. **publish（FR-06）**：`published_logs.append` + `session_payload` 两处 dict 都含 tool_kind（R-08）。
5. **API（FR-07）**：GET /logs `?tool_kind=sillyspec,skill` 筛选生效；不传返回全部；单工具也生效。

## 验收标准

- [ ] 迁移 upgrade/downgrade 可逆（SQLite 跑；提示 PG 验证链断裂，R-01）
- [ ] batch 落库：msg 带优先 + JSON.parse 兜底 + stdout NULL 三路径正确
- [ ] interactive 落库：btype=tool_use 打标正确
- [ ] publish 两处 payload 含 tool_kind
- [ ] API 筛选：多选/单选/不传三 case 正确
- [ ] SQLite 单测全绿

## verify

- `cd backend && uv run pytest tests/modules/agent/test_agent_run_log_tool_kind.py -v`
- PG 验证迁移链（手动 / CI）：`alembic upgrade head` 在 PG 跑通

## constraints

- **R-01 迁移链断裂**：SQLite 测不出，须 PG 验证（migration-chain-fragmentation 记忆）。
- SQLite naive datetime 比较 `_as_utc`（backend-test-sqlite-vs-pg 记忆）。
- 不绑死 SQL 函数名（断言行数 + 字段值，不写 `date_trunc` 等）。
- 与 task-02 unit test 互补（task-02 测函数纯逻辑，本 task 测集成链路）。
