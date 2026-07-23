---
id: task-01
title: config.py 新增熔断器配置项（覆盖：D-003@v1）
title_zh: 新增熔断器配置项
author: qinyi
created_at: 2026-07-23 16:32:27
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/core/config.py
goal: >
  在 config.py 的 Settings 类中新增两个熔断器配置字段，使熔断阈值和冷却时间可通过环境变量/配置文件调节。
implementation:
  - 在 Settings 类中 auth_* 配置段后新增 permission_cache_breaker_threshold (int, Field(5, ge=0, le=100)) 和 permission_cache_breaker_cooldown (int, Field(30, ge=0, le=3600)) 两个字段
  - 与已有 permission_cache_ttl 配置相邻，保持命名一致（permission_cache_breaker_ 前缀）
  - 添加中文 Field description 说明字段用途和默认值语义
acceptance:
  - 环境变量 `PERMISSION_CACHE_BREAKER_THRESHOLD=0` 后 get_settings().permission_cache_breaker_threshold == 0
  - 环境变量 `PERMISSION_CACHE_BREAKER_COOLDOWN=60` 后 get_settings().permission_cache_breaker_cooldown == 60
  - 默认值验证（5, 30）
verify:
  - cd backend && uv run python -c "from app.core.config import get_settings; s=get_settings(); assert s.permission_cache_breaker_threshold==5; assert s.permission_cache_breaker_cooldown==30; print('OK')"
constraints:
  - ge=0：threshold=0 时禁用熔断器，cooldown=0 时不自动恢复
  - 字段名使用 permission_cache_breaker_ 前缀，与已有 permission_cache_ttl 一致
