---
id: task-01
title: 'backend-sessions-owner-name-and-limit'
title_zh: '后端列表端点 owner_name 与 limit 上限放宽'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-108@v2, D-103@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/
goal: >
  GET /api/daemon/sessions 列表补 owner_name（join users.username，缺失 null）+ limit 上限 le=100→500
  （D-103 一次拉取前提；Grill X-07 不改则 task-05 必 422）。
implementation:
  - 列表 SQL（daemon/session/service.py:2408-2497；daemon/service.py:762 门面转发不动）join users 取 username
  - schema.py AgentSessionRead（:18-53）加 owner_name: str | None = None（先例 runtime JOIN users schema.py:255/296 + router.py:467-523 批量注入）
  - router.py:1817 列表 limit Query le=100 → le=500
  - pytest：owner_name 命中/无主旧数据 null/limit=500 通过+501 422 边界
acceptance:
  - pytest 全绿；列表响应含 owner_name（本人会话=本人用户名）
  - limit=500 200、limit>500 422
  - OpenAPI schema 反映新字段（供 task-02 gen:types）
verify:
  - uv run pytest -q app/modules/daemon/tests/（列表相关用例）
constraints:
  - 只读字段，无写路径、无表结构变更（design §8）
  - 不动 daemon 协议与 createSession（design §7.5 零变更）
---

# task-01 补充说明
落点与先例行号见 frontmatter implementation；详细设计依据 design.md §6 后端行（含 producer→consumer 数据流标注）。
