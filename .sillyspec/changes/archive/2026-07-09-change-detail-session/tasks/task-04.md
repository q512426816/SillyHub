---
id: task-04
title: create_session service 写入绑定 + 解析 cwd
title_zh: create_session 写入 change_id/workspace_id 并解析工作目录
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-01, task-03]
blocks: [task-05, task-08]
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
expects_from:
  task-01:
    - contract: AgentSession
      needs: [change_id, workspace_id, cwd]
  task-03:
    - contract: SessionCreateRequest
      needs: [change_id, workspace_id]
goal: >
  create_session（service.py:319）签名加 change_id/workspace_id，写入 AgentSession；workspace_id 非空时解析 cwd（复用既有路径解析，D-003）。
implementation:
  - create_session 加参数 change_id=None, workspace_id=None
  - 创建 AgentSession 时写入 change_id=change_id, workspace_id=workspace_id
  - workspace_id 非空时调用现有 workspace→本地根路径解析（与 scan/agent-run 同一解析器）得到 cwd，写入 session.cwd（agent/model.py:437）
  - 未传时 cwd/change_id/workspace_id 保持 None，走原逻辑
acceptance:
  - 带 change_id 的会话持久化绑定；未带时零回归
  - workspace_id 非空时 cwd 被写入为 workspace 本地项目根
verify:
  - cd backend && uv run mypy app/modules/daemon/session/service.py
  - cd backend && uv run ruff check app/modules/daemon/session/service.py
constraints:
  - 复用既有路径解析，不新造解析逻辑
  - 前导注入在 task-08 做，本 task 只做绑定+cwd
---

## 验收标准
- 带 change_id 的会话持久化绑定；未带时零回归
- workspace_id 非空时 cwd 写入为 workspace 本地项目根
- 复用既有路径解析，未新造逻辑

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/session/service.py
- cd backend && uv run ruff check app/modules/daemon/session/service.py
