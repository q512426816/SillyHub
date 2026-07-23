---
id: task-02
title: permission_cache.py 熔断器状态机 + 4 个读写函数入口插入熔断检查（覆盖：FR-01, FR-02, D-001@v1）
title_zh: 熔断器状态机实现
author: qinyi
created_at: 2026-07-23 16:32:27
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/core/permission_cache.py
goal: >
  在 permission_cache.py 内部实现熔断器三态状态机（CLOSED/OPEN/HALF_OPEN），并在 4 个读写函数入口插入熔断检查，Redis 不可用时快速降级不再等待连接超时。
implementation:
  - 在 permission_cache.py 顶部增加模块级熔断状态变量（_BreakerState：failure_count, state, open_at, 用 time.monotonic() 记录时间）
  - 实现内部函数 _breaker_is_open()：CLOSED→返回 False；OPEN→检查 cooldown 是否超时，超时则转 HALF_OPEN 并返回 True；HALF_OPEN→返回 True（允许一次试探）
  - 实现 _record_failure()：失败计数器 +1，达标则转 OPEN (state='OPEN', open_at=time.monotonic())；threshold=0 不操作
  - 实现 _record_success()：HALF_OPEN 时恢复 CLOSED；CLOSED 时清空 failure_count
  - 在 get_cached_permissions/set_cached_permissions/get_cached_ppm_scope/set_cached_ppm_scope 四个函数的 try 块之前插入 if _breaker_is_open(): return None 或直接 return
  - 在 try 块的第一个 except 条末尾调用 _record_failure()，catch 后原降级位置保持不变
  - 在 try 块成功结束时调用 _record_success()
  - 确保 invalidate_all_permissions 不走熔断检查
acceptance:
  - 连续失败 N 次（threshold=5）后调用 _breaker_is_open() 返回 True
  - 熔断 OPEN 后 get/set 操作直接跳过 Redis 返回 None（不等待）
  - HALF_OPEN 时试探成功恢复 CLOSED，失败重回 OPEN
  - threshold=0 时熔断器始终 CLOSED、始终正常读写 Redis
  - invalidate_all_permissions 不受熔断影响
verify:
  - cd backend && uv run pytest tests/modules/test_permission_cache.py -q --durations=5
constraints:
  - 熔断状态为模块级变量，不进 instance/class
  - 仅 4 个 get/set 读写函数走熔断，invalidate_all_permissions 排除
  - 不修改 rbac.py/data_scope.py/auth_deps.py，熔断是 permission_cache 内部细节
  - 不修改 app/core/redis.py（不影响 publish 等路径）
