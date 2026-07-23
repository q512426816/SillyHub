---
author: qinyi
created_at: 2026-07-23 16:35:30
change: 2026-07-23-backend-permission-perf
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 调用 `has_permission` / `data_scope` 热路径的后端代码 |
| 运维/排障 | 需要关闭熔断器做精确缓存验证 |

## 功能需求

### FR-01: 熔断器正常降级

覆盖决策：D-001@v1

Given Redis 不可用（未启动/网络不通/超时）
When `get_cached_permissions` 或 `set_cached_permissions` 或 `get_cached_ppm_scope` 或 `set_cached_ppm_scope` 被调用
Then 前连续失败 N 次（N=threshold）内仍重试 Redis 并降级（每次 ~3s 超时），从第 N+1 次起直接返回 None（读）或跳过（写），不碰 Redis

### FR-02: 熔断器自动恢复

覆盖决策：D-001@v1

Given 熔断器处于 OPEN（断开）状态
When 距离 `open_at` 已过 cooldown_seconds 秒，且缓存层再次被调用
Then 熔断器进入 HALF_OPEN 状态，允许 1 次试探性 Redis 操作
- 操作成功 → 恢复 CLOSED
- 操作失败 → 重回 OPEN，cooldown 重置

### FR-03: 熔断器可禁用

覆盖决策：D-003@v1

Given `permission_cache_breaker_threshold=0`
When 任何缓存操作
Then 熔断器持续 CLOSED，不检查失败计数，正常读写 Redis

### FR-04: 熔断器不影响失效操作

覆盖决策：D-002@v1

Given 熔断器处于 OPEN
When `invalidate_all_permissions` 被调用
Then 失效操作正常执行（不走熔断检查），尝试 Redis 操作

## 非功能需求

- 兼容性：熔断器只在 permission_cache.py 内部生效，对外接口无变化
- 可回退：设 threshold=0 可禁用熔断器，恢复升级前行为
- 可测试：熔断器测试不依赖外部 Redis，用 mock 或直接操作熔断状态变量验证

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 熔断降级与自动恢复 |
| D-002@v1 | FR-04 | 排除 invalidate_all_permissions |
| D-003@v1 | FR-03 | threshold=0 禁用熔断器 |
