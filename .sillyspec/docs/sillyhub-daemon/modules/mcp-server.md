---
schema_version: 1
doc_type: module-card
module_id: mcp-server
source_commit: 9656307c
author: qinyi
created_at: 2026-08-08 21:10:00
---
# mcp-server
## 定位
daemon 内置的 stdio MCP server（独立进程 `node dist/mcp-server.js`）。team 模式下主 agent（orchestrator）经此 stdio 通道调平台工具（dispatch_worker / get_worker_result / list_workers / converge_mission / report_progress），由 daemon 转 HTTP 打到 backend `/api`。是路径A（caller-worktree）链路A 的 daemon 侧入口。与 backend `mcp_gateway` 公开端点（链路B）schema 同构、tool 集对齐。scan 此前漏建卡片，2026-08-08 archive 补建。
## 契约摘要
- 入口：`createMcpServer()` / `runMcpServer()`（独立进程，stdio transport）。
- tool 集（5 个，对齐 backend `agent/mcp_tools.py`）：
  - `dispatch_worker`（inputSchema：workspace_id / mission_id / objective + 可选 worktree_path / branch / worker_prompt）。
  - `get_worker_result`（workspace_id / mission_id / worker_id）。
  - `list_workers`（workspace_id / mission_id）。
  - `converge_mission`（workspace_id / mission_id）。
  - `report_progress`（workspace_id / mission_id / run_id + 决策日志字段）。
- handler 经 `client.dispatchWorker(...)` 等 转 backend，返回 `{content:[{type:'text', text: JSON.stringify(payload)}]}`（`okContent` / `errorContent`）。
- 鉴权用 **user token**（WORKSPACE_WRITE，非 daemon apiKey）—— spike-01 校正。
- ★ `createMission` **不存在**于 daemon stdio（仅 5 tool）；create_mission 只在 backend `/api` + 链路B 公开 gateway 提供。
## 关键逻辑
```
# dispatch_worker inputSchema（路径A caller-worktree 透传，2026-08-08-dispatch-worker-caller-worktree）
dispatch_worker {
  workspace_id, mission_id, objective,
  worktree_path?, branch?, worker_prompt?   // 全 optional，对齐 backend DispatchWorkerRequest（mcp_tools.py）+ 链路B（D-009 字段名 branch）
}
// 不传 → undefined → hub-client 守卫不写入 body → backend None → 走原 team 模式自建 worktree / render_worker_prompt（零回归）
handler → client.dispatchWorker(ws, mission, { ..., worktree_path, branch, worker_prompt })
```
## 注意事项
- schema 必须与 backend `agent/mcp_tools.py` DispatchWorkerRequest + `mcp_gateway/tools.py`（链路B）三端同构；改字段名（如 branch ↔ worktree_branch）会直接打破跨仓契约（D-009）与 sillyspec path-a probe 探测缓存（`isPathASupported` 读 dispatch_worker inputSchema 是否含 worktree_path+worker_prompt）。
- daemon stdio 仅 5 tool，**无 createMission**；external 模式 / 路径A 的 create_mission 走 backend `/api` 直连或链路B 公开 gateway。
- tsc 编译产物供 Node <24 兼容（spike-01）。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
