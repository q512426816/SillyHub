---
schema_version: 1
doc_type: module-card
module_id: health
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 健康检查与系统状态（health）

## 定位
后端「健康检查与系统状态」：轻量探针 + 版本信息 + 首页运行状态看板聚合。无业务写逻辑、无鉴权（公开端点），供前端 / daemon / 容器编排探活。三个端点全部只读低开销。

## 契约摘要
- `GET /api/health` → HealthResponse：status（ok/degraded）+ db + redis 子状态 + version + commit_sha（settings.resolved_commit_sha）+ server_time + environment。**依赖降级时仍返回 HTTP 200**（负载均衡不摘 pod，告警按 status="degraded" 触发）。
- `GET /api/version` → VersionResponse：version / commit_sha / environment。
- `GET /api/system-status` → SystemStatusResponse：psutil 性能快照（cpu_percent / memory_* / disk_*，经 `anyio.to_thread.run_sync` 丢线程池防阻塞事件循环）+ PPM 业务计数（tasks / projects / milestones / users）。公开端点，首页看板消费。
- 内部探针：`_check_db`（session factory 执行 SELECT 1）、`_check_redis`（client.ping），异常吞掉记 warning 返回 "down"，不抛。

## 关键逻辑
```
GET /health → _check_db + _check_redis
  → 双 ok = "ok"，任一 down = "degraded"（仍 200）
GET /system-status → psutil 快照(to_thread) + 4 张表 count 聚合
```

## 注意事项
- 200-always 是刻意设计（router 模块 docstring 明确）：健康端点抛 500 会让负载均衡/编排误摘实例；新增依赖探针沿用降级语义（status=degraded + 200）。
- 探针失败只记 warning（health.db.down / health.redis.down）不抛异常，单个依赖故障不影响其它子状态返回。
- 端点无鉴权，严禁在此暴露敏感信息（内部路径、密钥状态、配置值）；system-status 的业务计数只暴露聚合计数（tasks/projects/milestones/users 四表 count）。
- psutil 快照必须留在 `anyio.to_thread.run_sync`（CPU percent 采集有阻塞风险），不要改成事件循环内直调。
- commit_sha 取 `settings.resolved_commit_sha`（构建期注入），版本对不上先查部署镜像的 build arg 传递。
- 消费方：前端首页看板（system-status）、daemon HTTP 探活、容器 healthcheck；Docker 部署时前端 healthcheck 经 Next 代理打后端，探针误报先查代理 no_proxy 配置。
- system-status 的 perf 里磁盘取根目录 `/`——容器内是容器文件系统视角，与宿主机数字不同属正常。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
