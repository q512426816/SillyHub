---
id: task-10
title: frontend form tests
title_zh: 前端表单测试
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P1
depends_on: [task-07]
blocks: []
allowed_paths:
  - frontend/src/components/__tests__/agent-profile-form.test.tsx
goal: >
  覆盖第二层联动、Codex 禁用、编辑态回显、提交 body。
implementation:
  - 第一层切换引擎时第二层选项联动
  - Codex 引擎下第二层禁用
  - 编辑态未知 id 占位且提交不解绑
  - 提交 body 含 llm_provider_id，null 表示解绑
acceptance:
  - 联动、禁用、回显、body 四类断言通过
verify:
  - cd frontend && pnpm test agent-profile-form
constraints:
  - mock listLlmProviders 返回固定 claude 类列表
  - 覆盖 FR-07 / FR-09
---
