---
id: task-10
title: daemon-mcp-session-context-and-team-tools-optional-params
title_zh: daemon MCP 会话上下文（env MCP_SESSION_ID + X-Session-Id header）+ 5 工具参数可选化与描述重写
author: qinyi
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-09]
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-002@v2]
provides:
  - contract: X_SESSION_ID_HEADER
    fields: [MCP_SESSION_ID env 注入, X-Session-Id header]
expects_from:
  task-09: [{contract: MISSION_WORKER_STAGE, needs: [stage 常量 mission_worker]}]
allowed_paths:
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-main-agent-mcp.test.ts
  - sillyhub-daemon/tests/mcp-server.test.ts
  - sillyhub-daemon/tests/hub-client.test.ts
related_tests: [sillyhub-daemon/tests/mcp-server.test.ts]
goal: >
  prompt 烤 id 下线后团队 5 工具改靠会话上下文定位（design §5 Phase 2 / 审查 B1 / FR-04）——MCP server 子进程读 env MCP_SESSION_ID，hub-client 请求统一带 X-Session-Id，5 工具参数全可选、描述重写。
implementation:
  - 注入链——mcp-config.ts buildDaemonMcpServerConfig 增可选 sessionId 参数写 env MCP_SESSION_ID（键名常量导出单一来源，旧参数零回归）；session-manager.ts _resolveMainAgentMcp 在 provider 返回后按 ctx.sessionId 给 sillyhub-daemon 条目补该 env（design §6 数据流 producer=session-manager）；mcp-server.ts readEnv 增读该 env 并随鉴权传入 HubClient
  - 请求侧——mcp-server.ts 5 工具 inputSchema 的 mission_id/workspace_id/run_id 全部 optional 且 undefined 不下发（hub-client 守卫风格），description 重写为能力说明书（如何拆解任务、仅用户明确要求时派团队、何时 converge、预算提示）；hub-client.ts 鉴权结构增 sessionId，dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress 五方法统一附 X-Session-Id 请求头（_request extraHeaders 既有机制，缺失不附）
acceptance:
  - mcp-server 子进程可读 MCP_SESSION_ID（spike-01 通过路径），env 注入链 session-manager 到 driver spawn 到 readEnv 有单测覆盖；hub-client 上述 5 端点请求头含 X-Session-Id（sessionId 存在时），未设时不带该头
  - 5 工具 schema 中 mission_id/workspace_id/run_id 均不在 required，显式传参照常透传；工具描述含「仅用户明确要求时派团队」文案；tests/mcp-server.test.ts 既有 required 断言（第 136-137 与 172-175 行附近）适配后全绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run --exclude tests/task-09-spec-pull-push.test.ts --exclude tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts --exclude tests/daemon-borrow-sandbox.test.ts && pnpm exec vitest run tests/task-09-spec-pull-push.test.ts tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts tests/daemon-borrow-sandbox.test.ts --poolOptions.forks.maxForks=1
constraints:
  - spike-01 不通过（claude-sdk-driver 不透传 per-server env）时 fallback 为 5 工具参数显式 session_id（design §10 R-04），执行前先确认 spike 结论再选路径
  - X-Session-Id 的 backend 消费（mcp_tools 会话定位与懒建）属 task-05/06，本任务只提供请求头与可选参数；不动 cli.ts 谓词与 execution.py（task-09 范围）；codex 不注入（D-003@v1）；api-types 同步属 task-14
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
