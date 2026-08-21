---
id: task-04
title: session-attachment-content-and-delete-endpoints
title_zh: 附件内容流式读取与草稿删除端点
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P1
depends_on: [task-03]
blocks: [task-11]
requirement_ids: [FR-6, FR-8]
decision_ids: [D-5, D-8]
allowed_paths:
  - backend/app/modules/session_attachment/router.py
provides:
  - contract: 附件内容与删除端点
    fields: [id, bytes, media_type, etag, draft_only_delete]
expects_from:
  task-01:
    - contract: SessionAttachment
      needs: [object_key, sha256, user_id, session_id]
  task-03:
    - contract: AttachmentRead
      needs: [id, kind, media_type]
goal: >
  在 task-03 建的附件 router 上新增内容流式读取端点与仅草稿可删的删除端点。
implementation:
  - GET 内容端点按 id 查行并做 user_id 归属校验 不符或不存在一律 404 隐藏存在性（D-8 归属只查 user_id）
  - 归属通过后经 storage backend get_object_stream 流式回字节 行查询在构造响应前完成 不整读进内存（池安全）
  - 响应头带 Cache-Control immutable 与 ETag 等于行内 sha256 不重算内容哈希 请求 If-None-Match 命中时回 304
  - Content-Disposition inline 展示名按 RFC 5987 编码（对齐 file 模块 download_file 先例）
  - DELETE 端点仅 session_id 为空的草稿行可删 删行回 204 不删对象（D-5）
  - 已绑定行删除 → 409 新错误码 HTTP_409_SESSION_ATTACHMENT_BOUND（错误类与 task-03 附件错误同文件定义）
acceptance:
  - 属主读取回 200 字节与上传一致 头含 immutable 与 ETag 为 sha256 If-None-Match 命中回 304
  - 非属主与不存在的读取删除均 404 同语义
  - 草稿删除 204 行消失对象仍在 已绑定删除 409 错误码正确
verify:
  - cd backend && uv run pytest app/modules/session_attachment/tests -q
constraints:
  - 不改 task-03 的 POST 上传端点行为 不做 inject 组装与 session_id 回填（task-05/06 边界）
  - 会话软删后附件仍可读（D-8） 存储对象永不删（D-5）
related_tests: []
---
