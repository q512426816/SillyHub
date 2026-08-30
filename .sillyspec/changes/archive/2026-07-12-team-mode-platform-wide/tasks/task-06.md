---
id: task-06
title: TransitionRequest 加 team_mode 字段
title_zh: stage 流转请求加 team_mode
author: qinyi
created_at: 2026-07-12 11:01:04
priority: P1
depends_on: []
blocks: [task-07, task-09]
requirement_ids: [FR-2]
decision_ids: [D-002, D-003]
allowed_paths:
  - backend/app/modules/change/schema.py
---

## 目标

TransitionRequest（change/schema.py:202-215）加 `team_mode: bool=False`，作为 execute 阶段 team 模式的 API 入口（AC-2 主入口是 transition 链路）。

## 实现要点

1. 编辑 schema.py 的 TransitionRequest（当前 target_stage / reason / provider / model 四字段）。
2. 加：
   ```python
   team_mode: bool = Field(default=False, description="execute 阶段是否用团队执行（D-002，默认 single 零回归）")
   ```
3. 只改 TransitionRequest（manual_dispatch 走 Query 非 body，本次不扩 manual 支持 team）。

## 验收标准

- TransitionRequest 含 team_mode 默认 False。
- 不动其他 schema。

## verify

```
cd backend && uv run python -c "from app.modules.change.schema import TransitionRequest; r=TransitionRequest(target_stage='execute'); assert r.team_mode is False; print('ok')"
```

## 约束

- 只改 schema.py TransitionRequest。
- 默认 False（D-003 零回归）。
