---
schema_version: 1
doc_type: module-card
module_id: lib-health
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 健康检查客户端（lib-health）

## 定位
后端健康检查的前端 API 客户端，极薄（源文件 11 行）。单一函数封装 `GET /api/health`，类型从 OpenAPI 生成（`HealthResponse`，后端 `health/schema.py`，经 `pnpm gen:types` 产出）。消费方为 `/settings` 设置页（后端依赖存活与版本信息展示）。

## 契约摘要
- `getHealth(): Promise<HealthResponse>` — 无参 GET `/api/health`，响应直接透传，无 query / 无 body。
- `HealthResponse` = `components["schemas"]["HealthResponse"]`（生成版再导出），字段：
  - `status: "ok" | "degraded"` — `ok` 当且仅当所有依赖报 ok；
  - `db: "ok" | "down"`、`redis: "ok" | "down"` — 依赖存活；
  - `version` / `commit_sha` — 后端构建标识；
  - `server_time`（ISO 时间）、`environment`（运行环境名）。

## 关键逻辑
```
getHealth() = apiFetch("/api/health")
// 无缓存、无轮询、无状态；刷新节奏完全由调用方组件控制
```

## 注意事项
- **旧卡描述的 `getSystemStatus()`（CPU/内存/业务计数，`/api/system-status`）已不存在**于本文件——按旧卡找函数会扑空；当前模块仅剩 `getHealth`。
- 类型已迁 OpenAPI 生成，勿手写 HealthResponse 结构；后端 health schema 改动经 `pnpm gen:types` 暴露漂移。
- 该端点用于登录后的设置页展示；未登录探活/部署验证不在此模块（backend 侧另有公开语义，前端不封装）。
- 展示失败时走通用 `errMessage`（lib-errors），本模块不做错误翻译。
- `status="degraded"` 语义是「任一依赖 down」而非整站不可用（db/redis 明细字段区分单点故障）；UI 应区分总体状态与依赖明细，勿把 degraded 一律渲染成「后端挂了」。
- `version`/`commit_sha`/`environment` 可用于设置页核对实际部署的构建标识，与部署流程（COMMIT_SHA build arg）对账。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
