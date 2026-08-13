---
id: task-04
title: router.py 新增 POST /spec-workspace/sync-incremental 端点（WORKSPACE_WRITE，409 透传 server_versions）
title_zh: 增量同步 HTTP 端点
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-02, FR-07]
decision_ids: [D-001@v1, D-007@v1]
goal: >
  暴露增量同步端点，调 apply_ops；conflict 经响应体返回服务器当前版本供 daemon 提示冲突。
implementation:
  - 新增 POST /spec-workspace/sync-incremental 端点（response_model=SpecIncrementalSyncResponse），路径前缀沿用 /workspaces/{workspace_id}（实际 /api/workspaces/{wsId}/spec-workspace/sync-incremental）；鉴权 require_permission(Permission.WORKSPACE_WRITE) 对齐现有 sync 端点
  - 调 service.apply_ops(workspace_id, payload.ops) 组装响应；conflict=True 仍返 200，body 带 conflict+server_versions（design §7，409 由 daemon 据字段提示）
  - containment/.runtime 越界 AppError 422 透传
acceptance:
  - 端点存在且鉴权 WORKSPACE_WRITE
  - 正常返 new_versions；冲突返 conflict=True + server_versions
  - 越界 payload 422
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
  - cd backend && uv run ruff check app/modules/spec_workspace/router.py
constraints:
  - 路径前缀与现有 spec-workspace 端点一致；不改旧端点
  - design §7 接口定义为准（op/Request/Response 逐字一致）
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
provides:
  - contract: sync_incremental_endpoint
    fields: ["POST /api/workspaces/{wsId}/spec-workspace/sync-incremental", conflict, server_versions, new_versions]
expects_from:
  task-03:
    - contract: apply_ops
      needs: [new_versions, conflict, server_versions]
  task-02:
    - contract: spec_incremental_dto
      needs: [FileOp, SpecIncrementalSyncRequest, SpecIncrementalSyncResponse]
---
