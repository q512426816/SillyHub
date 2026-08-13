---
id: task-02
title: spec_workspace/schema.py 增量 DTO（FileOp / SpecIncrementalSyncRequest / SpecIncrementalSyncResponse）
title_zh: 增量同步端点 DTO（FileOp/Request/Response）
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-007@v1]
goal: >-
  定义增量同步端点请求/响应契约（design §7 逐字实现），供 service/router 与 daemon 侧对齐
allowed_paths:
  - backend/app/modules/spec_workspace/schema.py
implementation:
  - FileOp(BaseModel) 字段：op=Literal[add,update,delete,rename]；path=str；new_path=str|None（rename 用）；hash=str|None（SHA-256，add/update 用；rename 且 hash 相同可不传）；content=str|None（base64，add/update 用；rename 且 hash 相同可不传）；base_version=int（该文件本地基于的版本）
  - SpecIncrementalSyncRequest(BaseModel) 字段：ops=list[FileOp]
  - SpecIncrementalSyncResponse(BaseModel) 字段：ok=bool；new_versions=dict[str,int]（path 到新版本号）；conflict=bool=False；server_versions=dict[str,int]|None=None（409 时返回服务器当前版本）
acceptance:
  - 三个 DTO 类（FileOp/SpecIncrementalSyncRequest/SpecIncrementalSyncResponse）存在，字段与 design §7 逐字一致
  - content 为 base64 字符串、hash 为 SHA-256 hex；默认值对齐 §7（new_path/hash/content 默认 None、conflict 默认 False、server_versions 默认 None）
verify:
  - cd backend && uv run ruff check app/modules/spec_workspace/schema.py
constraints:
  - 纯 DTO 无 DB 依赖（可与 task-01 并行）
  - 不改旧 DTO（SpecWorkspaceRead 等）
provides:
  - contract: spec_incremental_dto
    fields: [FileOp, SpecIncrementalSyncRequest, SpecIncrementalSyncResponse]
    desc: 增量同步端点请求/响应契约
expects_from: []
---
