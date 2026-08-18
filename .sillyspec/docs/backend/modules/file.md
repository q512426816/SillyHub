---
schema_version: 1
doc_type: module-card
module_id: file
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 文件中心（file）

## 定位
平台级对象存储文件中心：独立 `file` 元数据表 + 统一上传/下载/列表/元数据/批量元数据/软删接口。需要附件的业务（PPM 问题清单、计划、看板等）与 agent 产物都走本中心，业务表只存文件 id（`file_urls: string[]` 值为 id 列表），不存裸 URL。存储能力经 `storage` 抽象层（默认 MinIO），不直接耦合实现。

## 契约摘要
- `POST /api/file/upload` — multipart 上传，可选 query `owner_type`/`owner_id`，201 返回 `FileUploadResp(id/original_name/mime_type/size)`。
- `GET /api/file/{id}` — 下载/预览；图片白名单 `Content-Disposition: inline`，其余 `attachment`；中文文件名走 RFC 5987 `filename*=UTF-8''{quote(name)}`。
- `GET /api/file/list` — 按 owner 维度列文件（登录用户按 workspace 读权限过滤：`allowed_workspace_ids(user, WORKSPACE_READ)` 集合内 owner_id）。
- `GET /api/file/{id}/meta` / `POST /api/file/batch-meta`（body ids，上限 200，跳过软删项）— 元数据回显。
- `DELETE /api/file/{id}` — 软删（204），删除后再访问 404。
- `FileService(session, storage, settings)`：`validate_upload`（超限 413 `file_too_large` / 类型不在白名单 415 `file_type_not_allowed`）/ `upload_file` / `get_stream` → (File, AsyncIterator[bytes]) / `get_meta` / `batch_meta` / `list_files` / `soft_delete`；访问校验 `_can_access`（属主或工作区成员）。
- `File` 模型：id / owner_type / owner_id（可空）/ original_name / stored_key（唯一）/ mime_type / size（BigInteger）/ uploaded_by / created_at / deleted_at。
- 表名 `file`（单数）。

## 关键逻辑
```
upload: validate_upload → key = f"{YYYY}/{MM}/{uuid4()}.{safe_ext}"
        → storage.put_object → 落库 File → FileUploadResp
download: _get_active_for(user)（缺/软删/无权 → 404）
        → storage.get_object_stream(stored_key)
        → disp = inline if mime in _INLINE_IMAGE_TYPES else attachment
```

## 注意事项
- `File.size` 用 BigInteger，迁移与模型两处都要显式 `sa.BigInteger()`，否则大文件溢出。
- `owner_id` 可空：新建业务对象尚无 id 时先带 `owner_type` 上传，落库后回写；查询/统计不强依赖 owner。
- 类型白名单在 `settings.file_allowed_type_set`（frozenset），排除 `text/html`、`image/svg+xml`（防 XSS）；增放类型改配置不改代码。
- inline 预览白名单 `_INLINE_IMAGE_TYPES = {jpeg,png,gif,webp}`，其余一律 attachment 强制下载。
- `file_urls` 字段值语义是文件 id 而非 URL：前端受控值为 id 列表，回显经 batch-meta 取文件名；PPM 各业务表字段名不变仅值含义变。
- 访问控制：meta/download/batch/list 均过 `_can_access`/`allowed_workspace_ids`，跨 owner 访问按工作区读权限收敛。
- 测试用 `MockStorage`（内存 dict）替身，conftest 同时替换 `get_session` 与 `get_storage_backend`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
