---
id: task-05
title: file router+挂载
title_zh: file router（upload/get/meta/batch-meta/delete）+ main.py 挂载 /api/file
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-04]
blocks: [task-06, task-07]
requirement_ids: [FR-1, FR-2, FR-3, FR-4]
decision_ids: [D-009]
allowed_paths:
  - backend/app/modules/file/router.py
  - backend/app/main.py
goal: >
  实现 file router 五端点，大小/类型校验 413/415、JWT 鉴权、D-009 Content-Disposition 安全契约，并挂载到 /api/file。
expects_from:
  task-04:
    - contract: FileUploadResp
      needs: [id, original_name, mime_type, size]
    - contract: FileMetaResp
      needs: [id, original_name, mime_type, size, owner_type, owner_id]
provides:
  - contract: FileHttpApi
    fields: [POST_upload, GET_id, GET_id_meta, POST_batch_meta, DELETE_id]
  - contract: FileUploadResp
    fields: [id, original_name, mime_type, size]
  - contract: FileMetaResp
    fields: [id, original_name, mime_type, size, owner_type, owner_id]
implementation:
  - POST /api/file/upload（multipart，query owner_type?/owner_id?，调 service.upload_file，返回 FileUploadResp）
  - GET /api/file/{id}：StreamingResponse + Content-Type 按 MIME；图片白名单(jpeg/png/gif/webp) inline，其余(含 svg/html)强制 attachment（D-009）
  - GET /api/file/{id}/meta 返回 FileMetaResp；POST /api/file/batch-meta 返回 FileMetaResp 列表
  - DELETE /api/file/{id} 软删
  - 校验：超 file_max_size_mb → 413，类型不在白名单 → 415（对齐 Excel 导入 _validate_upload 模式）
  - 沿用现有 JWT deps，记录 uploaded_by
  - main.py include_router(file_router, prefix=/api/file)
acceptance:
  - 五个端点齐全且挂在 /api/file 下
  - 上传超限返回 413、类型不符返回 415
  - 图片白名单 inline 预览、svg/html 等强制 attachment 下载（D-009）
  - 未登录请求被 JWT 拦截
verify:
  - cd backend && uv run ruff check app/modules/file/router.py app/main.py
  - cd backend && uv run python -c "from app.main import app; print([r.path for r in app.routes if '/file' in getattr(r,'path','')])"
constraints:
  - 上传白名单默认排除 text/html、image/svg+xml 等可渲染危险类型（D-009）
  - 不做按工作区/成员强权限隔离（沿用 JWT 登录可见）
  - 路由测试在 task-06，本任务只实现
---
