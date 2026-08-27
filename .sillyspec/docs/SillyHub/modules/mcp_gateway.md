---
schema_version: 1
doc_type: module-card
module_id: mcp_gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 对外 MCP 服务网关（mcp_gateway）

## 定位
对外 MCP（Model Context Protocol）服务网关：以 FastMCP 实例 `sillyhub-public`（streamable HTTP transport）挂载 `/mcp`，让第三方编排者（外部 MCP client）经 `shmcp_` token 派发 worker、推进变更阶段、收任务事件。附带 McpToken / McpWebhook 管理端点与 mission 级 SSE 事件流。与 `/api` 的 JWT 鉴权通道物理隔离。

## 契约摘要
- MCP server（server.py）：
  - `mcp: FastMCP = FastMCP("sillyhub-public", streamable_http_path="/")`
  - `main.py create_app` 末尾 `mount_mcp(app)` 装配 → 实际端点 **`/mcp/`（带尾斜杠）**
  - 父 app lifespan 须手动合并 `async with mcp.session_manager.run(): yield`（在 main.py 处理，否则 client initialize 挂死）
- 12 个 `@mcp.tool()`（tools.py，import 副作用注册）：
  - worker 派发域：`dispatch_worker` / `get_worker_result` / `list_workers` / `report_progress` / `converge_mission`
  - mission 域：`create_mission` / `get_run_logs` / `list_agent_profiles`
  - 变更阶段域：`advance_change_stage` / `submit_stage_review` / `run_verify_gate` / `get_change_stage`
  - 辅助逻辑内嵌 tools.py：冲突尝试计数（超限 `_mark_mission_needs_manual` 转人工）、mission 清理、latest artifact 定位、dispatch profile 解析等
- 管理 router（prefix=/workspaces，tag=mcp-tokens）：
  - McpToken：签发（明文仅返回一次）/ 列表 / 吊销
  - McpWebhook：创建 / 列表 / 删除
- SSE（sse.py，tag=mcp-mission-events）：
  - `GET /workspaces/{wid}/missions/{mid}/events`：EventSource 帧推 worker 状态变更（pending→running→终态），全部终态后发 done 收尾帧
  - 实现：短轮询 AgentRun 表（默认 2s）差分发帧；25s 静默发 keepalive 防代理超时
  - mission 无单一 Redis channel 聚合其 worker，故不走 pub/sub；连接池安全（短 session 校验 + 生成器自建短 session 轮询）
  - 鉴权走平台侧 `require_permission`（非 McpToken），消费主体是平台用户/客户端
- 数据模型：
  - `McpTokenORM`（mcp_tokens）：绑 workspace；name 标签；`token_hash`（sha256 hex，唯一索引，校验 O(1) 等值定位）；`scope` JSON 列；revoked_at；last_used_at；created_by（SET NULL）
  - `McpWebhookORM`（mcp_webhooks）：绑 token（级联删）+ 冗余 workspace_id；`events` 过滤列表；`secret` 加密存储在 service 层处理
- service.py 三块：`McpTokenService`（签发/校验/吊销/get_or_issue，Redis 正负缓存）、`McpWebhookService`（CRUD）、`WebhookDispatcher`（终态回调投递）

## 关键逻辑
```
mount_mcp(app):
  mcp.streamable_http_app() → 子 app add_middleware(McpAuthMiddleware)
  → app.mount("/mcp", 子app)        # 鉴权挂子 app，只对 /mcp/* 生效（CC-06 物理隔离）
McpAuthMiddleware:
  Bearer shmcp_ → McpTokenService.authenticate（Redis 正/负缓存 + hash 查表）
  → 命中: request.state.mcp_auth = McpAuthContext(workspace_id, scope, token_id)
  → 失败: 401 直返 JSONResponse（子 app 摸不到父 app 异常处理器）
tool handler: _auth_from_ctx(ctx) → require_mcp_scope(...) 越界 403（read/dispatch/converge）
WebhookDispatcher: worker 终态 → events 匹配的 webhook → POST url + secret HMAC-SHA256 签名（投递 task 模块级强引用防 GC 中途回收，ql-20260827-019）
```

## 注意事项
- 五个 spike 锁定的写法坑（server.py 注释是权威，改装配先读它）：
  - ① SDK 是官方 `mcp>=1.29,<2`，方法名 `streamable_http_app()`，**不存在 `http_app()`**（那是第三方 fastmcp 库，两套文档勿混看）
  - ② lifespan 必须手动合并，否则 session manager 不启动、initialize 挂死
  - ③ `streamable_http_path="/"` + mount 才落在 `/mcp/`；默认值会被 Starlette Mount 307 重定向，而 MCP client 的 POST 不跟随 307
  - ④ middleware 挂子 app 非父 app（物理隔离 `/api` 鉴权通道）
  - ⑤ tools 靠 import 副作用注册——server.py 末尾已 `import tools`，删掉它则 tools/list 为空
- token 只认 `Authorization: Bearer` header，**刻意不做 `?token=` 回退**（query 会被反代/访问日志落盘，R-06）
- 明文仅签发时返回一次，库存 sha256；日志只带 token_id（UUID）不带 hash/明文
- scope 三值 `read / dispatch / converge`（frozenset 成员判定）；各 tool 自行 require 对应 scope
- `get_or_issue` 是 init 派发流程复用的取-or-签发路径（dispatch scope，见 tests/test_get_or_issue.py）
- `McpTokenService` 带 Redis 正/负缓存 + last_used_at 节流（高频热路径）；与 platform_sync 的无缓存策略形成对照——改缓存行为时注意两处口径不同

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
