---
schema_version: 1
doc_type: module-card
module_id: mcp_gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# MCP 对外网关（mcp_gateway）

## 定位
对外 MCP（Model Context Protocol）服务器 + 配套凭证管理：`FastMCP("sillyhub-public")` 以 streamable HTTP 挂载 `/mcp/`，向第三方 MCP 客户端暴露 12 个 tool——8 个 mission 层（复用 agent service）、4 个 change 阶层（复用 change service，形态 A 按需触发入口，替代被砍的 auto_dispatch）。同模块管理 McpToken 长期凭证（`shmcp_` 前缀）、McpWebhook 事件回调、mission 级 SSE 事件流。

## 契约摘要
- **`/mcp/`（带尾斜杠）**：FastMCP streamable HTTP（协议版本 2025-11-25）。`McpAuthMiddleware` 解析 `Authorization: Bearer shmcp_...`，命中挂 `McpAuthContext(workspace_id, scope, token_id)` 到 `request.state.mcp_auth`，tool handler 经 `ctx.request_context.request.state.mcp_auth` 读取。
- scope ∈ {read, dispatch, converge}（`MCP_SCOPES` 常量收口）；tool 入口 `require_mcp_scope` 越界 403（PermissionDenied）。
- **12 个 `@mcp.tool()`（tools.py）**：
  - mission 层 8 个：`dispatch_worker`（派发 worker，含 conflict attempts 上限→needs_manual 收敛）/ `get_worker_result` / `list_workers` / `converge_mission`（合并清理）/ `report_progress` / `list_agent_profiles` / `create_mission` / `get_run_logs`。
  - change 阶层 4 个：`advance_change_stage` / `submit_stage_review`（会话驱动审批，审批不再派发）/ `run_verify_gate`（三态软调用：gate_result/gate_cmd/unavailable，不硬阻塞）/ `get_change_stage`。
- token 管理（`/api/workspaces/{workspace_id}/mcp-tokens`，三端点均 `require_permission(WORKSPACE_WRITE)`）：签发（明文 `shmcp_` + 32 字节 url-safe，只在响应出现一次，库存 sha256）/ 列表 / 吊销；`get_or_issue` 供 init claim 复用签发。
- webhook（`/api/workspaces/{workspace_id}/mcp-webhooks`）：create / list / delete；`WebhookDispatcher` 事件分发。
- SSE：`GET /api/workspaces/{workspace_id}/missions/{mission_id}/events` → `text/event-stream`，推 mission 下 worker run 状态变更帧，全部终态后发 `done` 收尾帧。

## 关键逻辑
```
mount_mcp(app) 三步（spike-A 验证写法）:
  mcp_app = mcp.streamable_http_app()       # 坑1: 非 http_app()（mcp SDK v1 无此方法）
  mcp_app.add_middleware(McpAuthMiddleware) # 坑4: 挂子 app，与 /api 鉴权物理隔离（CC-06）
  app.mount("/mcp", mcp_app)                # 坑3: streamable_http_path="/" → 端点 /mcp/ 尾斜杠
token 校验: sha256 查表 + Redis 正/负缓存; 命中刷新 last_used; 失败 401 直接 JSONResponse
webhook: body = payload + {event, workspace_id, timestamp}, HMAC-SHA256 签名;
         attempt 1 立即发, 2-5 失败指数退避重试, asyncio.create_task 发射
SSE: 短轮询 AgentRun 表（默认 2s）按 mission_id 检测状态差分发帧; 逐次查询用独立短 session
```

## 注意事项
- **给第三方的接入 URL 必须带尾斜杠 `https://<host>/mcp/`**：否则 Starlette Mount 307 重定向，而 MCP client 的 POST 不跟随 307，直接报 `HTTPStatusError: Redirect response '307'`。
- 父 FastAPI lifespan 必须手动合并 `async with mcp.session_manager.run(): yield`（在 app/main.py）：Mount 不自动跑子 app lifespan，不合并则 `initialize` 挂死。
- 中间件 401 直接返 `JSONResponse`：挂在 `/mcp` 子 ASGI app 上，父 app 的 `register_exception_handlers` 拦不到，别指望全局异常处理器兜底。
- 鉴权只认 Authorization header，刻意不做 `?token=` 回退（query 会被反代/访问日志记明文）；token 明文/sha256 永不入日志（R-06），日志只带 token_id + workspace_id + scope。
- tools.py 的 import 由 server.py 底部**副作用触发**（注册 12 个 tool）——删改那行 import，生产 `/mcp` tools/list 会变空。
- scope 合法值只有 read/dispatch/converge；init 自动签发固定 `scope=['dispatch']`，用其它字符串会绕过 router Literal 收口持久化废 token。
- SSE 与 agent 的 Redis pub/sub 日志流实现不同：mission 无单一聚合 channel，用短轮询；长任务/断线不在服务端保订阅态，客户端重连重订阅（R-03）。
- 本模块被 daemon 依赖（map used_by: daemon），mission/converge 工具的 actor 解析链 `_resolve_actor_user` 从 token 反查用户，跨模块改 User 查询时注意。

## 人工备注

<!-- MANUAL_NOTES_START -->
- **2026-08-12-init-provision-local-yaml**（D-001/FR-08）：McpTokenService 新增 `get_or_issue(*, workspace_id, created_by)`——复用三件套 list_for_workspace（过滤 created_by 匹配+未吊销）+ revoke 吊销 + create（name='init-provisioned', **scope=['dispatch']**）签新。scope 必须 MCP_SCOPES 合法值（read/dispatch/converge），**不可用 ['workspace']**（绕过 router Literal 收口持久化废 token）。供 init claim 时 build_claim_payload 注入 payload.platform_config.local_yaml（明文不落库 D-002）。
- **2026-08-08-change-center-on-demand**（D-001~008 / R-01~07）：新增 4 个 change 阶层 tool（advance_change_stage/submit_stage_review/run_verify_gate/get_change_stage，task-07/08/09/10），替代被砍的 backend auto_dispatch 自动连轴，作统一按需触发入口（D-004）。本模块 `depends_on` 新增 `change`（4 tool 复用 ChangeService.transition_with_dispatch / review 四方法 / StageProjectionService / dispatch 的 gate 读取），与既有 `agent` 依赖并列。`run_verify_gate` 三态软调用（gate_result/gate_cmd/unavailable）不硬阻塞（D-003/D-008）；`get_change_stage` 替代 sillyspec.db 自动同步（D-002）。前端 `handleDispatch` 走对齐 HTTP 端点（advance-stage/run-verify-gate）而非直连 MCP（D-005）。
- **2026-08-14-change-center-conversation-driven**（D-004 / D-006@v2 / task-05）：`submit_stage_review` docstring/返回契约同步——审批不再派发（`agent_dispatch` 恒空保留契约兼容，`dispatched=False` 防第三方误判真派发）；加 `notify_session`（缺省 true）透传 service 服务身份注入，响应补 `notified_session` / `notify_error`（turn_conflict / session_inactive / inject_failed）。stage→decision 词表：proposal∈approve/revise/unclear、plan∈approve/replan/back_to_propose/back_to_brainstorm、human_test 透传 pass/bug/doc_mismatch、archive_confirm decision 忽略。
<!-- MANUAL_NOTES_END -->
