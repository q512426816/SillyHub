---
schema_version: 1
doc_type: module-card
module_id: health
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 健康检查（health）

## 定位
健康检查、版本信息与系统状态看板端点。面向 Docker healthcheck / 负载均衡探针 / 前端首页运行状态看板，是全后端最轻量的只读模块：仅 router.py + schema.py，无 service / model / tests 目录，不定义任何表。

## 契约摘要
- `GET /api/health` → `HealthResponse`：`status`（OverallStatus：ok/degraded）+ `db` + `redis`（DependencyStatus：ok/down）+ `version`（app.__version__）+ `commit_sha`（settings.resolved_commit_sha）+ `server_time`（UTC）+ `environment`。
- `GET /api/version` → `VersionResponse`：`version` / `commit_sha` / `environment` 三字段。
- `GET /api/system-status` → `SystemStatusResponse`（公开，首页看板用）：psutil 服务器性能（cpu_percent / memory_percent/used_mb/total_mb / disk_percent/used_gb/total_gb）+ 业务统计四计数（tasks=PlanTask / projects=PpmProjectMaintenance / milestones=PsPlanNode / users=User）+ server_time。
- 三端点均无鉴权依赖。

## 关键逻辑
```
db    = await _check_db()     # SELECT 1（async session factory，异常→down+warning 日志）
redis = await _check_redis()  # client.ping()（异常→down）
overall = ok if db==ok and redis==ok else degraded   # 恒 HTTP 200
system_status: _perf() psutil 采样 → anyio.to_thread（不阻塞事件循环）
               + 四表 func.count）同一 session 内并发统计
```

## 注意事项
- health 刻意在依赖降级时仍返回 **HTTP 200 + `status="degraded"`**：负载均衡保住 pod、告警靠状态字段——不要改成非 200。
- 三端点都不要加鉴权：Docker healthcheck 与探针没有登录态，加鉴权会 401 打挂探活。
- system-status 对 `auth.model.User` 与 ppm 三个 model 是**函数级延迟 import**，避免启动期把 auth/ppm 拖进依赖链；改统计口径同步维护这些 import。
- `_check_db` / `_check_redis` 捕获一切异常记 structlog warning（`health.db.down` / `health.redis.down`）后返回 down，探活自身永不抛 500。
- system-status 的磁盘统计挂的是 `/`（容器根），不是宿主机盘——看板数值解读时注意容器视角。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
