---
id: task-04
title: file schema+service
title_zh: 文件 schema 与 service 业务层（上传/下载/batch-meta/软删）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-02, task-03]
blocks: [task-05]
requirement_ids: [FR-1, FR-2, FR-3, FR-4]
decision_ids: [D-003]
allowed_paths:
  - backend/app/modules/file/schema.py
  - backend/app/modules/file/service.py
goal: >
  实现 file schema（FileUploadResp/FileMetaResp）+ service（上传存 MinIO 并落库、下载流、batch-meta、软删），Depends 注入 StorageBackend。
expects_from:
  task-02:
    - contract: StorageBackend
      needs: [put_object, get_object_stream, delete_object]
provides:
  - contract: FileUploadResp
    fields: [id, original_name, mime_type, size]
  - contract: FileMetaResp
    fields: [id, original_name, mime_type, size, owner_type, owner_id]
implementation:
  - file/schema.py 定义 FileUploadResp(id/original_name/mime_type/size)、FileMetaResp(+owner_type/owner_id)、BatchMetaRequest(ids)
  - service.upload_file：校验大小/类型 → 生成 stored_key(2026/07/<uuid>.<ext>) → StorageBackend.put_object → 落 File 表 → 返回 FileUploadResp
  - service.get_stream：取 File 元数据 → StorageBackend.get_object_stream 返回异步流
  - service.batch_meta：按 ids 批量查 File 返回 FileMetaResp 列表
  - service.soft_delete：置 deleted_at，可选同步 StorageBackend.delete_object
  - StorageBackend 通过 Depends(get_storage_backend) 注入 service
acceptance:
  - 上传链路：存对象 + 落库 + 返回 FileUploadResp（含 id/original_name/mime_type/size）
  - batch_meta 返回含 owner_type/owner_id 的 FileMetaResp
  - 软删除置 deleted_at，已删文件不可读
verify:
  - cd backend && uv run ruff check app/modules/file
  - cd backend && uv run python -c "import app.modules.file.service, app.modules.file.schema"
constraints:
  - 大小/类型校验函数在 service 实现，413/415 状态码由 task-05 router 抛 HTTPException
  - stored_key 用日期分桶 + uuid，避免对象覆盖
  - uploaded_by 取当前 JWT 用户；owner_id 允许空（D-008 新建场景）
---
