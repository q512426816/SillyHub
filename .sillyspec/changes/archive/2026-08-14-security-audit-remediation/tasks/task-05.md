---
id: task-05
title: "file IDOR"
title_zh: "file 模块 IDOR 修复（下载/meta/软删/列表归属断言）"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/file/service.py
  - backend/app/modules/file/router.py
  - backend/app/modules/file/tests/test_file_idor.py
  - backend/app/modules/file/tests/test_file_api.py
  - backend/app/modules/file/tests/conftest.py
goal: >
  file 模块五个读/删端点补归属断言，跨用户访问统一 404，list 收敛为本人 + 有 WORKSPACE_READ 的工作区可见域。
implementation:
  - 新建 backend/app/modules/file/tests/test_file_idor.py，先写失败用例覆盖他人下载 404、他人 meta 404、他人软删 404、他人 list 不可见、workspace 成员可见、platform_admin 全见
  - file/service.py 新增私有归属判定 helper，断言逻辑为 row.uploaded_by 等于 user.id 或 user.is_platform_admin 或 owner_type 为 workspace 且 has_permission 对 owner_id 有 WORKSPACE_READ（用 auth/rbac.py 的 has_permission，禁用不存在的 WorkspaceService.get_member 与 MemberBindingResolver，Grill M-3）
  - get_stream 与 get_meta 与 soft_delete 增加 current_user 参数，_get_active 取到行后先跑归属断言，不满足抛 AppError 404 code file_not_found（与不存在同语义，D-001）
  - batch_meta 增加 current_user 参数，查询后按同一 helper 过滤，无权行静默剔除不整批 404（对齐既有跳过软删的回显语义）
  - list_files 可见域改造——无过滤参数时改为 uploaded_by 等于 user.id OR owner_type 为 workspace 且 owner_id 在 allowed_workspace_ids(user, WORKSPACE_READ) 集合内；带 owner_id 参数时先校验该 workspace 成员关系（has_permission WORKSPACE_READ），非成员抛 404；admin 豁免可见全部
  - file/router.py 五个端点把 current_user 透传给对应 service 调用（download/meta/batch-meta/delete/list）
  - 顺带修正 service 与 router 中「无参数返回全部活跃文件」的 docstring 与注释（规则 18，注释与实现一致）
acceptance:
  - 用户 B 下载/取 meta/软删用户 A 上传且非 workspace 归属的文件，期望 HTTP 404
  - 用户 B 调 batch-meta 含 A 的文件 id，响应不含该行且不报错
  - 用户 B 无参调 /api/file/list，看不见 A 的 ppm_problem 等私有归属文件，只看见自己上传与本人有 WORKSPACE_READ 的 workspace 归属文件
  - workspace 成员按 owner_type=workspace 与 owner_id 过滤能列出该 workspace 借用方案文件（PPM 借用场景回归，R-04）
  - platform_admin 无参 list 返回全部活跃文件
  - 既有 file 模块测试除 test_list_without_filters_returns_all_active 改造外全部保持绿
verify:
  - cd backend && uv run pytest app/modules/file -q --no-cov
constraints:
  - 归属校验只放 service 层（router 仅透传 current_user），与 upload 端点 uploaded_by 取值链一致
  - 404 语义统一——无权与不存在不区分（D-001，沿 287eed60 owner-only 约定）
  - 不改 upload 端点行为、不动 File 表 schema（无迁移）
  - allowed_workspace_ids 与 has_permission 均来自 app/modules/auth/rbac.py，勿在本模块重复实现角色查询
related_tests:
  - path: backend/app/modules/file/tests/test_file_api.py
    reason: test_list_without_filters_returns_all_active（:178）断言无参 list 返回全平台全量，可见域收紧后语义失效，需改造为上传者视角（本人上传 + 本人有权限的 workspace）或 admin 视角断言
---
