---
id: task-06
title: 后端测试
title_zh: 后端 file 模块测试（router/service + StorageBackend mock 注入）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [NFR-4]
decision_ids: []
allowed_paths:
  - backend/app/modules/file/tests/test_service.py
  - backend/app/modules/file/tests/test_router.py
  - backend/app/modules/file/tests/conftest.py
goal: >
  为 file 模块补 router/service 单测，用 dependency_overrides 注入 mock StorageBackend，覆盖上传/下载/batch-meta/软删与 413/415/D-009 安全契约。
implementation:
  - conftest.py 提供 mock StorageBackend fixture（fake put/get/delete/head）+ app.dependency_overrides 覆盖 get_storage_backend
  - test_service：上传存对象+落库、batch_meta、软删（已删不可读）
  - test_router：POST /upload 成功返回 FileUploadResp、超限 413、类型不符 415
  - test_router：GET /{id} 图片白名单 inline、svg/html 强制 attachment（断 Content-Disposition，不绑死 SQL 函数名）
  - 不依赖真实 MinIO（全 mock）
acceptance:
  - file 模块单测全绿（mock StorageBackend，不连真实 MinIO）
  - 413/415/Content-Disposition 安全契约被断言覆盖
  - 软删除后 GET 返回不可读/404
verify:
  - cd backend && uv run pytest app/modules/file -q --no-cov
  - cd backend && uv run ruff check app/modules/file/tests
constraints:
  - 测试逻辑本身有误才改测试；非此情况禁止改测试“通过”
  - 断言不绑死 SQL 方言函数名（SQLite 测 / PG 生产）
  - 模块级时间常量坑：断言用 test 内 datetime.now()，不用模块级 NOW
---
