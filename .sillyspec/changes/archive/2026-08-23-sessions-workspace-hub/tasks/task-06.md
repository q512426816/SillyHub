---
id: task-06
title: 'sessions-portal-pre-context-wiring'
title_zh: '门户双态接线与上下文解析'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: [task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-03, FR-04, FR-06]
decision_ids: [D-107@v1, D-105@v1]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/
goal: >
  门户持有 preContext 状态机：组头＋→上下文解析（优先级 tab 筛选>绑定在线>D-005 回退）→SessionPanel
  预会话态；创建成功切真会话+列表刷新；深链保留；workspace 入口预展开。
implementation:
  - preContext: SessionPreContext | null；未选中会话且 preContext 存在 → SessionPanel sessionId=null+preContext（task-03 契约）；两者皆无 → 空门户态（轻引导占位，表单删除归 task-07）
  - 上下文解析（onNewInGroup 回调）：tab 筛选（机器+智能体均已选）> 工作区绑定在线机器（fetchMyBindings→daemon_id 在线校验，复用现有绑定映射语义）> D-005 三级回退；resolveDefaultMachineId + NEW_SESSION_MACHINE_LS_KEY 本卡从 new-session-form.tsx 迁入本文件组件外纯函数区（先例 session-panel.tsx 底部 deriveTurnTerminalStatus；task-07 删源不回退断链）；全部态（无 tab 机器）→ task-04 浮层选完再解析；引擎默认 Claude（provider=claude 优先，无则首个可会话）
  - 创建成功：SessionPanel onPreSessionCreated(session_id) → setSelectedSessionId（key 重挂载切真会话现行契约）+ invalidate 列表（新会话出现对应分组顶部）
  - 深链：?session= 有效直达选中；无效/无参落空门户态；workspace 入口（scope.workspaceId）挂载后预展开+滚动到该分组（SessionListPanel 受控展开 prop）
  - 门户头部「新建会话」按钮移除（新建入口收敛到组头＋，plan 复审 X-12 定论）
acceptance:
  - 组头＋→预会话态（上下文行正确：工作区=分组、机器/引擎按优先级链）；全部态经浮层两步后同
  - 首句创建成功切真会话+列表刷新；不发言切走零残留
  - ?session= 深链/无效静默、workspace 预展开生效
  - 全局/工作区/变更三 scope 门户标题与数据源不回归（D-001）
verify:
  - pnpm exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx
  - pnpm typecheck
constraints:
  - preContext 解析纯函数化（组件外可单测）
---

# task-06 补充说明
无。
