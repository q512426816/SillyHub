---
id: task-06
title: "platform_sync 收紧"
title_zh: "platform_sync 写端点仅 shpsync_ 可写（JWT/shk_live_ 403）+ 读端点并集聚合"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/platform_sync/auth.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/test_router.py
  - backend/app/modules/platform_sync/tests/test_auth_tightening.py
  - backend/app/modules/platform_sync/tests/conftest.py
goal: >
  关闭 platform_sync 全局桶写入——三个 POST 端点只接受 shpsync_ token，JWT/shk_live_ 一律 403；GET 端点按用户 CHANGE_READ 工作区并集聚合。
implementation:
  - auth.py 的 require_platform_sync 增加 write 布尔参数（default false）；shk_live_ 分支与 JWT 分支在 write=true 时直接 raise HTTPException 403，说明全局桶写通道已关闭仅 shpsync_ token 可写
  - 三路径 workspace 派生语义不变——shpsync_ 仍返回 (user, token 绑定 workspace_id)，shk_live_/JWT 读路径改为返回 (user, workspace 集合)；返回类型从 tuple[User, UUID|None] 演进为承载读并集的结构（或 router 层按 write/READ 分别解包，保持对读端点最小扰动）
  - 读端点并集聚合——JWT/shk_live_ 调 GET /changes 与 GET /changes/{name}/progress 时，用 allowed_workspace_ids(user, CHANGE_READ)（auth/rbac.py）得出工作区集合，service 层 workspace_id 参数改为集合 IN 查询；NULL workspace 存量行走并集聚合 fallback 只读保留（兼容策略）
  - router.py 三个 POST 端点（push_progress / push_documents / submit_approval）依赖改为 write=true 形态；GET 四端点保持读形态
  - shpsync_ 分支逐字不动（CLI sync.js 固化 Bearer shpsync_，不破坏六表 JSON 契约，不从 body 补 workspace 字段——D-004）
  - GET approval 读端点同样按并集聚合判定可见性（跨 workspace 的 change 名不可读）
  - 新建 tests/test_auth_tightening.py 先写失败用例——JWT POST progress 403、JWT POST approval 403、shk_live_ POST documents 403、shpsync_ POST 三端点回归 200、JWT 读只见自己 CHANGE_READ 工作区的 change
  - 改造 test_router.py 既有用例——test_post_jwt_auth_ok（:58）断言改 403；test_post_apikey_auth_ok（:48）与全量 apikey_headers 推送系列用例迁移到 shpsync_ headers（conftest 补 shpsync_ fixture，建 workspace + 签发 token）
acceptance:
  - 合法 JWT POST /api/changes/{name}/progress，期望 HTTP 403
  - 合法 shk_live_ API Key POST /api/changes/{name}/documents 与 POST /api/changes/{name}/approval，期望 HTTP 403
  - 合法 shpsync_ token POST progress/documents/approval 三端点全部 200/409（冲突语义保持）
  - JWT GET /changes 只返回该用户有 CHANGE_READ 权限的工作区的 change，不返回其他工作区与 NULL 桶的他人数据
  - shpsync_ token GET 路径行为逐字节回归（收件箱隔离不变）
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
constraints:
  - 不改 CLI 六表 JSON 契约——progress body 仍为裸 dict 透传，documents 仍 RootModel 裸 map
  - shpsync_ 分支（auth.py:70-76）逐字不动
  - 401 语义不变——无 token 或坏 token 仍 401，403 只用于有效凭据但写通道关闭
  - platform_sync/service.py 只加集合过滤查询形态，不改 upsert 单写者语义（D-003@v1 documents 单写者与本变更 D-004 不冲突）
related_tests:
  - path: backend/app/modules/platform_sync/tests/test_router.py
    reason: test_post_jwt_auth_ok（:58）断言 JWT POST progress 200，写端点收紧后将 403，需改为 403 断言；apikey_headers 系列用例（:48/:71/:94/:104 起）依赖 shk_live_ 写路径，需迁移到 shpsync_ fixture 保持回归覆盖
---
