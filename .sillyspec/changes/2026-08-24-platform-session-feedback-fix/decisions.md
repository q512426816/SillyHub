# 决策记录 — 平台会话实时反馈修复

## D-001@v1: plan 模式采用强确认交互

- **type**: architecture
- **status**: accepted
- **source**: user
- **question**: plan 模式需要强确认还是弱提示？
- **answer**: 强确认，类似 askuser 弹窗。
- **normalized_requirement**: 当 session 收到 `plan_mode_entered` 事件时，必须渲染可交互的 PlanApprovalCard，且 Agent 在收到 `plan_response` 前不得继续执行。
- **impacts**: [FR-02, task-02, task-06, task-07, verify-02]
- **evidence**: 用户回答轮次 2026-08-24 10:05
- **锚点**: `frontend/src/components/daemon/plan-approval-card.tsx`
- **模块域**: backend, frontend, sillyhub-daemon

## D-002@v1: 采用方案 A 复用现有 SSE 事件通道

- **type**: architecture
- **status**: accepted
- **source**: user
- **question**: 选择哪种技术方案实现平台会话反馈修复？
- **answer**: 方案 A，复用现有 Redis `agent_session:{id}` 频道，新增 `plan_mode_entered` / `bash_status` / `bash_chunk` 事件类型。
- **normalized_requirement**: 新增事件必须走现有 session SSE 通道，不新建独立通道；前端在 `SessionStreamEnvelope` 中新增事件解析分支。
- **impacts**: [FR-01, FR-02, task-01, task-04, task-05]
- **evidence**: 用户回答轮次 2026-08-24 10:18
- **锚点**: `backend/app/modules/daemon/run_sync/service.py`
- **模块域**: backend, frontend, sillyhub-daemon

## D-003@v1: askuser 弹窗支持最小化

- **type**: boundary
- **status**: accepted
- **source**: user
- **question**: askuser 弹窗体验如何优化？
- **answer**: 可最小化，最小化后收缩为右下角浮动胶囊，点击可还原，不遮挡会话主内容。
- **normalized_requirement**: 所有 askuser / permission 弹窗必须支持最小化状态；最小化后显示未决角标，点击可还原。
- **impacts**: [FR-03, task-08, verify-03]
- **evidence**: 用户补充需求 2026-08-24 10:22
- **锚点**: `frontend/src/components/permissions/ask-user-dialog-card.tsx`
- **模块域**: frontend
