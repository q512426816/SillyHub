---
schema_version: 1
doc_type: module-card
module_id: health
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# health
## 定位
健康检查与版本信息端点。面向探针/运维，提供数据库、Redis 连通性检查及构建信息。轻量只读模块，仅依赖 core。
## 契约摘要
- `GET /api/health` → `HealthResponse`：聚合 `_check_db()` + `_check_redis()`，返回各依赖状态（healthy/degraded）。
- `GET /api/version` → `VersionResponse`：返回 commit_sha、environment 等 build 元数据（来自 Settings）。
- `GET /api/system-status` → `SystemStatusResponse`：系统级汇总状态（延迟 import ppm.plan/project model 拼装业务侧信息）。
## 关键逻辑
```
health = HealthResponse(status="healthy")
db = await _check_db()       # SELECT 1
redis = await _check_redis() # PING
任一失败 → status="degraded"
```
## 注意事项
- health/version 端点不鉴权，供 Docker healthcheck / 负载均衡探针使用，保持低开销。
- system_status 对 ppm 的引用是函数级延迟 import，避免启动期循环依赖。
- 改动注意不要引入鉴权，否则探针会 401。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
