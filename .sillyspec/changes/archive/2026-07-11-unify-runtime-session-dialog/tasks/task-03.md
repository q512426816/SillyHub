---
id: task-03
title: delete_agent_session 改 UPDATE 软删 + 移除断外键代码
title_zh: 删除会话改为逻辑删除并清理断 agent_runs 外键代码
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-06]
decision_ids: [D-003]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
provides:
  - behavior: delete_agent_session_soft_delete
goal: >
  把 delete_agent_session 从物理删除改为 UPDATE deleted_at 软删，保留 run/log，并删除 service.py:1560-1564 断 agent_runs 外键的代码（C-7/F-2）。
implementation:
  - backend/app/modules/daemon/session/service.py:1513 delete_agent_session，对 active/pending/reconnecting 会话仍先 best-effort _end_session_for_delete（WS SESSION_END + currentRun killed + lease completed，失败仅 warning 不阻断）
  - 把原 DELETE agent_sessions 行改为 UPDATE agent_sessions SET deleted_at=now() WHERE id=? AND user_id=?
  - 删除 service.py:1560-1564 的 update(AgentRun).set(agent_session_id=None) 断外键代码段
  - ended/failed 会话跳过 end reconciliation 直接 UPDATE deleted_at（design §5 Phase1 / §7.5）
  - 软删后 status 保持原值（不强制改 ended），靠 deleted_at IS NULL 过滤可见性
acceptance:
  - active/pending/reconnecting 会话删除：先 best-effort end reconciliation（失败仅 warning），再 UPDATE deleted_at
  - ended/failed 会话删除：直接 UPDATE deleted_at
  - 不再 DELETE 会话行；agent_runs.agent_session_id 外键不再被断
  - service.py:1560-1564 断外键代码段已移除
verify:
  - cd backend && uv run mypy app/modules/daemon/session/service.py
  - cd backend && uv run ruff check app/modules/daemon/session/service.py
constraints:
  - R-4（软删后遗漏删除断外键代码致 run/log 仍被断开）：明确移除 service.py:1560-1564（C-7 / Grill F-2），单测断言 agent_runs.agent_session_id 未断
  - daemon 离线时 end reconciliation 失败仅 warning，软删仍必须成功（design §7.5 不变量）
---

## 验收标准
- active/pending/reconnecting 会话删除：先 best-effort end reconciliation（失败仅 warning），再 UPDATE deleted_at
- ended/failed 会话删除：直接 UPDATE deleted_at
- 不再 DELETE 会话行；agent_runs.agent_session_id 外键不再被断
- service.py:1560-1564 断外键代码段已移除

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/session/service.py
- cd backend && uv run ruff check app/modules/daemon/session/service.py
