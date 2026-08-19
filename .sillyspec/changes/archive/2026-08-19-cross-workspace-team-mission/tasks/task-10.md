---
id: task-10
title: daemon-mcp-target-schema
title_zh: daemon MCP server 透传 target 参数
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-010@v1]
allowed_paths:
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/mcp-server.test.ts
provides:
  - contract: daemon_mcp_target
    fields: [target_workspace_id]
expects_from:
  task-08:
    - contract: mcp_scope_validation
      needs: [target_workspace_id]
goal: >
  daemon MCP server 的 dispatch_worker schema 加 target_workspace_id 可选参，
  透传 backend 且零回归存量调用。
implementation:
  - dispatch_worker tool inputSchema 加 target_workspace_id 字段
    （z.string().optional()，对齐 backend DispatchWorkerRequest）
  - dispatch_worker tool handler 读 target_workspace_id，
    透传给 client.dispatchWorker 调用（undefined → hub-client 守卫不写入 body）
  - 更新 tool description 文档说明 target_workspace_id 语义（跨工作区派发）
  - 新增 vitest 测试用例验证 schema 注册 + 参数透传
acceptance:
  - dispatch_worker schema 含 target_workspace_id 字段（optional）
  - target_workspace_id 参数正确透传到 backend（非空时写入 body）
  - target_workspace_id 为 undefined 时零回归（backend 走原 team 模式）
  - tool registration 断言通过（listTools 含 target_workspace_id）
verify:
  - cd sillyhub-daemon && pnpm test mcp-server.test.ts
constraints:
  - target_workspace_id 必须为 optional 字段，零回归存量调用
  - undefined 值必须不被 hub-client 写入请求 body（守卫机制）
  - schema 描述必须与 backend DispatchWorkerRequest 保持一致

---
