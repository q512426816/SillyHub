---
id: task-09
title: '前端 SessionPanel 接入新事件与卡片渲染'
title_zh: '前端 SessionPanel 接入新事件与卡片渲染'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-06', 'task-07', 'task-08']
blocks: ['task-12']
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
expects_from:
  task-06: 'PlanApprovalCard 组件与 submitPlanResponse 提交能力'
  task-07: 'BashProgressCard 组件'
  task-08: 'askuser / permission 弹窗最小化能力'
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  在 SessionPanel 的 page/dialog 两模式下接入 plan_mode_entered、bash_status、bash_chunk 三类新 SSE 事件，渲染 PlanApprovalCard 与 BashProgressCard，并确保 askuser 最小化能力不回归。
implementation:
  - 复用 task-05 在 lib/daemon.ts 提供的 onPlanModeEntered / onBashStatus / onBashChunk 回调（事件解析归 task-05，本 task 只在 SessionPanel 挂接处理）。
  - SessionPanel page/dialog 分支分别新增 planPending 与 bashProgress 状态映射；SSE 收到对应事件时写入状态，按 run_id / command 去重。
  - 在 page/dialog 渲染区合适位置（消息流上方或时间线内）挂载 PlanApprovalCard 与 BashProgressCard；PlanApprovalCard 通过 POST /api/daemon/sessions/{session_id}/plan-response 提交用户决策。
  - 保留并复用 task-08 的最小化能力：askuser / permission 弹窗的最小化胶囊与 plan/bash 卡片互不干扰。
  - 对不认识的事件保持原有忽略策略，确保旧版本 daemon 或不支持新事件的会话零回归。
acceptance:
  - 真实会话触发 plan 模式后，SessionPanel 渲染 PlanApprovalCard，用户选择确认/修改/取消后后端收到正确决策。
  - Bash 命令执行期间渲染 BashProgressCard，实时追加 stdout/stderr 输出，命令结束后显示最终状态与退出码。
  - askuser / permission 弹窗仍可正常最小化、还原与提交（task-08 能力不回归）。
  - 未升级 daemon 或旧会话没有新事件时，页面表现与当前一致。
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/plan-approval-card.test.tsx src/components/daemon/__tests__/bash-progress-card.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改动 Agent SDK 与 daemon 内部实现逻辑。
  - 不新增独立 SSE 通道，复用现有 agent_session:{id} Redis Pub/Sub 通道。
  - 不修改现有 permission_request / turn_started / log 处理流程。
  - PlanApprovalCard、BashProgressCard 的具体实现由 task-06 / task-07 提供，弹窗最小化由 task-08 提供；本 task 只负责在 session-panel.tsx 中接入与事件分发，不修改上述组件与 lib/daemon.ts。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
