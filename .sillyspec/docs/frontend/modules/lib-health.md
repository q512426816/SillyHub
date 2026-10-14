---
schema_version: 1
doc_type: module-card
module_id: lib-health
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 健康检查客户端（lib-health）

## 定位
后端健康检查的前端 API 客户端，极薄。封装 `GET /api/health` 与 `GET /api/system-status` 两函数，类型从 OpenAPI 生成（`HealthResponse` / `SystemStatusResponse`，后端 `health/schema.py`，经 `pnpm gen:types` 产出）。消费方为 `/settings` 设置页（依赖存活与版本信息）与 `/admin/server-status` 服务器信息页（性能/统计/依赖三卡，2026-10-14-admin-server-status 起）。

## 契约摘要
- `getHealth(): Promise<HealthResponse>` — 无参 GET `/api/health`（公开端点），响应直接透传。
- `getSystemStatus(): Promise<SystemStatusResponse>` — 无参 GET `/api/system-status`，**需登录且持 `system_status:read` 权限**（2026-10-14-admin-server-status D-001@v2 由公开收紧，platform:admin 直通）；403 抛 ApiError、401 走全局拦截。
- `HealthResponse` 字段：`status` / `db` / `redis` / `version` / `commit_sha` / `server_time` / `environment`。
- `SystemStatusResponse` 字段：`server_time` + `cpu_percent` / `memory_percent` / `memory_used_mb` / `memory_total_mb` / `disk_percent` / `disk_used_gb` / `disk_total_gb` + 业务计数 `tasks` / `projects` / `milestones` / `users`。

## 关键逻辑
```
getHealth() = apiFetch("/api/health")            // 公开，无需鉴权
getSystemStatus() = apiFetch("/api/system-status") // Bearer 经 apiFetch 自动携带
// 均无缓存、无轮询、无状态；刷新节奏完全由调用方组件控制
```

## 注意事项
- `getSystemStatus()` 曾于 2026-07-24 死代码清理中被删（随首页看板），2026-10-14-admin-server-status task-02 随服务器信息页恢复——历史卡「已不存在」的描述作废。
- 类型从 OpenAPI 生成，勿手写结构；后端 health schema 改动经 `pnpm gen:types` 暴露漂移。
- `/api/health` 保持公开（负载均衡语义）；`/api/system-status` 已收紧——新消费方必须考虑 403 降级。
- 展示失败时走通用 `errMessage`（lib-errors），本模块不做错误翻译。
- `status="degraded"` 语义是「任一依赖 down」而非整站不可用；UI 应区分总体状态与依赖明细。
- `version`/`commit_sha`/`environment` 可用于核对实际部署的构建标识，与部署流程（COMMIT_SHA build arg）对账。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
