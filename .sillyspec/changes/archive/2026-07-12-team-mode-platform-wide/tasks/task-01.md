---
id: task-01
title: MissionCreateRequest 加 mode + session_id 字段
title_zh: mission 创建请求加 mode/session_id 字段
author: qinyi
created_at: 2026-07-12 10:41:54
priority: P1
depends_on: []
blocks: [task-02, task-05]
requirement_ids: [FR-1]
decision_ids: [D-003, D-004]
allowed_paths:
  - backend/app/modules/agent/mission_schema.py
---

## 目标

为 MissionCreateRequest 加两个可选字段，作为 team 模式平台级入口基座（Wave 1 只铺字段 + 透传，不改 dispatch 逻辑）：
- `mode: Literal["single","team"] | None = None` —— single/team 选择，默认 None（等价 single，零回归 D-003）
- `session_id: uuid.UUID | None = None` —— 关联会话（Wave 4 会话发起 team 消费，Wave 1 只铺字段，R-B）

**路径修正**：plan.md task-01 写 `agent/schema.py`，实际是 `agent/mission_schema.py`。

## 实现要点

1. 编辑 `backend/app/modules/agent/mission_schema.py` 的 `MissionCreateRequest`（当前 4 字段：objective / change_id / budget_usd / constraints）。
2. 加 import：`from typing import Literal`（顶部 import 区，按字母序插入）。
3. 在 constraints 字段后追加：
   ```python
   mode: Literal["single", "team"] | None = None
   session_id: uuid.UUID | None = None
   ```
   （uuid 已 import，复用现有 `import uuid`）

## 验收标准

- `MissionCreateRequest` 含 mode + session_id，均默认 None。
- `mode` 类型 `Literal["single","team"] | None`。
- `session_id` 类型 `uuid.UUID | None`。
- 不动其他 schema（MissionArtifactResponse / MissionWorkerRunResponse 等）。

## verify

```
cd backend && uv run python -c "from app.modules.agent.mission_schema import MissionCreateRequest; r=MissionCreateRequest(objective='x'); assert r.mode is None and r.session_id is None; print('ok')"
```

## 约束

- 只改 mission_schema.py，不动 router/service/model。
- 不加 alembic migration（session_id 不落库模型，R-B：Wave 1 只铺 schema 字段，存 constraints）。
- mode 默认 None 保证零回归。
