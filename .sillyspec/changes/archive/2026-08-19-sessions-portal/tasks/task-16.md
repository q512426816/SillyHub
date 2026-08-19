---
id: task-16
title: 前端 client 扩展：createSession/injectSession/listAgentSessions 新参数（覆盖 FR-01, FR-02）
title_zh: 会话 client 参数扩展
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: []
blocks: [task-11, task-12, task-14]
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-010@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/daemon.test.ts
  - frontend/src/lib/__tests__/daemon-session.test.ts
provides:
  - contract: DaemonSessionClient
    fields: [createSession, injectSession, listAgentSessions]
expects_from:
  task-02:
    - contract: AgentSessionRead
      needs: [agent_profile_id, llm_provider_id, config_snapshot]
goal: >
  扩展前端会话 client 支持新建会话新参数、切换注入参数与列表过滤参数，为新页面与组件提供数据通道。
implementation:
  - SessionCreateRequest 类型加 runtime_id/agent_profile_id/llm_provider_id（暂手写，task-17 迁生成版）
  - injectSession 入参加 agent_profile_id/llm_provider_id（空串语义=切回本机默认）
  - listAgentSessions 参数扩展 runtime_id/machine_id/provider/q
  - AgentSessionRead 手写副本加三配置字段（config_snapshot 含 machine_name/agent_name）
  - 同步修既有 client 单测的签名调用
acceptance:
  - 三函数新参数正确序列化进请求体/query
  - 不传新参数时请求与现状一致
verify:
  - cd frontend && pnpm exec vitest run src/lib/daemon.test.ts src/lib/__tests__/daemon-session.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 /runtimes 弹窗调用点（可选参数向后兼容）
  - 类型暂手写（Wave4 task-17 统一迁 api-types 生成版）
related_tests:
  - path: frontend/src/lib/daemon.test.ts
    reason: 函数签名扩展后既有断言需同步
  - path: frontend/src/lib/__tests__/daemon-session.test.ts
    reason: 同上
---
