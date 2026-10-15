---
id: task-04
title: 'Expose mode control in group settings and wizard'
title_zh: '前端设置面——模式控件三态联动+双端 gen:types'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:29:18
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/group-chat/member-panel.tsx
  - frontend/src/components/group-chat/create-group-wizard.tsx
  - frontend/src/components/group-chat/__tests__/member-panel.test.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
target_files:
  - frontend/src/components/group-chat/member-panel.tsx
  - frontend/src/components/group-chat/create-group-wizard.tsx
  - frontend/src/components/group-chat/__tests__/member-panel.test.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
expects_from:
  task-01:
    - contract: AgentGroupChat.cross_mention_mode
      needs: [cross_mention_mode]
goal: >
  群设置与建群向导新增互@模式选择控件（三态联动禁用），双端类型再生成保持契约对齐。
implementation:
  - 先确认 task-01 的后端 schema 已落（pnpm gen:types 依赖新字段出现在 openapi.json）
  - member-panel.tsx 群设置区（consensus 块 :362-402 同构位置）新增互@模式 Radio.Group（私聊化/公开委派，中文文案）：总开关关时禁用并提示需先开启 agent 互@；consensus_mode 开时禁用并提示汇总模式下由收口人统一发言；变更走既有 updateGroupChat PATCH
  - create-group-wizard.tsx 第三步护栏区（:414 附近）加同款可选项默认 private（D-002）
  - 控件样式用 antd Radio.Group 与 brand-* 语义阶类名（禁 blue-* 于品牌色，禁手写组件色，双主题随 data-theme 换肤）
  - 跑 pnpm gen:types 与 pnpm -C sillyhub-daemon gen:types 并提交 frontend/src/lib/api-types.ts、backend/openapi.json、sillyhub-daemon/src/api-types.ts（规则 21 双端义务）
  - member-panel.test.tsx 新增三态联动断言：默认可切/总开关关禁用/consensus 开禁用带提示
acceptance:
  - 三态联动行为正确（默认可切、开关关禁用、consensus 开禁用且有中文提示）
  - 向导默认 private 不勾选公开委派
  - 双端 api-types 与 openapi.json 一致且已提交
  - member-panel.test.tsx 全绿
verify:
  - cd frontend && pnpm exec vitest run src/components/group-chat/__tests__/member-panel.test.tsx
  - cd frontend && pnpm gen:types && git status --porcelain src/lib/api-types.ts ../backend/openapi.json ../sillyhub-daemon/src/api-types.ts
constraints:
  - 不改投影行渲染组件（气泡复用现状，delegation_of 标签为可选增强不在本卡）
  - 不动 typing/presence/consensus 既有控件
  - gen:types 前先确认 node_modules 健康（tsc --version 可跑），坏则 pnpm install --force 再生成
related_tests:
  - path: frontend/src/components/group-chat/__tests__/member-panel.test.tsx
    reason: 设置区新增控件需同步三态联动断言（新增非失效，已纳入本卡 allowed_paths）
  - path: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
    reason: gen:types 后 GroupChatRead 必填新字段，既有 fixture 缺字段 tsc 挂——按规则 21 顺手补（create-group-wizard/session-list-panel 同款）
---
