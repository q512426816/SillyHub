---
id: task-04
title: 'backend-attribution-service'
title_zh: '后端归属服务：schema v2 + upsert 关联/聚合 + session_id 过滤'
author: qinyi
created_at: 2026-08-23 14:09:00
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-005, D-006, D-007, D-009]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
goal: >
  上报归属落地：hub_session_id 命中关联到平台会话（跨 ws 静默降级）；无 hub 按
  (harness, entry.ctx) 分组 find-or-create tool_report 会话并链接 entries；
  GET 增 session_id 过滤（design §3.3.2/§3.3.3/§3.3.6）。
implementation:
  - schema：AgentLogPushRequest +hub_session_id(uuid|None)；AgentLogEntry +change_key/+quick_id(str|None max128, entry 级)；AgentLogListItem +agent_session_id
  - service upsert_agent_log_entries 增 user_id/hub_session_id 入参：落库后归属——hub 分支（ws+deleted_at 校验，未命中跳过）；无 hub 分支按 (harness, coalesce(change_key, quick_id, '')) 分组 find-or-create（title="{harness} · {ctx 或 '本地活动'}"、provider 映射 D-007、config_snapshot={"harness":…}、status='pending'、turn_count=0、last_active_at 刷新）；同事务
  - list_agent_logs 增 filter_session_id（scope 内 AND 等值，越权空）
  - router：POST 透传新参；GET 增 session_id Query
  - pytest：关联命中/跨 ws 降级/聚合幂等（重推同 ctx 一会话）/entry 级 ctx 分组（变更 A/B 两个会话）/无 ctx 单桶/session_id 过滤
acceptance:
  - platform_sync 套件全绿（既有 106 零回归 + 新 ≥8）；ruff/mypy 干净
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests -q && uv run ruff check app/modules/platform_sync && uv run mypy app/modules/platform_sync
constraints:
  - 归属 best-effort：任何归属失败不抛错、entries 仍入库（D-005）
  - 会话创建只由本服务（单一写者），origin 缺省 'chat' 全兼容存量
---

# task-04 补充说明
无。
