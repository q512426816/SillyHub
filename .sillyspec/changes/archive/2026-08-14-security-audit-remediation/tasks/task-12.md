---
id: task-12
title: "auth_deps query 回退删除 + 前端 5 处 SSE 改造"
title_zh: "删除 token/api_key query 回退，前端 SSE 改 fetch 流式 + header 转传"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-10]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/core/auth_deps.py
  - backend/app/core/tests/test_query_token_removed.py
  - frontend/src/lib/fetch-sse.ts
  - frontend/src/lib/__tests__/fetch-sse.test.ts
  - frontend/src/lib/agent-stream.ts
  - frontend/src/lib/daemon.ts
  - frontend/src/components/permissions/session-permission-panel.tsx
  - frontend/src/components/permissions/session-permission-panel.test.tsx
  - frontend/src/app/api/daemon-chat/[runId]/stream/route.ts
  - frontend/src/app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts
provides: {}
expects_from: {}
goal: >
  auth_deps 删除 token/api_key query 参数回退（query 会进访问日志明文泄漏），前端三处 EventSource 直连改统一 fetch-SSE helper（token 走 Authorization header），两处 Next 代理 route 改 header 转传不再拼 backend URL query。
implementation:
  - 先写 backend 失败测试。core/tests 新建 test_query_token_removed.py——仅带 query 参数 token=合法JWT（无 Authorization header）请求任一受保护端点期望 401；仅带 query api_key 同理 401；带 Authorization header 的正常路径回归 200
  - auth_deps.py _extract_bearer（:44）删 query_params.get("token") 回退，_extract_api_key（:53）删 query_params.get("api_key") 回退——header 缺失即返回 None；同步更新两函数与模块 docstring 注释（规则 18 注释实现一致），说明 query 回退已因日志泄漏移除
  - 前端新建 lib/fetch-sse.ts——fetch + ReadableStream 手解析 text/event-stream 的 helper：支持 Authorization header、onmessage 默认帧 + 命名事件（event: 行）分发、Last-Event-ID 重连语义可先简化为不自动重连（对齐现三处 EventSource 用法均 es.onerror 容忍）、AbortController close()；接口形状尽量贴 EventSource（onopen/onmessage/addEventListener）降低调用点改动
  - agent-stream.ts AgentRunStreamClient（:103 附近）删 url.searchParams.set("token", token)，new EventSource 改用 fetch-sse helper 传 Authorization Bearer header；after 参数保留在 query（非敏感）
  - daemon.ts streamSession（:823 附近）同样改 fetch-SSE；cursor 参数保留 query；SessionStreamConnection 接口 close/getLastEventId 语义保持
  - session-permission-panel.tsx（:137-139）删 token query，EventSource 改 fetch-SSE；sourcesRef 类型从 Map of EventSource 改为连接句柄（close() 语义不变），SSE 上限 50 的逻辑不动
  - 两处 Next route handler 改 header 转传——daemon-chat stream route.ts（:18-21）与 workspaces runs stream route.ts（:22-29）：token 仍从入站 query 取（前端直连本路由的入站面不变），但转发 backend 时改放 Authorization Bearer header，不再 backendUrl.searchParams.set("token")
  - 前端测试——新建 fetch-sse.test.ts（帧解析、多 data 行拼接、命名事件、close 中止流）；session-permission-panel.test.tsx 与 daemon-session 相关测试的 FakeEventSource mock 改为 fetch/ReadableStream mock；runtimes 页面 EventSource 若直连带 token 也一并排查（grep searchParams.set token 全前端，超出本卡清单的报备）
acceptance:
  - backend 仅 query token/api_key 无 header 的请求全部 401（AuthTokenMissing）
  - 前端三处 SSE 订阅（run 日志 / session 流 / 权限面板）经 fetch-SSE 正常收帧，请求 URL 无 token 参数
  - 两处 Next 代理转发 backend 的请求 Authorization header 携带 token，backend URL 无 token query
  - frontend pnpm test 全绿（EventSource mock 改造后无残留失败）+ tsc 无错
verify:
  - cd backend && uv run pytest app/core/tests -q --no-cov
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - backend 删除与前端改造必须同一提交窗口合入（否则所有 SSE 全断），execute 时本 task 两端改动一个 commit 落地
  - daemon hub-client 已全走 header（design 兼容策略核实 hub-client.ts:309），无需 daemon 侧改动；若执行时再发现 daemon 带 query token 的调用点，停下报备不擅改
  - MCP 通道（mcp_gateway/auth.py）本就无 query 回退（test_auth.py:145 已覆盖），保持不动不重复造
  - fetch-SSE 不实现浏览器 EventSource 的自动重连（现三处调用点均容忍断连 + 有查询兜底），注释写明该取舍避免误用
  - gen:types 预计不需要（无 DTO 变化）；若 tsc 暴露无关旧债按 CLAUDE.md 规则 21 顺手修
related_tests:
  - path: backend/app/modules/mcp_gateway/tests/test_auth.py
    reason: 既有 test_query_param_token_not_accepted（:145）是 MCP 通道的同类断言，本 task 后端测试参照其写法；该用例本身不受影响（MCP 通道不动）
  - path: frontend/src/lib/__tests__/daemon-session.test.ts
    reason: FakeEventSource mock 依赖 url 含 token 断言（:432 expect es.url toContain token），改 fetch-SSE 后 mock 体系整体失效需重写为 fetch 流 mock
  - path: frontend/src/components/permissions/session-permission-panel.test.tsx
    reason: EventSource mock + accessToken 依赖断言，需改为 fetch-SSE mock 并断言 Authorization header 传入
  - path: frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx
    reason: EventSource stub 体系页面测试，若该页面 SSE 调用也带 query token 则一并改，需执行时核实
---
