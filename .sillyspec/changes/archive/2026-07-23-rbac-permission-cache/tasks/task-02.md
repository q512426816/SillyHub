---
id: task-02
title: core/config.py 加 permission_cache_ttl（FR-05）
title_zh: core/config.py 加 permission_cache_ttl 配置项
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P5
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - backend/app/core/config.py
goal: >
  新增 permission_cache_ttl 配置项(默认 300s),供 task-01 helper 设置 Redis key TTL。仿现有 auth_api_key_cache_ttl 写法。
implementation:
  - 在 Settings 类中新增 `permission_cache_ttl: int = 300`(位置紧邻 auth_api_key_cache_ttl,约 L87),支持环境变量 PERMISSION_CACHE_TTL 覆盖
acceptance:
  - settings.permission_cache_ttl 默认 300,可被环境变量覆盖
  - mypy + ruff 通过
verify:
  - cd backend && uv run mypy app/core/config.py
  - cd backend && uv run ruff check app/core/config.py
constraints:
  - 纯配置项新增,不引入新依赖
---

流程位置:Wave 1(基础设施,无依赖)。task-01 运行时读此字段;同 Wave 内先做 task-02 即就位(软依赖,非 depends_on)。
