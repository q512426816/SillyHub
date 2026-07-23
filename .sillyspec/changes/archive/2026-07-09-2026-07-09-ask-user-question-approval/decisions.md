---
author: qinyi
created_at: 2026-07-09T11:08:00
change: 2026-07-09-ask-user-question-approval
---

# 决策台账 · AskUserQuestion 审批中心集成

## D-001@v1: 链路通，断点在前端 SessionPermissionPanel（不修 daemon/backend 链路）
- type: premise
- status: accepted
- source: user + code
- priority: P0
- question: AskUserQuestion 进 session_dialog_requests 的链路是否断了？方案是否需含 daemon/backend 链路修复？
- answer: 链路完全通——runtime 会话弹窗（interactive-session-panel）能正常显示 AskUserQuestion 问答卡（用户确认）。代码层面 daemon session-manager.ts:1130 拦截传 dialogKind='AskUserQuestion' + permission-resolver.ts:162 写 dialog_kind/dialog_payload + backend permission_service.handle_permission_request 见 dialog_kind 持久化 session_dialog_requests + 发 permission_request SSE，端到端完整。断点纯在前端审批中心 SessionPermissionPanel：①approvals/page.tsx:102 listWorkspaceAgentSessions 只 filter "scan" 不含普通对话 session；②session-permission-panel.tsx:111 渲染统一用 PermissionApprovalCard，未按 dialog_kind 分流到 AskUserDialogCard。
- normalized_requirement: 方案不修改 daemon/backend 的 PERMISSION_REQUEST 持久化链路；仅聚焦前端 SessionPermissionPanel 聚合范围扩大 + 渲染分流 + 新增 workspace 级只读查询端点（读既有 session_dialog_requests，不动既有链路）。
- impacts: FR-4 从「诊断+修复链路断点」改为「前端聚合/渲染修复 + 只读查询端点」；方案范围大幅缩小（三端 → 前端 + 1 只读端点）；plan 任务不含 daemon 改动。
- evidence: 用户轮次确认「runtime 弹窗有卡片」；源码 sillyhub-daemon/src/interactive/session-manager.ts:1107-1132、permission-resolver.ts:135-169、backend/app/modules/daemon/permission_service.py:174-311/361-403、frontend/src/components/ask-user-dialog-card.tsx、frontend/src/components/permissions/session-permission-panel.tsx。

## D-002@v1: 审批卡片必须带来源上下文 + 跳转入口
- type: boundary
- status: accepted
- source: user
- priority: P0
- question: 审批中心只显示 AskUserQuestion 问答内容够吗？
- answer: 不够。用户原型反馈原文：「不能光显示问答啊，要显示具体的来源呀并且可以跳转过去，不然问答审批什么东西呢，要有一定的上下文提示啊」。审批者必须知道「谁（哪个会话/运行）在什么场景（scan/对话/变更阶段）下问了什么、为什么」，且能跳转看完整上下文。
- normalized_requirement: 每张审批卡片必须包含「来源上下文条」——工作区名 · 场景类型（scan/对话/stage）· 会话 ID（可点跳转 runtime 会话详情）· 运行 ID（可点跳转运行日志）· 时间 · 上下文一句话（agent 当前在做什么）；卡片头加「查看会话」跳转入口。backend GET /workspaces/{id}/dialogs 端点必须 JOIN 返回这些上下文字段（workspace 名 / session 类型 / run 任务简述 / 场景）。
- impacts: FR-4（来源上下文+跳转）；design §4.1 端点 DTO 扩展上下文字段；§4.4 前端卡片渲染来源上下文条 + 跳转链接；prototype-ask-user-question-approval.html 已体现。
- evidence: 用户原型反馈轮次（step10 第二次确认）。

## D-003@v1: run_summary 取任务 prompt + session_type 用 change_id 区分 stage
- type: architecture
- status: accepted
- source: user（Design Grill step12 交叉审查确认 U1/U2）
- priority: P1
- question: design §4.1 的 run_summary 数据源（AgentRun 无现成「正在做什么」字段）+ session_type 的 stage 如何识别（代码里 stage 与 scan 都走 interactive lease，lease.kind 只有 batch/interactive，无标记列区分）
- answer: run_summary 取「任务 prompt」——scan/stage 取 `lease.metadata.prompt`（placement.py 写入的执行指令），对话取首条 user channel 的 `AgentRunLog.content`（用户首句）；取不到则 DTO 返回 null，前端占位「会话进行中」。session_type 三类——`stage`：`AgentRun.change_id` 非空；`scan`：`config.mode=="scan"` 且 change_id 空；`chat`：`config.mode!="scan"`。
- normalized_requirement: `GET /workspaces/{id}/dialogs` 返回 `run_summary`（任务 prompt 派生，可空→前端占位「会话进行中」）+ `session_type`（scan/chat/stage，基于 `config.mode` + `AgentRun.change_id` 推导）。
- impacts: design §4.1 端点实现（三表 JOIN + 取 lease.metadata.prompt / AgentRunLog 首条 + change_id 判 stage）；§4.4 前端 run_summary 空占位；AC-3/AC-7；plan 实现任务。
- evidence: 用户 Design Grill 确认轮次（step12 U1 取任务 prompt + U2 用 change_id 区分）；代码 AgentRun.change_id（backend/app/modules/agent/model.py）+ lease.metadata.prompt（backend/app/modules/daemon/router.py:2184 pending-leases）+ AgentRunLog（agent/model.py）。
