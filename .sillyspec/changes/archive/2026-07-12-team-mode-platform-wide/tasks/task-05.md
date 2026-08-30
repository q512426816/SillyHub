---
id: task-05
title: test_team_mode_dispatch.py 单测
title_zh: team 模式 dispatch 透传单测
author: qinyi
created_at: 2026-07-12 10:41:54
priority: P1
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-1]
decision_ids: [D-003, D-004]
allowed_paths:
  - backend/app/modules/agent/tests/test_team_mode_dispatch.py
---

## 目标

新建单测覆盖 Wave 1 的 mode/session_id 透传 + single 零回归。放在 `backend/app/modules/agent/tests/`（与 test_delegation_route.py、test_finalizer.py 同级）。

## 实现要点

新建 `backend/app/modules/agent/tests/test_team_mode_dispatch.py`，覆盖：

1. **mode 透传**：POST `/api/workspaces/{id}/missions` body `{objective, mode:"team"}` → 断言落库 `AgentMission.constraints["mode"]=="team"`。
2. **session_id 透传**：POST body `{objective, session_id:<uuid>}` → 断言 `AgentMission.constraints["session_id"]==str(uuid)`。
3. **single 零回归**：POST body `{objective}`（不带 mode）→ 断言 constraints 无 mode 键。
4. **mode=single 显式**：POST body `{objective, mode:"single"}` → 断言 `constraints["mode"]=="single"`（透传但不分流）。

测试方式参考现有 mission/router 测试（test_mission_router.py 或同类），用 httpx AsyncClient + db_session fixture。**mock CoordinatorPlanner 避免真调 GLM**（mission 创建会调 planner，测试只验透传落库）。

## 验收标准

- 4 个用例（mode 透传 / session_id 透传 / single 零回归 / mode=single 显式）全过。
- 测试不真调 GLM（mock planner）。
- `pytest app/modules/agent/tests/test_team_mode_dispatch.py` 全过。

## verify

```
cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_team_mode_dispatch.py
```

## 约束

- 只新建 test_team_mode_dispatch.py，不改其他测试。
- 不测 route() 分流（R-A：Wave 1 不实现分流；route() 已有 test_delegation_route.py 覆盖）。
- 不测 model session_id 列（R-B：Wave 1 不加列，session_id 存 constraints）。
- mock GLM planner，测试只验 constraints 透传落库。
