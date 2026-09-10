---
id: task-05
title: 'Wave 5 前端：gen:types + PATCH 客户端 + 手写 interface 同步 + SessionConfigBar 开关'
title_zh: 'Wave 5 前端：gen:types + PATCH 客户端 + 手写 interface 同步 + SessionConfigBar 开关'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P1
depends_on: ['task-04']
blocks: ['task-06']
requirement_ids: ['FR-06']
decision_ids: ['D-004@v1']
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
target_files:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/sessions/session-config-bar.tsx
goal: >
  pnpm gen:types 重生成（node_modules 健康先查，CLAUDE.md 规则 21）；lib/daemon/ 加 updateSessionAutoResume PATCH 客户端；手写 interface 同步（plan 审查 P0-1 附带）——前端实际消费的 SessionRunRead 是 lib/daemon/sessions.ts:601 手写 interface（对齐后端手工维护），补 metadata 字段（徽标数据源）；session-config-bar.tsx 增「中断自动续跑」开关（默认开；关闭调 PATCH enabled=false；三态显示对齐配置条既有开关样式与 title 说明惯例）。
implementation: >
  pnpm gen:types 重生成（node_modules 健康先查，CLAUDE.md 规则 21）；lib/daemon/ 加 updateSessionAutoResume PATCH 客户端；手写 interface 同步（plan 审查 P0-1 附带）——前端实际消费的 SessionRunRead 是 lib/daemon/sessions.ts:601 手写 interface（对齐后端手工维护），补 metadata 字段（徽标数据源）；session-config-bar.tsx 增「中断自动续跑」开关（默认开；关闭调 PATCH enabled=false；三态显示对齐配置条既有开关样式与 title 说明惯例）。
acceptance: >
  开关组件用例：默认开渲染/点击调 PATCH/关态回显；api-types 含新端点与 SessionRunRead.metadata；手写 interface 编译通过；tsc 0 错。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
base_commit: '76c15a7884ce9cbba09b429733e37b7382bb5377'
head_commit: 'ba57735d3ae4d568b08c8ae4f103d75bc8dfffb0'
---


## 验收标准

开关组件用例：默认开渲染/点击调 PATCH/关态回显；api-types 含新端点与 SessionRunRead.metadata；手写 interface 编译通过；tsc 0 错。
