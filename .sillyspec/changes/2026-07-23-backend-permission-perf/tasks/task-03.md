---
id: task-03
title: test_permission_cache.py 新增熔断器单元测试（覆盖：FR-03, FR-04）
title_zh: 熔断器单元测试
author: qinyi
created_at: 2026-07-23 16:32:27
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/tests/modules/test_permission_cache.py
goal: >
  为熔断器新增单元测试，覆盖三态切换、threshold=0 禁用、invalidate 排除，测试不依赖外部 Redis（mock 或直接操作熔断状态变量）。
implementation:
  - 在 test_permission_cache.py 末尾新增熔断器测试类 TestBreaker
  - 测试前 reset 熔断器状态（直接赋值 _BreakerState dict）
  - 测试 1（test_breaker_closed_by_default）：熔断器默认 CLOSED，失败计数为 0
  - 测试 2（test_breaker_opens_after_threshold）：连续 failure_count >= threshold 后 state 切换为 OPEN
  - 测试 3（test_breaker_open_skips_redis）：熔断 OPEN 后 get_cached_permissions 返回 None（mock redis.get 确保不被调用）
  - 测试 4（test_breaker_half_open_recovers）：HALF_OPEN 时成功操作恢复 CLOSED
  - 测试 5（test_breaker_half_open_fails_back_to_open）：HALF_OPEN 时失败重回 OPEN
  - 测试 6（test_breaker_threshold_zero_disabled）：threshold=0 时失败不触发熔断（state 始终 CLOSED）
  - 测试 7（test_breaker_does_not_affect_invalidate）：熔断 OPEN 时 invalidate_all_permissions 仍尝试 Redis（mock verify 调用）
  - 测试通过覆盖所有熔断路径
acceptance:
  - 7 个熔断器测试全部通过
  - 测试不连接外部 Redis（mock redis.get/set 或被断言的权限缓存操作不触发 socket 调用）
  - 与已有测试无冲突
verify:
  - cd backend && uv run pytest tests/modules/test_permission_cache.py::TestBreaker -v --no-header
constraints:
  - 熔断状态是模块级变量，测试间必须 reset，避免状态泄漏
  - 不依赖外部 Redis，用 mock 或直接操作 _BreakerState
  - 不修改已有测试逻辑，只新增 TestBreaker 类
