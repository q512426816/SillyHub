---
author: qinyi
created_at: 2026-07-23 16:35:00
change: 2026-07-23-backend-permission-perf
---

# 提案书（Proposal）

## 动机

rbac-permission-cache 变更给热路径加了 Redis 缓存，但 Redis 不可用时（测试环境无 Redis、生产偶发抖动），每次缓存操作等 `socket_connect_timeout=3s` 才降级。实测一个 `is_super_admin` 调用慢在缓存层等待（6,030ms 中 SQL 仅 1.3ms），导致全量测试 50 分钟中的可观比例花在白等上。

## 关键问题

1. **降级太慢**：当前 try/except 范式能兜住 Redis 故障不报错，但降级前要等 3s 连接超时，不是快速降级。
2. **重复等待**：每个用户/每次调用都等 3s，N 个用户就等 3s×N，在测试和批量场景下放大严重。
3. **生产也受影响**：生产 Redis 偶尔抖动时，虽然最终降级了但请求会变慢，用户感知到延迟。

## 变更范围

- 在 `permission_cache.py` 中加进程级熔断器（闭合/断开/半开三态）
- 在 `config.py` 加 2 个配置项（threshold/cooldown）
- 在 `test_permission_cache.py` 加熔断器单元测试

## 不在范围内

- 不改 redis 客户端本身的超时配置
- 不改 rbac.py/data_scope.py/auth_deps.py
- 不改 invalidate_all_permissions
- 不引入第三方熔断依赖
- 不做分布式熔断状态同步

## 成功标准

- Redis 不存在时，缓存读/写在毫秒级返回 None/miss，不阻塞
- 熔断器在连续失败 N 次后打开，打开后完全跳过 Redis
- Redis 恢复后，熔断器自动恢复（半开试探）
- 测试无 Redis 时，原本 6~76s 的慢测试回到 1s 内
- threshold=0 可禁用熔断器
