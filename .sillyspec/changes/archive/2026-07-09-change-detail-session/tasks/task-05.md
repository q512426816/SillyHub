---
id: task-05
title: dispatch 透传 workspace_id（prepare_interactive_dispatch 接线，R-02）
title_zh: 交互 dispatch 透传 workspace_id 让 cwd 解析生效
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/session/service.py
goal: >
  prepare_interactive_dispatch 当前不写 workspace_id（仅 batch 路径经 AgentRunWorkspace 读），需让 lease_meta 带 workspace_id，使 lease/context.py 的 _resolve_* 解析 cwd/root_path 生效（R-02）。
implementation:
  - 定位 prepare_interactive_dispatch 签名与 lease_meta 组装处
  - workspace_id 非空时写入 lease_meta["workspace_id"]，让 context.py 既有 workspace_id→spec_root/host 路径解析分支命中
  - 补单测：带 workspace_id 的 interactive dispatch，payload 含正确 root_path
acceptance:
  - 变更会话 dispatch 的 lease payload root_path/workspace_id 正确解析自 workspace
  - 未带 workspace_id 时 dispatch payload 与现状一致（零回归）
verify:
  - cd backend && uv run pytest backend/app/modules/daemon/lease/ -q
  - cd backend && uv run mypy app/modules/daemon/lease/
constraints:
  - 复用 context.py 既有 _resolve_* 分支，不复制解析逻辑
  - 不改 batch 路径
---

## 验收标准
- 带 workspace_id 的 interactive dispatch payload 含正确 root_path/workspace_id
- 未带 workspace_id 时 dispatch payload 与现状一致（零回归）
- 复用 context.py 既有 _resolve_* 分支

## 验证步骤
- cd backend && uv run pytest backend/app/modules/daemon/lease/ -q
- cd backend && uv run mypy app/modules/daemon/lease/
