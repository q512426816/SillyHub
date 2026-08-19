---
id: task-12
title: 前端 NewSessionForm 四选择器联动（覆盖 FR-01, D-005@v1, D-010@v1, D-013@v1）
title_zh: 新建会话四选择器表单
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-03, task-16]
blocks: [task-10]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-005@v1, D-010@v1, D-013@v1]
allowed_paths:
  - frontend/src/components/sessions/new-session-form.tsx
  - frontend/src/components/sessions/__tests__/new-session-form.test.tsx
provides:
  - contract: NewSessionForm
    fields: [machineId, agentId, providerId, profileId, prompt]
expects_from:
  task-16:
    - contract: DaemonSessionClient
      needs: [createSession]
goal: >
  实现新建会话表单：守护进程/智能体/供应商/档案四选择器按 D-010 联动，供 /sessions 页面右侧初始态使用。
implementation:
  - 守护进程选择：useDaemonMachines 过滤 online；默认值=localStorage 上次选择、无则最近会话的在线机器、再退最新心跳；离线机器置灰不可选
  - 智能体选择：所选机器 runtimes 过滤在线且 provider 为 claude 或 codex；默认 claude；其余置灰标注暂不支持会话；切机器重置默认
  - 供应商选择：lib providers 列表加不指定（本机默认）项；所选智能体非 claude 引擎时锁定；不选=一律本机默认（D-013）
  - 档案选择：useMineAgentProfiles 跨工作区聚合不做引擎过滤；Codex 智能体下选项标注人格暂不支持
  - 机器与智能体必选且消息非空后开始会话按钮解锁，调 createSession（runtime_id+可选两 id）
acceptance:
  - 四选择器联动规则逐条生效（切机器重置智能体、Codex 锁供应商等）
  - 提交请求体含 runtime_id 与所选可选 id
  - 未选项不进请求体
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 组件自治可独立测试（不依赖 page.tsx 挂载，归 task-10）
  - 样式对齐设计系统（antd 组件+tailwind 变量，FRONTEND_PAGE_STYLE）
  - 原型交互语义见 prototype-sessions-portal.html
related_tests: []
---
