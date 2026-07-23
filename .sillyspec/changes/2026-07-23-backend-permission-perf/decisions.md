---
author: qinyi
created_at: 2026-07-23 16:28:00
change: 2026-07-23-backend-permission-perf
---

# 决策台账（Decision Log）— 权限缓存熔断降级

## D-001@v1: 问题归属与修复方向

- **type**: premise | architecture
- **status**: accepted
- **source**: user + 实测探针
- **question**: 权限/数据范围慢路径的根因是什么，归哪个变更修？
- **answer**: 非 N+1。实测 `is_super_admin`/`manager_project_ids` 各仅 2 条查询（SQL~1ms），总耗时 6s——慢在 `permission_cache` 对 Redis 的 `socket_connect_timeout=3s×2`（读写各一次）。用户决定：并入本变更做通用熔断降级，不依赖 rbac-cache 变更。
- **normalized_requirement**: permission_cache 对 Redis 连接失败应快速降级（<100ms），不等待操作系统超时
- **impacts**: §1 背景、§4 总体方案、config.py 配置项新增、permission_cache.py 熔断逻辑
- **evidence**: `/tmp/perf_probe.py` 实测 data_scope 调用 6030ms 中 SQL 仅 1.3ms；`permission_cache.ppm_scope_read_failed/write_failed` warning 日志每调用写两次；`redis.py` `socket_connect_timeout=3` 配置确认
- **priority**: P0

## D-002@v1: 熔断作用域排除 invalidate_all_permissions

- **type**: boundary
- **status**: accepted
- **source**: design 自审
- **question**: 缓存失效操作是否也走熔断？
- **answer**: `invalidate_all_permissions` 不走熔断。失效是安全事件（D-002@v2 of rbac-cache: 失效失败升 ERROR 告警），即使 Redis 正在抖动也应尽量执行；且失效只在权限变更时调用，频率极低，3s 等待可接受。
- **normalized_requirement**: 熔断检查点只插入四个 get/set 读写函数，不插入 `invalidate_all_permissions`
- **impacts**: §4.5、permission_cache.py 实现
- **evidence**: 设计师设计决策
- **priority**: P1

## D-003@v1: 熔断器可禁用

- **type**: config
- **status**: accepted
- **source**: design 自审
- **question**: 是否有办法关闭熔断器？
- **answer**: `permission_cache_breaker_threshold=0` 禁用熔断器。测试环境若需精确验证缓存行为可关闭；生产调优也可关闭。
- **normalized_requirement**: config.py 新增 `permission_cache_breaker_threshold`，ge=0，0=禁用
- **impacts**: §4.3、config.py 实现
- **evidence**: 设计师设计决策
- **priority**: P2
