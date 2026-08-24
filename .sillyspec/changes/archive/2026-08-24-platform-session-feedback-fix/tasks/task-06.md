---
id: task-06
title: '前端新增 PlanApprovalCard 组件与 plan-response 提交'
title_zh: '前端新增 PlanApprovalCard 组件与 plan-response 提交'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-02', 'task-05']
blocks: ['task-09']
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/plan-approval-card.tsx
expects_from:
  task-02: 'POST /api/daemon/sessions/{session_id}/plan-response 端点契约'
  task-05: 'onPlanModeEntered 事件 envelope（含 PlanSummary / run_id）与 submitPlanResponse 提交函数'
goal: >
  实现 PlanApprovalCard UI 组件与 plan-response 提交函数：当 session 进入 plan_pending
  态时展示计划摘要，支持用户确认、要求修改或取消，并将决策回传后端。
implementation:
  - 创建 PlanApprovalCard 组件：props 含 sessionId、runId、summary、requestedAt、onSubmitted
  - 展示 objective、tasks 列表、design_snippet；提供确认/修改/取消三态按钮
  - 修改/取消必须填写 feedback；调用 task-05 提供的 submitPlanResponse 提交决策
  - 提交时锁定按钮并处理 200/422/404 错误
  - 提交成功后调用 onSubmitted，由父组件在 task-09 中移除卡片
acceptance:
  - confirm 提交无需 feedback；revise/cancel 提交必须带非空 feedback
  - 422 返回时行内展示错误文案，按钮恢复可点
  - 提交中按钮禁用，防止重复提交
  - 组件在 page 与 dialog 模式下均可正常渲染
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/plan-approval-card.test.tsx
constraints:
  - 不直接修改 session turn state 或 timeline（集成归 task-09）
  - 不绕过 REST 直接调用 daemon WebSocket
  - 仅 revise/cancel 强制 feedback
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
