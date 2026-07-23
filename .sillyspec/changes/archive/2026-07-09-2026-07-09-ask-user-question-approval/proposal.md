---
author: qinyi
created_at: 2026-07-09 11:30:00
change: 2026-07-09-ask-user-question-approval
---

# 提案书（Proposal）

## 动机
AskUserQuestion 是 agent 在执行中向用户提问的结构化问答（带 header/question/options）。当前在 `/approvals` 审批中心**看不到卡片**（scan/stage + 普通对话两场景都看不到），即便显示也「光审批不知道在审什么」——缺来源上下文与跳转。用户无法在统一的审批中心审阅和回答 agent 的提问。

## 关键问题
1. **审批中心看不到 AskUserQuestion 卡片**：SessionPermissionPanel 只聚合 scan 类型 session（`approvals/page.tsx:102`），普通对话不订阅；且渲染未按 `dialog_kind` 分流（统一用 PermissionApprovalCard，不用 AskUserDialogCard）。诊断确认链路本身通（runtime 弹窗有卡片，D-001），断点纯在前端聚合范围 + 渲染分流。
2. **光审批不知道在审什么**：即使卡片出现，也只显示 allow/deny 或裸问答，缺「来源上下文」（哪个工作区/会话/运行/什么场景/agent 在做什么）+ 跳转入口，审批者无法判断（D-002）。
3. **刷新丢失**：dialog 永久等待用户（不超时），但审批中心靠 SSE 实时推送不重放历史，刷新页面后 pending 的 AskUserQuestion 消失。

## 变更范围
- **backend**：新增只读端点 `GET /api/workspaces/{id}/dialogs`（挂 agent router，三表 JOIN 聚合 pending SessionDialogRequest + 来源上下文 workspace_name/session_type/run_summary）
- **frontend**：SessionPermissionPanel 渲染分流（AskUserDialogCard vs PermissionApprovalCard）+ 聚合范围扩 scan+chat + 来源上下文条 DialogContextBar + 跳转 + SSE 实时 + 查询兜底（刷新不丢）
- **daemon**：无改动（D-001，链路已通）

## 不在范围内（显式清单）
- 不修改 daemon/backend 的 AskUserQuestion PERMISSION_REQUEST 持久化链路（D-001）
- 不做 AskUserQuestion 历史回看（已回答的，YAGNI）
- 不改 runtime 会话弹窗（interactive-session-panel 已正常分流）
- 不改 workspace 工具网关审批（listPendingApprovals，与 dialog 无关）
- 不改 SessionDialogRequest schema（无迁移）

## 成功标准（可验证）
- scan/stage + 普通对话触发 AskUserQuestion，`/approvals` 审批中心均显示结构化问答卡（header/question/options）
- 卡片含来源上下文条 + 跳转（会话→`/runtimes?session=id`），审批者知道「谁在什么场景问了什么」
- 刷新 `/approvals` 后未回答的卡片仍在（数据库兜底）
- 新 AskUserQuestion 实时弹（SSE <2s）
- 三端测试全绿，既有行为零回归（runtime 弹窗 / 工具网关审批不受影响）
