---
schema_version: 1
doc_type: module-card
module_id: components-daemon
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-daemon

## 定位
Daemon 运行时会话交互组件（`components/daemon/*.tsx`），承载"选 runtime → 建会话 → 实时聊天 / 历史回看 / 续聊"的完整交互。核心是 `RuntimeSessionDialog`（弹窗外壳 + 会话列表 + 右侧详情区），内部按会话状态分流到 Interactive / Quick / History 三种 section，SSE 实时流由 `useAgentRunStream` 接管。供 RuntimesPage 与工作区 runtime 页使用。

## 契约摘要
- `RuntimeSessionDialog`（`runtime-session-dialog.tsx`）：props `{ runtime, open, onClose, initialSessionId? }`；外壳组件，渲染 `RuntimeSessionDialogBody`；`key={runtime.id}` 由调用方传以强制重 mount 清旧态。
- `RuntimeSessionDialogBody`：内部实现，拉会话列表 → 按 `initialSessionId`/活跃态选中会话 → 根据 `isActiveSession` 切 Interactive（attach SSE + 轮询）或 History（只读 + 可续聊）。
- `InteractiveSessionPanel`（`interactive-session-panel.tsx`）：props 见 `InteractiveSessionPanelProps`，活跃会话的实时交互面板。
- `InteractiveSessionChatSection`（helpers）：交互式聊天区，预填历史 turn、连 SSE、提交 input。
- `QuickChatSessionSection`（helpers）：quick-chat（一次性问答）区。
- `SessionHistoryView`（helpers）：已结束/失败会话的历史回看，内部按 `canResumeSession` 决定续聊按钮可用性。
- `SessionsSidebar`（helpers）：左侧会话列表，按 `isActiveSession` 高亮。
- 辅助：`shortId(id)` 截短 ID；`isActiveSession(s)`（状态 ∈ `ACTIVE_SESSION_VIEW_STATUSES`）；`canResumeSession(session)`；`resumeDisabledTitle(session)`；`logsToTurns(logs)` 把历史日志按 run_id 分组转 `SessionTurnView[]` 预填 attach 面板；`ACTIVE_SESSION_VIEW_STATUSES` 活跃状态集合。
- 类型：`SessionTurnView`。

## 关键逻辑
- 会话分流（伪代码）：
  ```
  const active = restored ?? ordered.find(isActiveSession)
  if (isActiveSession(session)) → InteractiveSessionChatSection（连 SSE + 轮询到 active）
  else → SessionHistoryView（只读；canResumeSession 决定续聊按钮）
  ```
- 历史预填：拉 logs → `logsToTurns(logs)` → 作为 `initialTurns` 传 attach 面板，再切 attach 建 SSE。
- 续聊：History 区点续聊 → 走 attach 新会话流程（把历史 turn 带过去）。

## 注意事项
- `RuntimeSessionDialog` 必须由调用方绑 `key={runtime.id}`，否则切换 runtime 时旧会话/SSE 状态残留。
- 活跃判定完全依赖 `isActiveSession`（基于 status 集合），新增会话状态要同步更新 `ACTIVE_SESSION_VIEW_STATUSES`。
- attach 流程涉及 SSE 连接 + 轮询到 active 的竞态，改动需跑 `daemon/__tests__`（已有 runtime-session-dialog.test.tsx）。
- `logsToTurns` 按 run_id 分组，跨 run 的日志会被拆成多个 turn，渲染时用 `shortId(runId)` 标识。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
