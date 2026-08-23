---
id: task-04
title: 'frontend-agent-log-card'
title_zh: '前端「本地 Agent 日志」卡片 + SessionPanelPage 挂载'
author: qinyi
created_at: 2026-08-23 05:20:00
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-006]
allowed_paths:
  - frontend/src/lib/agent-logs.ts
  - frontend/src/lib/query-keys.ts
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/agent-log-card.test.tsx
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  会话详情展示 agent 本机日志线索：AgentLogCard 三态卡片（列表/空态/折叠）挂载
  SessionPanelPage 消息流下方，数据走新 GET 端点，对照原型
  prototype-agent-log-panel.html 实现。
implementation:
  - src/lib/agent-logs.ts 新建：listAgentLogs(workspaceId?) → apiFetch("/api/agent-logs", { query })，类型取 api-types 生成 schema（AgentLogListItem）；文件顶部 export const AGENT_LOG_QUERY_KEY 工厂或并入 query-keys.ts（agentLogs(workspaceId?)），key 含影响查询结果的全部变量（CONVENTIONS 典型模式 2）
  - src/components/daemon/agent-log-card.tsx 新建（模式 A 小卡片：rounded-lg border border-border bg-card）：useQuery agentLogs 键 + refetchInterval 30_000；列表项渲染 harness 徽标（brand 语义阶，zcode 用 info 青区分）/originator 标签（sillyhub-daemon 加 brand 边框）/session_id 短码（前 8 后 4，点击复制）/大小人性化 B→KB→MB/相对时间（dayjs.fromNow，文件顶部 dayjs.extend(relativeTime)——全仓首次 extend，X-15；toLocaleString 场景显式 zh-CN）/调用次数/最近命令 code chip/log_path 截断点击复制；复制用 navigator.clipboard + 「已复制 ✓」900ms 瞬时反馈；默认 3 条 + 「展开全部 N 条」
  - session-panel.tsx SessionPanelPage：TurnTimeline 之后、TeamTaskBlock 之前插入 {session.workspace_id ? <AgentLogCard workspaceId={session.workspace_id} /> : null}（D-006 null 守卫，dialog 模式不挂）
  - agent-log-card.test.tsx：mock listAgentLogs——列表字段渲染 / 空态文案 / 折叠展开 / 复制回调（mock clipboard）/ workspaceId null 不渲染
acceptance:
  - vitest 新用例全绿，既有 session-panel 测试零回归
  - 双主题（blue/ai-native）渲染正常（brand-* 语义阶 + 主题 token，无硬编码色值）
  - tsc/eslint 干净
verify:
  - cd frontend && pnpm vitest run src/components/daemon/agent-log-card.test.tsx
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 类型只从 api-types.ts 生成 schema 引用，禁止手写同名接口（X-06：snake_case 字段访问）
  - 不改 TurnTimeline/TeamTaskBlock/输入区任何既有行为（单点插入）
  - 日期格式化显式 zh-CN（CONVENTIONS 类型与数据契约 8）
---

# task-04 补充说明
无。
