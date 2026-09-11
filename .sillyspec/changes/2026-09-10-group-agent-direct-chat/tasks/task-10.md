---
id: task-10
title: 'frontend settings, status card and generated types'
title_zh: '前端与类型（开关/设置区/状态卡/api-types）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-1.1, FR-1.6]
decision_ids: [D-002@v1, D-006@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/components/group-chat/create-group-wizard.tsx
  - frontend/src/components/group-chat/member-panel.tsx
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  - frontend/src/components/group-chat/__tests__/member-panel.test.tsx
target_files:
  - frontend/src/lib/api-types.ts
  - frontend/src/components/group-chat/create-group-wizard.tsx
  - frontend/src/components/group-chat/member-panel.tsx
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  - frontend/src/components/group-chat/__tests__/member-panel.test.tsx
expects_from: "task-02 OpenAPI 字段（consensus_mode/consensus_timeout_seconds/consensus_task_id/consensus_role）"
goal: >
  前端呈现汇总模式：向导与群设置区开关+超时输入，群聊面板状态卡渲染（consensus_card 驱动、同 log_id 替换），api-types 重生成并提交。
implementation:
  - "pnpm gen:types 重生成 api-types.ts（openapi.json 同步提交）"
  - "create-group-wizard.tsx：汇总模式开关+超时输入（照 agent_cross_mention 形态，默认关/600）"
  - "member-panel.tsx：群设置区开关+超时 PATCH（照 typing_preview 局部 PATCH 先例，顶层列字段）"
  - "group-chat-panel.tsx：channel=system 且 metadata.consensus_card 的行渲染状态卡（进行中/超时/已收口/中止四态+成员名单状态），同 log_id 事件内容替换（seenLogIds 适配）"
  - "两测试文件补用例：状态卡四态渲染+同 log_id 替换；设置区交互"
acceptance:
  - "组件测试全绿（collecting/timeout/closed/aborted 四态+替换更新）"
  - "pnpm exec tsc --noEmit 通过；api-types 含新字段"
  - "交互走查对照原型 prototype-consensus-mode.html（开关默认关、超时范围 60~3600）"
verify:
  - "cd frontend && pnpm exec tsc --noEmit && pnpm test -- group-chat"
constraints:
  - "不加新端点调用"
  - "不改 SSE 通道结构"
  - "daemon 目录零改动"
---

<!-- task-10: 前端与类型（开关/设置区/状态卡/api-types）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
