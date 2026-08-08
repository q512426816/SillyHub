---
id: task-06
title: link-A daemon stdio dispatch_worker schema adds caller-worktree fields
title_zh: 链路A daemon mcp-server/hub-client dispatch_worker 加 caller-worktree 字段（schema 防漂移）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P1
depends_on: [task-02, task-04]
blocks: [task-09]
requirement_ids: [FR-01]
decision_ids: [D-009@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\mcp-server.ts
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\src\hub-client.ts
provides:
  - contract: link_a_daemon_dispatch_worker_caller_worktree
    fields: [worktree_path, branch, worker_prompt（snake_case，daemon stdio dispatch_worker inputSchema + hub-client body）]
expects_from:
  - task-02: dispatch_worker 字段名 worktree_path/branch/worker_prompt（snake_case 对齐）
  - task-04: 链路B dispatch_worker 字段集（schema 同构基准，R-06）
goal: >
  链路A daemon stdio dispatch_worker inputSchema（mcp-server.ts:154）+ hub-client dispatchWorker body（:1039）加 worktree_path/branch/worker_prompt 三可选字段（snake_case），与链路B/HTTP 入口同构防漂移（R-06）；team 模式 undefined 零回归。
implementation:
  - mcp-server.ts:163 dispatch_worker inputSchema 加 worktree_path/branch/worker_prompt（各 z.string().optional()，对齐既有 role/model/read_only 风格）
  - mcp-server.ts:178 handler client.dispatchWorker 调用 body 追加三字段（undefined 不传，对齐现有可选字段守卫）
  - "hub-client.ts:1042 dispatchWorker body 类型加 `worktree_path?: string` / `branch?: string` / `worker_prompt?: string`；:1050 payload 构造追加三字段 if-defined 守卫（对齐 role/model/read_only 写法）"
  - "⚠️ create_mission/createMission 不存在：daemon mcp-server 仅注册 5 tool（dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress，mcp-server.ts:154/194/222/248/276），hub-client 无 createMission 方法。orchestration_mode 无 daemon 落点（非目标\"不新增 MCP tool\"）。design §6 row 92 / §7.3 / plan task-06 述及的 daemon create_mission/createMission 部分为文档漂移——本任务只做 dispatch_worker"
acceptance:
  - daemon dispatch_worker inputSchema 含 worktree_path/branch/worker_prompt（MCP tools/list 可见，spike-01/task-11 探测前提）
  - hub-client dispatchWorker body 透传三字段（undefined 不写入 body，不覆盖 backend 默认）
  - 不传新字段 → team 模式 dispatch 行为不变（typecheck + 既有 daemon 测试全绿）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
---

## 实现依据
- design §6 row 92-93（mcp-server.ts / hub-client.ts dispatch_worker 加字段，链路A daemon stdio）+ R-06（链路A/B schema 防漂移）
- design §7.3 daemon mcp-server.ts:163 dispatch_worker 入参增量（worktree_path/branch/worker_prompt，snake_case）
- design §11 D-009@v1（字段名 branch）；非目标"不新增 MCP tool（8 tool 不变）"
- 源码核实：mcp-server.ts:154 dispatch_worker registerTool（inputSchema:163 workspace_id/mission_id/objective/role/agent_type/model/read_only；handler:178 client.dispatchWorker）；hub-client.ts:1039 dispatchWorker（body 类型:1042，payload 守卫:1050，POST .../dispatch_worker:1057）
- 源码核实（漂移证据）：mcp-server.ts 全文仅 5 个 registerTool（:154/194/222/248/276），无 create_mission；hub-client.ts 无 createMission 方法；daemon 内 create_mission 唯一出现于 api-types.ts:20710（OpenAPI 自动生成类型，由 backend schema 再生，非手改）

## 跨任务契约
- provides `link_a_daemon_dispatch_worker_caller_worktree`：daemon stdio dispatch_worker 字段同构，被 task-09（零回归）/ spike-01（tools/list 探测）覆盖
- 消费 task-02（字段名）/ task-04（链路B 同构基准）
- ⚠️ 与 plan 表 task-06 依赖 task-01/02/04 的差异：task-01（orchestration_mode）不适用——daemon 无 create_mission tool，external mode 经链路B(mcp_gateway)+HTTP(router.py) 入，不经 daemon；故 depends_on 不含 task-01。需同步校正 design §6 row 92（删 create_mission）/ plan task-06 描述（删 createMission/orchestration_mode/FR-08）
- 注：路径A(external) 实际经链路B，daemon dispatch_worker 加这三字段是为与链路B schema 同构（R-06），team 模式调用方不传→undefined 零回归，非路径A 活跃入口
