---
author: qinyi
created_at: 2026-08-18 02:50:00
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# MCP Token 派发 Worker 流程（/mcp 外部编排）

## 目标
让第三方编排者（外部 MCP client，如 Claude Code / 其它 agent 宿主）经 shmcp_ token 连平台 /mcp 网关，派发 worker、推进变更阶段、收任务事件——与 /api 的 JWT 鉴权通道物理隔离的对外执行入口。

## 参与模块
- mcp_gateway：FastMCP 实例 sillyhub-public（streamable HTTP，挂载 `/mcp/`）、McpAuthMiddleware（子 app 级鉴权）、McpTokenService（签发/校验/吊销 + Redis 正负缓存 + get_or_issue）、12 个 MCP 工具（tools.py import 副作用注册）、mission SSE 事件流（sse.py）、WebhookDispatcher（终态回调）
- agent：mission / AgentRun 派发执行（dispatch_worker 落到与平台侧同一条派发链路，见 agent-run 流程）
- daemon：实际执行体（claim lease → TaskRunner 执行 → 消息上行）
- change：变更阶段域工具（advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage）
- workspace：McpToken 绑定 workspace；token 管理页在 workspace 内（/mcp-tokens）
- tool_gateway：SSRF 校验原语宿主（webhook 投递 URL 复用 core.ssrf 体系）
- frontend_app / frontend_lib：workspace 内 /workspaces/[id]/mcp-tokens 签发/列表/吊销页（lib/mcp-tokens.ts，纯前端镜像 api-keys 交互）

## 流程摘要

```text
=== 签发 ===
(用户)      workspace 内 /mcp-tokens 页签发 McpToken
(backend)   McpTokenService：明文 shmcp_ 仅签发时返回一次，库存 sha256
     │      （token_hash 唯一索引，校验 O(1) 等值定位）
     │      scope 三值：read / dispatch / converge（frozenset 成员判定）
     │      仅认 Authorization: Bearer（刻意不做 ?token= 回退，防反代日志泄露）
     ▼
=== 接入与鉴权 ===
(外部 client) 连 /mcp/（带尾斜杠；streamable HTTP transport）
(backend)    McpAuthMiddleware：
     │      Bearer shmcp_ → McpTokenService.authenticate（Redis 正/负缓存 + hash 查表）
     │      命中 → request.state.mcp_auth = McpAuthContext(workspace_id, scope, token_id)
     │      失败 → 401 直返（子 app 摸不到父 app 异常处理器）
     ▼
=== 派发与收敛 ===
(client)    dispatch_worker（require_mcp_scope 校验 dispatch）
(backend)    → mission / AgentRun 创建 → placement 派发在线 daemon
     │        （与平台侧派发同链路：claim payload 供应商/profile 注入）
     ▼
(client)    收结果三选一：
     ├─ 轮询：get_worker_result / list_workers / get_run_logs / get_change_stage
     ├─ SSE：GET /workspaces/{wid}/missions/{mid}/events
     │        （2s 短轮询 AgentRun 表差分发帧；25s keepalive 防代理超时；
     │          鉴权走平台侧 require_permission，消费主体是平台用户/客户端）
     └─ Webhook：worker 终态 → events 匹配的 webhook
              → POST url + secret HMAC-SHA256 签名（URL 经 SSRF 校验）
     ▼
(client)    converge_mission（require converge scope）→ mission 收敛
(backend)    冲突尝试计数超限 → _mark_mission_needs_manual 转人工处理
```

12 个工具四域：worker 派发（dispatch_worker / get_worker_result / list_workers / report_progress / converge_mission）、mission（create_mission / get_run_logs / list_agent_profiles）、变更阶段（advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage）。

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| token 无效 / 未走 Bearer | 401（不降级 query token） |
| scope 越界 | require_mcp_scope 403（read/dispatch/converge） |
| token 吊销 | revoked_at 置位，缓存失效后拒绝 |
| 无在线 daemon | 派发失败，mission worker 标 failed |
| converge 冲突反复 | 尝试计数超限 → needs_manual 转人工 |
| webhook URL 不安全 | SSRF 校验拒绝投递 |
| MCP initialize 挂死 | lifespan 未合并 mcp.session_manager 的装配错误（部署自检项） |
| tools/list 为空 | server.py 末尾 `import tools` 被删（import 副作用注册，改装配先读 server.py 注释） |
