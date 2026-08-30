---
author: qinyi
created_at: 2026-08-28 03:15:20
plan_level: full
change: 2026-08-28-session-ppm-task-binding
---

# 实现计划（Plan）— 会话关联 PPM 任务/问题 + 发起团队预选修复

## Spike 前置验证

不需要。绑定模式已有 change/quicklog 两个先例（2026-08-25-session-spec-binding），附件物化走既有 SessionAttachment 协议，技术方案确定性高。

## Wave 1（并行，无依赖）

- task-01
- task-07

## Wave 2（依赖 Wave 1）

- task-02

## Wave 3（依赖 Wave 2，两任务并行）

- task-03
- task-04

## Wave 4（依赖 Wave 3）

- task-05

## Wave 5（依赖 Wave 4；task-05/06 共改 session-panel.tsx 故拆 Wave 串行，防并行覆盖）

- task-06

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端绑定基座：ppm_item_session_links 表 + Alembic 迁移 + bind helper + GET /api/ppm/item-sessions 读取端点 + main.py 挂载 | W1 | P0 | — | FR-01, D-005@v1, D-004@v2 | 单表 kind（plan_task/problem），唯一约束，workspace_id 升序解析 helper |
| task-07 | 「发起团队」预选修复：store autoTeamIntent/autoTeamOpen 通道 + team-trigger-popover defaultProjectId 预选（项目+第一个工作区+objective 预填） | W1 | P0 | — | FR-06, D-004@v2 | 独立 bug 修复，不依赖绑定基座 |
| task-02 | 后端通道：SessionCreateRequest/SessionInjectRequest 新字段 + create_session 绑定与工作区解析 + inject 追问绑定 + 会话列表 ppm 筛选 | W2 | P0 | task-01 | FR-01, FR-02, FR-05 | item 不存在降级不报错（对齐 quicklog 容错） |
| task-03 | 后端上下文注入：build_ppm_item_context_preamble 前导 + PPM 附件物化/降级（_can_access + flush-only 事务拆分） | W3 | P0 | task-02 | FR-03, D-003@v1, D-006@v1, D-007@v1 | 物化在前、前导消费 attachment_lines；降级路径全覆盖 |
| task-04 | 前端 API 层：pnpm gen:types + lib/daemon.ts 参数透传（createSession/injectSession/listAgentSessions）+ listItemSessions | W3 | P0 | task-02 | FR-01, FR-05 | api-types.ts + backend/openapi.json 同变更提交（TaskCard allowed_paths 须含两者） |
| task-05 | 前端任务/问题侧入口与卡片：store pendingPpmItem 挂起位 + 发起会话入口（task-plans/workbench/problem-drawer）+ ppm-item-sessions-card | W4 | P0 | task-03, task-04 | FR-04, D-001@v1, D-004@v2 | 前端解析第一个关联工作区（同键 workspace_id 升序） |
| task-06 | 前端 @联想与筛选：mention-sources PPM 分组（默认进行中可切全部）+ query-keys + popover 渲染 + 会话列表筛选 ppm 选项 | W5 | P1 | task-04 | FR-02, FR-05, D-001@v1, D-002@v1 | 任务=listPersonalPlanTasks(status=[进行中])，问题=duty_user_id=me |

## 关键路径

task-01 → task-02 → task-03/04 → task-05 → task-06（task-05 依赖 task-03 注入行为做端到端验收；task-06 与 task-05 共改 session-panel.tsx，拆 Wave 串行防并行覆盖）

## 全局验收标准

1. 后端：绑定点（创建/追问/列表/读取端点）+ 前导注入 + 附件物化/降级的单测通过（pytest 相关模块，禁全量）
2. 前端：gen:types 无 diff 残留；相关组件测试通过（vitest 单文件）；不破坏 session-panel 既有测试
3. 集成冒烟（integration-critical）：真实创建携带 ppm item 的会话，验证首条 user 消息含【PPM 任务上下文】前导 + 附件注入；从任务详情卡片深链打开会话
4. （brownfield）不带 ppm 参数的请求行为与现状一致（零回归）
5. 「发起团队」：PPM 项目页点击后弹层自动打开且项目/工作区/目标预填
6. 连带既有测试归属（plan-review GAP-1）：受影响既有测试在各 TaskCard 的 related_tests 声明并随 task 适配——task-02/03 对应 backend/app/modules/daemon/tests/（test_change_session/test_session_service/test_page_context_preamble/test_inject_first_turn_briefing 等）；task-04 对应 mock lib/daemon.ts 的组件测试补新参数；task-05 对应 session-panel-pre-session/floating-session(-host) 测试；task-06 对应 session-mention 系列与 session-list-panel 测试；task-07 对应 team-trigger-popover/session-panel-team/floating-session(-host) 测试。FR-02（@联想→首句/追问提交）与 FR-05（前端筛选）须有明确 GWT 用例进 TaskCard（plan-review NOTE-2）。

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-06 | FR-02/FR-04 验收（GWT） |
| D-002@v1 | task-06 | @联想分组默认进行中可切全部 |
| D-003@v1 | task-03 | 物化注入 + 降级清单路径测试 |
| D-004@v2 | task-01, task-05, task-07 | workspace_id 升序同键断言 |
| D-005@v1 | task-01 | 单表 kind 迁移 + 唯一约束 |
| D-006@v1 | task-03 | SessionAttachment 物化 + daemon 零改动 |
| D-007@v1 | task-03 | _can_access 口径 + 无权仅列文件名 |
