---
schema_version: 1
doc_type: module-card
module_id: mcp_gateway
source_commit: 9656307c
author: qinyi
created_at: 2026-08-08 21:10:00
---
# mcp_gateway
## 定位
对外 MCP（Model Context Protocol）server 暴露层。把平台 agent 能力（dispatch_worker / converge_mission / create_mission 等）与 change 阶层按需触发（advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage）以标准 MCP tool 形式开放给第三方 MCP client（含本仓 sillyhub-daemon 内置 mcp-server 链路A 的同构对端）。两条通道：
- **管理 API**（`/api/workspaces/{wid}/mcp-tokens`、`/mcp-webhooks`）：workspace owner/admin 签发 McpToken / 注册 McpWebhook，普通 HTTP，`WORKSPACE_WRITE`。
- **对外 MCP 端点**（`/mcp/`，带尾斜杠）：FastMCP streamable HTTP transport，第三方 client 经 `Authorization: Bearer <McpToken>` 接入，按 token scope 调 12 个 tool（8 mission 层 + 4 change 阶层）。

12 个 tool handler 全部直接复用现有 service 层零重复：8 个 mission 层复用 `agent` 模块（MissionExecutionService / OrchestratorService / FinalizerService / AgentProfileService）；4 个 change 阶层复用 `change` 模块（ChangeService.transition_with_dispatch / review 四方法 / dispatch 的 gate 读取 + `StageProjectionService.compute_pending_review`）。scan 漏登本子模块，2026-08-08 archive（2026-08-08-dispatch-worker-caller-worktree）补登；2026-08-08-change-center-on-demand 补 4 个 change 阶层 tool（D-004）。
## 契约摘要
- McpToken 管理：`POST /api/workspaces/{wid}/mcp-tokens`（明文 token 仅 201 返一次，DB 只存 sha256）/ `GET .../mcp-tokens`（不返明文，含 last_used_at/revoked_at）/ `DELETE .../mcp-tokens/{id}`（吊销 204，幂等，不存在/已吊销/越权 → 404 防探测）。三端点 `WORKSPACE_WRITE`。
- McpWebhook 管理：`POST/GET/DELETE /api/workspaces/{wid}/mcp-webhooks`，事件 ∈ {worker.completed, worker.failed, "*"}，`secret` 加密入库不回显。
- MCP tool scope：`read` / `dispatch` / `converge` 三选多（Literal 收口），handler 入口 `require_mcp_scope` 校验，不足 → MCP error，不触达 service 层。
- 8 个 mission 层 `@mcp.tool()`（tools.py）：`dispatch_worker`(dispatch) / `get_worker_result`(read) / `list_workers`(read) / `converge_mission`(converge) / `report_progress`(dispatch) / `list_agent_profiles`(read) / `create_mission`(dispatch) / `get_run_logs`(read)。
- 4 个 change 阶层 `@mcp.tool()`（tools.py，task-07/08/09/10，design §6.1 / D-004，形态A 按需触发替代被砍的 auto_dispatch）：
  - `advance_change_stage`(dispatch)：包装 `ChangeService.transition_with_dispatch` → `dispatch_next_step` single/team 分流。
  - `submit_stage_review`(dispatch)：包装 review 四方法（proposal_review/plan_review/human_test/archive_confirm），前置 `StageProjectionService.compute_pending_review` 校验。
  - `run_verify_gate`(read)：gate 软调用三态（source=gate_result 读 `AgentRun.gate_result` / source=gate_cmd 软调 sillyspec gate verify / source=unavailable 返 exit_code=null），不硬阻塞（D-003/D-008）。
  - `get_change_stage`(read)：只读组合 `ChangeService.get` + `stages` JSON + `StageProjectionService.compute_pending_review`，替代 sillyspec.db 自动同步（D-002）。
- `mcp`（FastMCP("sillyhub-public")）实例在 server.py 导出，tools.py 经 `from .server import mcp` + `@mcp.tool()` 注册；import tools 的副作用在 server.py 末尾触发。
- `mount_mcp(app)`：`mcp.streamable_http_app()` 拿子 app → `add_middleware(McpAuthMiddleware)` 挂**子 app**（与 `/api` 鉴权物理隔离，CC-06）→ `app.mount("/mcp", ...)`。
- caller-worktree / external 透传（2026-08-08-dispatch-worker-caller-worktree，链路B）：`dispatch_worker` 加可选 `worktree_path`/`branch`/`worker_prompt`；`create_mission` 加 `orchestration_mode="team"|"external"`。
## 关键逻辑
```
# /mcp/* 鉴权（auth.py McpAuthMiddleware）
Authorization: Bearer <McpToken> → 解析 → request.state.mcp_auth = McpAuthContext
handler 经 ctx.request_context.request.state.mcp_auth 读；缺失 fail-closed 401
workspace 隔离：mission/run 一律按 auth.workspace_id 过滤（token 绑定为唯一真相源）
dispatch actor user_id = McpToken.created_by（CC-05）

# caller-worktree / external 模式透传（链路B，对齐 daemon mcp-server 链路A 同构 D-009）
dispatch_worker(worktree_path?, branch?, worker_prompt?)  # 三参 optional
  → 透传 MissionExecutionService.dispatch_worker
create_mission(orchestration_mode="team"|"external")  # external → team_mission_entry 跳 orchestrator spawn（D-007）
```
## 注意事项
- MCP SDK 是官方 `mcp>=1.29,<2`，方法是 `streamable_http_app()`（**非** `http_app()`，后者属第三方 fastmcp PrefectHQ 线，别混看两套文档）。
- 端点必须带尾斜杠 `/mcp/`：`streamable_http_path="/"` + `mount("/mcp")` → 实际 `/mcp/`，否则 Starlette Mount 307 重定向，MCP client POST 不跟随 → 报 307。
- 父 app lifespan 必须合并 `async with mcp.session_manager.run(): yield`（在 app/main.py），否则 `initialize` 挂死。
- 跨仓字段名契约 `branch`（**非** `worktree_branch`，D-009，对齐 sillyspec / daemon mcp-server / hub-client）；改字段名会直接打破 sillyspec path-a probe 探测缓存。
- `workspace_id` 不进 tool inputSchema（由 middleware 从 McpToken 注入），仅 mission_id 等业务参进 schema。
- 与 sillyhub-daemon `mcp-server.ts`（链路A daemon stdio）schema 同构、tool 集对齐，改任一端需同步另一端 + sillyspec 探测缓存。
## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-08-change-center-on-demand**（D-001~008 / R-01~07）：新增 4 个 change 阶层 tool（advance_change_stage/submit_stage_review/run_verify_gate/get_change_stage，task-07/08/09/10），替代被砍的 backend auto_dispatch 自动连轴，作统一按需触发入口（D-004）。本模块 `depends_on` 新增 `change`（4 tool 复用 ChangeService.transition_with_dispatch / review 四方法 / StageProjectionService / dispatch 的 gate 读取），与既有 `agent` 依赖并列。`run_verify_gate` 三态软调用（gate_result/gate_cmd/unavailable）不硬阻塞（D-003/D-008）；`get_change_stage` 替代 sillyspec.db 自动同步（D-002）。前端 `handleDispatch` 走对齐 HTTP 端点（advance-stage/run-verify-gate）而非直连 MCP（D-005）。
<!-- MANUAL_NOTES_END -->
