---
id: task-02
title: create_mission 透传 mode/session_id 到 constraints
title_zh: create_mission 端点透传 mode 与 session_id
author: qinyi
created_at: 2026-07-12 10:41:54
priority: P1
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-1]
decision_ids: [D-003, D-004]
allowed_paths:
  - backend/app/modules/agent/router.py
---

## 目标

让 create_mission 端点（router.py:728）把前端传来的 mode/session_id 透传到 mission constraints 落库。Wave 1 只透传（R-A 只存不拆），不改 dispatch 链路——mode 写入 constraints['mode'] 后，现有 GLM planner 链路不变（不实现 single 短路，留后续 Wave）。

## 实现要点

1. 编辑 `backend/app/modules/agent/router.py` create_mission 端点（约 :728-781，签名 `workspace_id, payload: MissionCreateRequest, session, user`）。
2. 当前 :747 透传 `constraints=payload.constraints`。改为构建 constraints 副本并注入 mode/session_id：
   ```python
   constraints = dict(payload.constraints or {})
   if payload.mode is not None:
       constraints["mode"] = payload.mode
   if payload.session_id is not None:
       constraints["session_id"] = str(payload.session_id)
   ```
   把这份 constraints 传给 `start_mission`（替换原 `constraints=payload.constraints`）。
3. **不调 route()，不加分流**（R-A：只透传，single 零回归靠"前端默认不传 mode"）。
4. **不加 model session_id 列 / migration**（R-B：session_id 暂存 constraints，不绑 AgentMission 模型）。

## 验收标准

- POST `/api/workspaces/{id}/missions` body 含 `mode:"team"` → 落库 `AgentMission.constraints["mode"]=="team"`。
- POST body 含 `session_id` → `AgentMission.constraints["session_id"]` 落库（字符串）。
- POST body 不含 mode → constraints 无 mode 键（零回归）。
- 不改 start_mission 签名（mission.py 不动）。

## verify

```
cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_team_mode_dispatch.py -k mode
```

（依赖 task-05 测试文件；本 task 只改 router，测试由 task-05 覆盖）

## 约束

- 只改 router.py create_mission，不动 mission.py / model.py / mission_schema.py（task-01 改 schema）。
- 不加 route() 分流（R-A）。
- 不加 migration（R-B）。
