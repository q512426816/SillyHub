---
schema_version: 1
doc_type: module-card
module_id: health
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# health

## 定位
后端「健康检查与系统状态」功能域：对外暴露轻量探针端点，供前端、daemon、容器编排（Docker healthcheck）探测后端存活，并报告关键依赖（DB/Redis）状态与版本信息。无业务逻辑，只读、低开销。

## 契约摘要
- API（tag=health）：`GET /api/health`（健康度，含 DB/Redis 子状态）、`GET /api/version`（版本信息）、`GET /api/system-status`（系统状态聚合）。
- `HealthResponse` / `VersionResponse` / `SystemStatusResponse`：响应 schema。
- 内部探针：`_check_db()` / `_check_redis()` 返回 `DependencyStatus`。

## 关键逻辑
```
GET /health → 并行 _check_db / _check_redis → 聚合成 HealthResponse
GET /version → 返回应用版本号
GET /system-status → 聚合性能/依赖快照(_perf)
```

## 注意事项
- 健康端点必须低开销且不依赖业务模块，DB/Redis 探针失败应降级为「degraded」而非 500 崩溃，避免编排误判。
- Docker frontend healthcheck 经代理访问后端；探针误报需结合 no_proxy 配置排查（见 memory 记录）。
- 该端点无鉴权，不要在此暴露敏感信息（如内部路径、密钥状态）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
