---
id: task-14
title: 前端 SessionConfigBar（样式 B）+ 消息 who 行轮次快照（覆盖 FR-05, FR-07, D-004@v2, D-007@v1, D-008@v1）
title_zh: 会话配置控件条与轮次快照渲染
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-05, task-09, task-13, task-16]
blocks: [task-10]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-004@v2, D-007@v1, D-008@v1]
allowed_paths:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
provides:
  - contract: SessionConfigBar
    fields: [machineCtrl, agentCtrl, providerCtrl, profileCtrl]
expects_from:
  task-16:
    - contract: DaemonSessionClient
      needs: [injectSession]
  task-13:
    - contract: SessionPanelSubcomponents
      needs: [TurnTimeline]
goal: >
  输入框下方样式 B 四控件条（档案/供应商可切、机器/智能体纯展示置灰）与消息 who 行按轮次 run 快照渲染，切换后历史不跟随。
implementation:
  - 四控件（机器/智能体/供应商/档案）展示当前配置；idle 可点、running 全置灰加解锁提示
  - 档案/供应商点开下拉选择后经 injectSession 带新配置+prompt；供应商下拉含不指定（本机默认）选项触发空串切回
  - 机器/智能体下拉为展示态：其它机器标二期置灰、跨引擎标需开新会话置灰（D-004@v2）
  - TurnTimeline 消息头部 who 行改读轮次 run 的配置快照（档案名/智能体名/供应商名，未选如实显示）
  - 切换 toast 提示下一轮生效历史保留
acceptance:
  - idle 切档案/供应商走 inject 新配置，running 全置灰
  - 机器/智能体控件仅展示无可选项
  - 切换后旧消息 who 行保持原配置
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - who 行数据来自 attach 历史 logs 的 run 级快照，不读会话当前配置（D-008）
  - 交互语义对齐 prototype-sessions-portal.html 样式 B
related_tests: []
---
