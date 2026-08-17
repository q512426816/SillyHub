---
repo: main
id: task-01
title: task-01
title_zh: 新增清单读取端点
goal: 实现 GET /api/changes/-/spec-manifest，让 CLI 能读到服务器 spec_root 权威清单。
implementation: |
  1. SpecWorkspaceService.get_manifest(workspace_id) 查询 SpecFileManifest 全部行。
  2. PlatformSyncService.get_spec_manifest(workspace_id) 透调。
  3. 新增 SpecManifestResponse schema。
  4. router.py 新增端点，依赖 require_platform_sync_write。
acceptance: |
  - GET 返回与 SpecFileManifest 表一致；
  - 未认证 401，非 shpsync_ token 403；
  - router 依赖为 require_platform_sync_write。
verify: pytest backend/app/modules/platform_sync/tests/test_spec_sync.py
constraints: |
  - 路径使用 /api/changes/-/spec-manifest，避免与 /api/changes/{name} 贪婪匹配冲突。
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/spec_workspace/service.py
---

# task-01 新增清单读取端点
