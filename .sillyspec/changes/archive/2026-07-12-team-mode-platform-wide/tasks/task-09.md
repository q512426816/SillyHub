---
id: task-09
title: test_dispatch_execute_team_mode.py 单测
title_zh: execute team dispatch 单测
author: qinyi
created_at: 2026-07-12 11:01:04
priority: P1
depends_on: [task-06, task-07]
blocks: []
requirement_ids: [FR-2]
decision_ids: [D-002, D-006]
allowed_paths:
  - backend/app/modules/change/tests/test_dispatch_execute_team_mode.py
---

## 目标

新建单测覆盖 execute team_mode 触发 + single 零回归 + GLM 未配置兜底。放在 `backend/app/modules/change/tests/`。

## 实现要点

新建 `backend/app/modules/change/tests/test_dispatch_execute_team_mode.py`，3 case：

1. **team_mode 触发**：transition target_stage=execute team_mode=True → 断言 `change.stages["team_mode"]==True` + `_dispatch_execute_team` 被调（mock `GLMConfig.from_env` 非 None + `CoordinatorPlanner` + `MissionService.start_mission` 返回 `(mission, [run1, run2])`）+ 返回 `dispatched=True, mode="team"`。
2. **single 零回归**：team_mode=False（默认）→ `_dispatch_execute_team` 不被调，走 single（`start_stage_dispatch` 被调 / single AgentRun 路径）。
3. **GLM 未配置兜底**：team_mode=True 但 `GLMConfig.from_env` 返回 None → `dispatched=False` reason 含 `glm_not_configured`（dispatch.py:928-930 兜底）。

参考 Wave 1 `app/modules/agent/tests/test_team_mode_dispatch.py` 的 mock 模式。注意 `dispatch.py:919-926` lazy import（`from app.modules.agent.control import MissionControlService` 等），patch 路径对齐 `app.modules.change.dispatch.MissionService` 等（lazy import 后的符号）。

## 验收标准

- 3 case 全过。
- 不真调 GLM（mock planner + MissionService）。
- mock planner.plan 用 **AsyncMock**（plan 被 await，Wave 1 task-05 踩过 MagicMock 不可 await 的坑）。

## verify

```
cd backend && uv run pytest -q --no-cov app/modules/change/tests/test_dispatch_execute_team_mode.py
```

## 约束

- 只新建测试文件，不改其他测试。
- mock GLM/CoordinatorPlanner/MissionService（不触 daemon）。
- planner.plan 必须 AsyncMock。
