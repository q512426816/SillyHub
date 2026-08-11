---
id: task-05
title: require_platform_sync derives workspace from sync token
title_zh: require_platform_sync 派生 workspace，返回 (User, workspace_id|None)
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-01, task-04]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/auth.py
provides:
  - contract: require_platform_sync
    fields: [user, workspace_id]
expects_from:
  task-04:
    - contract: PlatformSyncTokenService.authenticate
      needs: [user, workspace_id]
goal: >
  改 require_platform_sync 为三路分流并返回 (User, workspace_id|None)，shpsync_ 走
  PlatformSyncTokenService.authenticate 派生 user=created_by 与 workspace_id，shk_live_
  与 JWT 回退返回 (User, None) 不阻断，落地 D-001@v1 覆盖 FR-02。
implementation:
  - 更新模块 docstring：删旧「不做 workspace 权限检查（D-002）」注，改述 workspace 由 token 派生；注明本变更 D-001@v1 与旧变更 sillyhub-platform-sync D-002 同名不同义
  - 导入 task-04 的 shpsync_ 前缀常量与 PlatformSyncTokenService（构造参照 ApiKeyService，传 session + settings）
  - 返回类型改 (User, uuid.UUID|None)，按前缀三分流：shpsync_ 走 authenticate（返 None 抛 AuthTokenInvalid 401，成功派生 created_by 用户与 token 绑定 workspace_id）；shk_live_ 走 ApiKeyService.authenticate 返回 (user, None)；其余 get_current_user 返回 (user, None)
acceptance:
  - shpsync_ 有效 → (created_by 用户, 该 token 绑定 workspace_id)；未知/吊销 → AuthTokenInvalid 401
  - shk_live_ / JWT 成功 → (User, None)，200/401 门控与旧版一致
  - 无 token → AuthTokenMissing 401 不变；三路均返回元组，无 workspace 语义调用点不阻断
verify:
  - cd backend && uv run ruff format --check app/modules/platform_sync && uv run ruff check app/modules/platform_sync
  - cd backend && uv run mypy app/modules/platform_sync/auth.py
  - cd backend && uv run pytest app/modules/platform_sync/tests -q
constraints:
  - shk_live_ 过渡期 workspace_id=None 不阻断（R-02），现有 3 端点 task-07 改前行为不变
  - workspace_id 只取自 platform_sync_tokens.workspace_id（token 派生唯一通道），绝不从 body/header 取（G6）
  - 只改 auth.py；router.py 注解 User 与 workspace_id 透传归 task-07 scope；shpsync_ 新鉴权用例由 task-07 / task-12 覆盖
related_tests:
  - backend/app/modules/platform_sync/tests/test_router.py — 不改不破：3 端点不消费 require_platform_sync 返回值仅做 200/401 门控，shk_live_/JWT 分支行为不变
---
