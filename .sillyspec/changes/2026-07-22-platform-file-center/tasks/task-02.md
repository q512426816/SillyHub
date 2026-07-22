---
id: task-02
title: storage 配置+抽象层
title_zh: 后端存储配置 + aiobotocore 依赖 + StorageBackend 抽象层
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: []
blocks: [task-03, task-04]
requirement_ids: []
decision_ids: [D-001, D-002]
allowed_paths:
  - backend/app/core/config.py
  - backend/.env.example
  - backend/pyproject.toml
  - backend/app/modules/storage/base.py
  - backend/app/modules/storage/minio_backend.py
  - backend/app/modules/storage/factory.py
goal: >
  加 storage 配置与 aiobotocore 依赖，建 StorageBackend 抽象层（base/minio/factory），FastAPI lifespan 单例 + Depends 注入。
provides:
  - contract: StorageBackend
    fields: [put_object, get_object_stream, delete_object, head_object]
implementation:
  - pyproject.toml 加 aiobotocore（版本与现有 httpx/aiohttp 异步栈对齐，以 spike-01 结论为准）
  - config.py 加 storage_backend(默认 minio)、s3_endpoint、s3_access_key、s3_secret_key、s3_bucket、s3_region、file_max_size_mb(默认 50)、file_allowed_types；.env.example 同步
  - storage/base.py 定义 StorageBackend ABC（put_object/get_object_stream/delete_object/head_object）
  - storage/minio_backend.py 用 aiobotocore 实现 MinioStorage（S3 异步客户端）
  - storage/factory.py 提供 get_storage_backend() 读 config.storage_backend 返回实现
  - FastAPI app lifespan 创建 MinioStorage 单例，Depends(get_storage_backend) 注入
acceptance:
  - StorageBackend ABC 定义四个抽象方法，MinioStorage 全部实现
  - factory 按 config 返回 minio 实现，lifespan 单例可被 Depends 注入
  - 配置项齐全且 .env.example 同步
verify:
  - cd backend && uv run ruff check app/modules/storage app/core/config.py
  - cd backend && uv run python -c "import app.modules.storage.base, app.modules.storage.factory, app.modules.storage.minio_backend"
constraints:
  - 测试用 app.dependency_overrides 注入 mock StorageBackend，不 monkeypatch factory
  - 改 config.py 不破坏现有配置项（brownfield 兼容，新项给默认值）
  - aiobotocore 版本锁定以 spike-01 为准，避免依赖冲突
---
