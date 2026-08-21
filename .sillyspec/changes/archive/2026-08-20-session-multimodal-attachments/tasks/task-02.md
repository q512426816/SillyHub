---
id: task-02
title: implement-content-addressed-attachment-storage
title_zh: MinIO 内容寻址存储接入（sha256 键 + 同哈希复用）
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-1, FR-3]
decision_ids: [D-5]
allowed_paths:
  - backend/app/modules/session_attachment/storage.py
provides:
  - contract: SessionAttachmentStorage
    fields: [store_bytes, object_key_for]
expects_from: {}
goal: >
  封装附件对象存储——按 sha256 内容寻址拼 object_key 经既有 StorageBackend 上传同哈希复用不重传。
implementation:
  - 新建 backend/app/modules/session_attachment/storage.py 定义 SessionAttachmentStorage 构造注入 StorageBackend（复用 modules/storage factory 的 get_storage_backend 依赖注入 不新建 MinIO 实现）
  - object_key_for 按规则拼键 attachments 一级目录加 user_id 二级目录加 sha256 十六进制加点加扩展名 扩展名取展示名后缀白名单化未知或非法回退 bin（防路径穿越 name 不直接进键路径）
  - store_bytes 接收 user_id 与字节与 media_type 与展示名 计算 sha256 拼 object_key 后先 head_object 探测 键已存在则跳过 put_object（不可变内容寻址命中即同内容 D-5 同哈希复用）head 抛不存在异常视为未命中再 put_object
  - 返回 object_key 与 sha256 供调用方建行 内容寻址天然幂等重复 put 无害
acceptance:
  - 同一用户重复上传同内容字节第二次不再触发底层 put_object 且返回相同 object_key
  - 键格式为 attachments 前缀加 user_id 目录加 sha256 点扩展名 同内容同用户键必相同
  - 不同用户上传同内容各自独立键（user_id 隔离）
verify:
  - cd backend && uv run python -c "from app.modules.session_attachment.storage import SessionAttachmentStorage; print(SessionAttachmentStorage)"
  - cd backend && uv run pytest -q
constraints:
  - 只经 StorageBackend 抽象访问 MinIO 禁止直接 import minio 客户端
  - 本文件不建不读 DB 行写行归 task-03 service 层
  - 不删对象不做引用计数（D-5 对象只增不删）
  - 后续测试经 dependency_overrides 注入 mock StorageBackend 不依赖真实 MinIO（NFR-4 惯例）
related_tests: []
---
