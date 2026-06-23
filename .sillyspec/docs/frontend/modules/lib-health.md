---
schema_version: 1
doc_type: module-card
module_id: lib-health
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-health

## 定位
系统健康与资源监控的前端 API 客户端，全局域（非工作空间）。提供后端依赖健康检查与主机资源指标两项查询，供首页/状态卡片展示。对应 `/api/health` 与 `/api/system-status`。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `getHealth()` | 取后端依赖健康状态 | GET `/api/health` |
| `getSystemStatus()` | 取主机 CPU/内存/磁盘/业务计数等指标 | GET `/api/system-status` |

类型：
- `DependencyStatus`（ok/down）、`OverallStatus`（ok/degraded）。
- `HealthResponse`：`overall` + 依赖项 map（`dependencies: Record<string, {status: DependencyStatus; ...}>`，字段以源码为准）。
- `SystemStatus`：`server_time`、`cpu_percent`、`memory_percent`、`memory_used_mb/total_mb`、`disk_percent`、`disk_used_gb/total_gb`、`tasks`、`projects`、`milestones`、`users`。

## 关键逻辑
```
两个端点均为无参 GET，无 query
返回直接透传后端 JSON
```

## 注意事项
- `getHealth` 用于首页 ServerStatusCard 显示后端及各依赖（DB/Redis 等）存活。
- `getSystemStatus` 含主机资源占用与业务实体计数（任务/项目/里程碑/用户），需注意这些计数是全局而非工作空间级。
- 轮询刷新由调用方（组件）控制，本模块不发心跳。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
