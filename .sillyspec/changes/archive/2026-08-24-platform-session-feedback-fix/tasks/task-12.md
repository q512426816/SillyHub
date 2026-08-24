---
id: task-12
title: 'Frontend tests cover new components and event dispatch'
title_zh: '前端测试覆盖新组件与事件分发'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-06', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/plan-approval-card.test.tsx
  - frontend/src/components/daemon/__tests__/bash-progress-card.test.tsx
  - frontend/src/components/daemon/__tests__/ask-user-dialog-minimize.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
goal: >
  为前端 PlanApprovalCard、BashProgressCard、askuser 最小化及 SessionPanel 事件分发
  补充 vitest + React Testing Library 测试，确保 SSE 新事件正确渲染与交互回传。
implementation:
  - 新建 plan-approval-card.test.tsx，覆盖渲染、确认/修改/取消按钮、feedback 校验、API 提交
  - 新建 bash-progress-card.test.tsx，覆盖 running/completed/failed 状态、stdout/stderr 追加、截断
  - 新增/扩展 askuser 最小化测试，覆盖最小化/还原、浮动胶囊角标、不影响提交
  - 扩展 session-panel-dialog.test.tsx，验证 plan_mode_entered / bash_status / bash_chunk 事件路由到对应卡片
acceptance:
  - vitest 通过，新增组件渲染与事件分发断言与 design.md 一致
  - askuser 最小化不破坏既有 permission_request 流程
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/plan-approval-card.test.tsx src/components/daemon/__tests__/bash-progress-card.test.tsx src/components/daemon/__tests__/ask-user-dialog-minimize.test.tsx src/components/daemon/__tests__/session-panel-dialog.test.tsx
constraints:
  - 仅新增/扩展测试文件，不修改生产实现来适配测试
  - mock streamSession 与新事件 handler，避免真实 SSE 连接
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
