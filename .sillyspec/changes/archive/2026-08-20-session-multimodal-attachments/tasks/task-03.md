---
id: task-03
title: add-session-attachment-upload-endpoint
title_zh: 会话附件上传端点（multipart 校验 + AttachmentRead）
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-02]
blocks: [task-04, task-06]
requirement_ids: [FR-1, FR-3, FR-8]
decision_ids: [D-5, D-8]
allowed_paths:
  - backend/app/modules/session_attachment/router.py
  - backend/app/modules/session_attachment/service.py
  - backend/app/modules/session_attachment/schema.py
  - backend/app/modules/session_attachment/__init__.py
  - backend/app/main.py
provides:
  - contract: AttachmentRead
    fields: [id, kind, media_type, bytes, name, width, height]
expects_from: {task-01: [SessionAttachment], task-02: [SessionAttachmentStorage]}
goal: >
  提供 POST /api/daemon/session-attachments 上传端点——multipart 收文件 权威校验限制与类型 经内容寻址存储建行并返回 AttachmentRead。
implementation:
  - 新建 schema.py 定义 AttachmentRead（id kind media_type bytes name width height 七字段 不外泄 object_key 与 sha256）与 kind 表单枚举 image file 新建 service.py 定义模块级限制常量（图片 png jpeg webp gif 白名单单张 5MB 每消息 5 张 / 文件单份 20MB 每消息 5 份）供 task-05 inject 聚合校验复用（FR-8 backend 权威侧）
  - service 上传流程读全量字节先按 kind 校验大小与白名单图片经 PIL 打开读取宽高并 verify 格式（magic 真实性）非图片魔数嗅探不符拒 415 超限抛 AppError 413（惯例同 file 模块）校验通过调 SessionAttachmentStorage 的 store_bytes 得 object_key 与 sha256 建行（session_id 置 null 草稿语义 name 剥本地路径只留文件名）提交后组 AttachmentRead 同哈希重复上传新建行复用同 object_key（D-5）
  - 新建 router.py 取 APIRouter prefix 为 daemon/session-attachments tags 为 session-attachments 挂 POST 根路径 multipart file 加 kind 表单字段 鉴权 Depends get_current_user response_model AttachmentRead status 201（先例见 file/router.py）并在 backend/app/main.py 既有挂载区加 import 与 include_router prefix 为 api 两行（照 daemon_router 挂载先例）新建空 __init__.py 保持包结构
acceptance:
  - png 上传成功 201 返回 AttachmentRead 含 width height 其余字段齐
  - 超 5MB 图片 413 声明 png 实为文本的伪造图片 415 黑名单图片类型 415 超 20MB 文件 413 未登录 401
  - 同内容重复上传两次得两个 id 与相同 object_key 的两行（对象复用新行）
verify:
  - cd backend && uv run pytest -q
  - cd backend && uv run python -c "from app.modules.session_attachment.router import router; print([r.path for r in router.routes])"
constraints:
  - 每消息 5 张与 5 份的计数校验不在本端点做（单次上传单文件）由 task-05 inject 聚合校验 本卡只落共享常量
  - 不实现 GET content 与 DELETE（归 task-04）不改 daemon 既有 router.py 挂载走 main.py 新增 include
  - magic 校验必须基于字节内容不得信任请求 content_type 头 AttachmentRead 字段集即对外契约前端类型经 pnpm gen:types 生成归 task-11
related_tests: []
---
