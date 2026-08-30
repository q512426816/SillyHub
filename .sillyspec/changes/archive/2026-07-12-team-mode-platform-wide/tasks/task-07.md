---
id: task-07
title: transition_with_dispatch 透传 team_mode + 写 stages JSON
title_zh: execute team 触发链路透传
author: qinyi
created_at: 2026-07-12 11:01:04
priority: P1
depends_on: [task-06]
blocks: [task-09]
requirement_ids: [FR-2]
decision_ids: [D-002, D-006]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/router.py
---

## 目标

让 transition 链路把 team_mode 写进 `change.stages` JSON，触发 dispatch.py 已有的 team 分流（:806-815 已就绪，**无需改 dispatch.py**）。

**注意 plan 漏列**：plan task-07 写"dispatch.py 触发"，但 dispatch.py 分支已存在；真正改动在 service.py + router.py（本 TaskCard 扩范围）。

## 实现要点

1. **service.py `transition_with_dispatch`（:687-746）**：加 `team_mode: bool=False` 参数。在 transition() 之后、dispatch() 之前，若 team_mode=True：
   ```python
   if team_mode:
       stages = dict(change.stages or {})  # 必须 dict copy！SQLAlchemy JSON 原地改不 dirty（反复踩过的坑）
       stages["team_mode"] = True
       change.stages = stages
       session.add(change)
       await session.flush()
   ```
   然后调 `dispatch(provider, model)`（dispatch 读 change.stages.team_mode 自动分流，dispatch.py:810-815）。
2. **router.py `transition_change`（:420-459）**：把 `body.team_mode` 透传给 `service.transition_with_dispatch(team_mode=body.team_mode)`。
3. **dispatch.py 不改**（:806-815 分支 + :904 `_dispatch_execute_team` 已就绪且接线）。

## 验收标准

- POST transition target_stage=execute team_mode=True → `change.stages["team_mode"]==True`。
- dispatch 读 stages.team_mode=True → 调 `_dispatch_execute_team`（dispatch.py:815）。
- team_mode=False（默认）→ stages 无 team_mode 键，走 single（零回归）。

## verify

```
cd backend && uv run pytest -q --no-cov app/modules/change/tests/test_dispatch_execute_team_mode.py
```

（依赖 task-09 测试文件）

## 约束

- 写 stages **必须 dict copy**（SQLAlchemy JSON 原地改不落库）。
- dispatch.py 不改（已有分支，改了会回归 :810-815 契约）。
- 不动 brainstorm/plan dispatch 路径（D-002）。
