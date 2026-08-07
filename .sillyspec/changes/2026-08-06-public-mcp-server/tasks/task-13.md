---
id: task-13
title: mission SSE endpoint streaming worker status changes reusing stream_agent_run_logs
title_zh: mission 级 SSE 端点（复用 stream_agent_run_logs 模式，推 worker 状态变更）
author: qinyi
created_at: 2026-08-06 13:52:28
priority: P1
depends_on: [task-05]
requirement_ids: [FR-08]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/sse.py
  - backend/app/main.py
provides: []
expects_from: []
goal: >
  新增 mission 级 SSE 端点 GET /workspaces/<wid>/missions/<mid>/events，复用
  agent/router.py::stream_agent_run_logs 的 text/event-stream + StreamingResponse 模式，推该 mission 下 worker run 状态变更（pending→running→终态），并在 main.py include_router 注册（G-1）。
implementation:
  - 新建 mcp_gateway/sse.py 建 APIRouter，加 GET /workspaces/<workspace_id>/missions/<mission_id>/events 返 StreamingResponse（media_type=text/event-stream + _SSE_HEADERS），_SSE_HEADERS 与 EventSource 帧格式（event 行带类型 + data 行带 json + 空行分隔）照搬 agent/router.py::stream_agent_run_logs
  - 连接池安全照搬 stream_agent_run_logs：存在性校验用 get_session_factory() 短 session（校验完即归还 slot，不在请求级 session 贯穿整个流生命周期），事件生成器内部自建独立短 session 做逐次轮询
  - 事件源轮询该 mission 的 worker runs（按 AgentRun.mission_id 匹配 mid），每次 run 状态变化发一帧（event 类型 worker_status，data 含 worker_id/status/exit_code/error_code），mission 全部 worker 进终态后发 done 收尾帧（对齐 stream_agent_run_logs 终态短路 done）
  - 鉴权二选一（execute 定，默认走现有 workspace 鉴权）——复用 require_permission_any(Permission.TASK_READ)（与 stream_agent_run_logs 同款，路由在 /api 前缀天然适用）；若要限第三方 McpToken 专享需另把 task-03 middleware 扩到该路径（task-03 现 /mcp 专用 CC-06，本 task 不强加）
  - main.py 加 mcp_sse_router 导入并 app.include_router(mcp_sse_router, prefix="/api")（G-1 注册步骤，落 /api/workspaces/<wid>/missions/<mid>/events 实际可达）
acceptance:
  - GET events 返 text/event-stream，worker run 状态变更（pending→running→终态）逐帧推送，mission 全终态时发 done 收尾
  - 长任务/客户端断线不在服务端保订阅状态，由客户端重连重订阅（R-03，重连与事件补发策略文档在 task-15 docs/mcp/sse.md 说明）
  - 连接池安全（短 session 校验 + 生成器自建短 session），长 SSE 不占请求级连接池 slot
  - main.py include_router 后路由实际可达；现有 /api/* 路由与 /mcp mount 零回归
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints:
  - 复用 stream_agent_run_logs（agent/router.py）的 SSE 模式——text/event-stream + StreamingResponse + _SSE_HEADERS + EventSource 帧格式 + 短 session 连接池安全策略，不新发明流式骨架
  - 推 worker run 状态变更事件（status pending→running→终态 completed/failed/killed），mission 全终态发 done 收尾
  - 鉴权二选一，默认走现有 workspace 鉴权 require_permission_any(TASK_READ)（路由在 /api 前缀天然适用，与 stream_agent_run_logs 同款）；McpToken 专享需另扩 task-03 middleware（/mcp 专用 CC-06），本 task 不强加，由 execute 权衡
  - 长任务/断线由客户端重连，服务端不保订阅状态（R-03）；重连与事件补发策略在 docs/mcp/sse.md（task-15）文档说明，本 task 只做基础推流
  - 本 task 只做 SSE 推流端点 + main.py 注册；webhook 投递归 task-11/12，3 新 tool 归 task-14，文档归 task-15
---
