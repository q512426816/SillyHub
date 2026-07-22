---
schema_version: 1
doc_type: module-card
module_id: file
source_commit: pending
author: qinyi
created_at: 2026-07-22T16:00:00
---
# file

## 定位
平台级**对象存储文件中心**。独立 `File` 元数据表（owner 关联），对外提供统一的上传 / 下载 / 元数据 / 批量元数据 / 软删接口。所有需要附件的业务（PPM 问题清单、任务计划、里程碑详情、看板任务等）都走本中心，业务表只存**文件 id**（`file_urls: string[]`，D-006），不再存裸 URL。存储能力由 `storage` 抽象层提供，不直接耦合 MinIO。

## 契约摘要
- `POST /api/file/upload` — multipart 上传，可选 query `owner_type`/`owner_id`，返回 `FileUploadResp(id/original_name/mime_type/size)`，需登录（401 未登录）
- `GET /api/file/{id}` — 下载/预览（图片类 `Content-Disposition: inline`，其余 `attachment`，D-009），中文文件名走 RFC 5987（`filename*=UTF-8''{quote(name)}`）
- `GET /api/file/{id}/meta` — 取单文件元数据（`FileMetaResp`）
- `POST /api/file/batch-meta` — 批量取元数据（body `BatchMetaRequest{ids}`，最多 200，跳过软删项），前端回显用
- `DELETE /api/file/{id}` — 软删（置 `deleted_at`），删除后再访问 404
- `FileService(session, storage, settings)`：
  - `validate_upload(name, mime, size)` — 超限抛 `413`，类型不在白名单抛 `415`
  - `upload_file(...)` — 生成 `{YYYY/MM}/{uuid}.{ext}` 存储键 → `put_object` → 落库
  - `get_stream(id)` — 返回 `(File, AsyncIterator[bytes])`
  - `batch_meta(ids)` / `soft_delete(id)`
- `File` 模型：`id`(UUID) / `owner_type` / `owner_id`(可空，D-008) / `original_name` / `stored_key`(唯一) / `mime_type` / `size`(**BigInteger**) / `uploaded_by` / `created_at` / `deleted_at`(可空)
- 错误：`AppError(..., http_status=413)` 超大、`415` 类型不支持、`404` 不存在或已删

## 关键逻辑
```
upload_file(user, name, mime, size, stream, owner_type?, owner_id?):
  validate_upload(name, mime, size)                 # 413/415
  key = f"{YYYY}/{MM}/{uuid4()}.{ext}"              # 存储键，去重靠 uuid
  await storage.put_object(key, data, mime)
  file = File(id=uuid, owner_type, owner_id, original_name=name,
              stored_key=key, mime_type=mime, size=size, uploaded_by=user.id)
  session.add(file); await commit()
  return FileUploadResp(...)

download(id):
  file = _get_active(id)                             # 缺/软删 → 404
  stream = storage.get_object_stream(file.stored_key)
  disp = "inline" if mime in _INLINE_IMAGE_TYPES else "attachment"   # D-009
  return StreamingResponse(stream, headers={
      "Content-Disposition": f'{disp}; filename*=UTF-8\'\'{quote(name)}'})
```

## 注意事项
- `File.size` 用 `BigInteger`（非默认 Integer），迁移与模型两处都要显式 `sa.BigInteger()`，否则大文件溢出。
- `owner_id` 可空（D-008）：新建业务对象时尚无 id，先传 `owner_type` 上传，落库后再回写；查询/统计不强依赖 owner。
- `file_urls` 字段语义从「URL」改为「文件 id」（D-006）：前端 `FileUpload` 受控值是 id 列表，回显经 `batch-meta` 取文件名；PPM 各业务表字段名不变，仅值含义变。
- 类型白名单在 `settings.file_allowed_type_set`（frozenset），**排除** `text/html`、`image/svg+xml`（防 XSS），新增允许类型改配置不改代码。
- 图片 inline 预览白名单 `_INLINE_IMAGE_TYPES = {jpeg,png,gif,webp}`，其余一律 attachment 强制下载。
- 测试用 `MockStorage`（内存 dict）替身，不依赖真实 MinIO；`conftest` 同时覆盖 `get_session` 与 `get_storage_backend`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
