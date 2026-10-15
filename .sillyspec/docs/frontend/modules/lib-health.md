---
schema_version: 1
doc_type: module-card
module_id: lib-health
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 健康检查客户端（lib-health）

## 定位
后端 health 模块的前端 API 客户端，极薄。封装 `GET /api/health`、`GET /api/system-status`、`GET /api/server-logs` 与 `/api/server-logs/download` 四接口，类型从 OpenAPI 生成（`HealthResponse` / `SystemStatusResponse` / `ServerLogsResponse`，经 `pnpm gen:types` 产出）。消费方为 `/settings` 设置页（依赖存活与版本信息）与 `/admin/server-status` 服务器信息页（性能/依赖两卡 + ServerLogPanel 日志卡，2026-10-15-server-logs-panel 起业务统计卡已删）。

## 契约摘要
- `getHealth(): Promise<HealthResponse>` — 无参 GET `/api/health`（公开端点），响应直接透传。
- `getSystemStatus(): Promise<SystemStatusResponse>` — 无参 GET `/api/system-status`，**需登录且持 `system_status:read` 权限**（2026-10-14-admin-server-status D-001@v2 由公开收紧，platform:admin 直通）；403 抛 ApiError、401 走全局拦截。
- `getServerLogs(lines: number): Promise<ServerLogsResponse>` — GET `/api/server-logs?lines=`（白名单 {100,200,500,1000} 非白名单回退 200），2026-10-15-server-logs-panel task-03；类型引用生成物（ServerLogsResponse/LogEntry），同权限门控。
- `downloadLogFile(name: string): Promise<void>` — GET `/api/server-logs/download?file=`，裸 fetch 带 Bearer 取 Blob（401 单飞刷新重试一次，同 explorer.ts 先例）→ objectURL → `a[download]` 触发下载；文件名白名单（backend.log/.1/.2/.3）由后端硬校验。
- `HealthResponse` / `SystemStatusResponse` 字段见后端生成 schema；`ServerLogsResponse` = `{file, entries[{time,level,event,fields}|{raw,parse_error}], total_lines, returned, available_files[{name,size,mtime}], hint}`。

## 关键逻辑
```
getHealth() = apiFetch("/api/health")                      // 公开，无需鉴权
getSystemStatus() = apiFetch("/api/system-status")         // Bearer 经 apiFetch 自动携带
getServerLogs(n) = apiFetch("/api/server-logs", {query:{lines:n}})
downloadLogFile(name) = fetch(Bearer) → 401 单飞刷新重试 → blob → a[download]
// getHealth/getSystemStatus/getServerLogs 均无缓存无状态；刷新节奏由调用方组件控制
```

## 注意事项
- `getSystemStatus()` 曾于 2026-07-24 死代码清理中被删（随首页看板），2026-10-14-admin-server-status task-02 随服务器信息页恢复——历史卡「已不存在」的描述作废。
- 类型从 OpenAPI 生成，勿手写结构；后端 health schema 改动经 `pnpm gen:types` 暴露漂移（日志端点契约变更时须双端再生成——frontend + sillyhub-daemon，闸门⑨）。
- `/api/health` 保持公开（负载均衡语义）；其余三接口已收紧——新消费方必须考虑 403 降级。
- 下载走 fetch+Blob 而非 apiFetch（后者只处理 JSON）；JWT 鉴权下裸 URL 直连会 401。
- 展示失败时走通用 `errMessage`（lib-errors），本模块不做错误翻译。
- `status="degraded"` 语义是「任一依赖 down」而非整站不可用；UI 应区分总体状态与依赖明细。
- `version`/`commit_sha`/`environment` 可用于核对实际部署的构建标识，与部署流程（COMMIT_SHA build arg）对账。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
