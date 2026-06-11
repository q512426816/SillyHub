---
schema_version: 1
doc_type: module-card
module_id: lib-health
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-health

## 定位
Health Check API 客户端。

## 契约摘要
- `getHealth()` — 获取后端健康状态
- 类型：HealthResponse（status/db/redis/version/commit_sha/server_time/environment）
- 类型：DependencyStatus（"ok" | "down"）、OverallStatus（"ok" | "degraded"）

## 关键逻辑
- 调用 `/api/health` 端点
- 用于首页健康卡片展示

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
