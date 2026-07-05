---
author: qinyi
created_at: 2026-06-23T15:24:00+08:00
---

# decisions: 2026-06-23-runtimes-session-dialog

> 本次变更的决策台账（非长期术语表）。仅记录有实现 / 验收影响的决策。

## D-001@v1 弹窗单例

- type: boundary
- status: accepted
- source: user（Step6 选「专注 runtime 列表」语义）+ code（单 state 自然单例）
- question: 是否允许同时打开多个 runtime 的会话弹窗？
- answer: 单例，一次只开一个，打开新的自动关闭旧的。
- normalized_requirement: `page.tsx` 持有单一 `dialogRuntime` state，`RuntimeSessionDialog` 的 open 由其驱动；切换 runtime 即替换（重 mount）。
- impacts: [FR-1, Phase-3, R-04]

## D-002@v1 弹窗打开默认态

- type: boundary
- status: accepted
- source: design（合理默认，从 sessions 列表判断）
- question: 点 runtime 卡片「会话」打开弹窗时，默认显示什么？
- answer: 有活跃会话（active/pending/reconnecting）→ 自动 attach 最近活跃会话；无活跃 → idle 新建空白面板。
- normalized_requirement: `RuntimeSessionDialog` open 后，若 `sessions` 含活跃会话则 attach 最近活跃；否则进入 idle 新建（`InteractiveSessionChatSection` 无 attach）。
- impacts: [Phase-1]

## D-003@v1 URL `?session=` 刷新恢复

- type: compatibility
- status: accepted
- source: code（现有 `?session=` 机制）
- question: 弹窗模式下 URL `?session=` 恢复是否保留？
- answer: 保留。刷新后若 `?session` 指向活跃会话 → 自动打开对应 runtime 弹窗并 attach；ended/failed/不存在 → 清 param 不开弹窗。
- normalized_requirement: `page.tsx` mount 读 `?session=`，`getAgentSession` 查 `runtime_id` 与 status；活跃则 `setDialogRuntime` + 弹窗内 attach，否则 `clearSessionParam`。
- design-grill 补强（C-3）：弹窗 `onClose` 主动关闭 → `clearSessionParam`（放弃恢复点）；写入仍由 `InteractiveSessionChatSection.onSessionCreated` 负责。语义=会话活跃中刷新可恢复，主动关闭则不恢复。
- impacts: [FR-4, Phase-4, R-03]

## D-004@v1 active 续聊复用 attach 模式

- type: architecture
- status: accepted
- source: code（`InteractiveSessionPanel.attachSessionId`）
- question: active 会话如何支持继续聊天（替代 `ql-20260619-007` 提到的「更大重构」）？
- answer: 复用 `InteractiveSessionPanel.attachSessionId` 模式——预填 `logsToTurns(history)` + 建 SSE + 轮询到 active + 启用 inject 续发。不新增 LivePanel resume 重构。
- normalized_requirement: active 会话点开走 attach（非只读 `SessionHistoryView`）。预填历史 turn 与 SSE 进行中 turn 按 `run_id` 去重合并（`TERMINAL_TURN_STATUSES` 幂等兜底）。
- impacts: [FR-2, Phase-2, R-01]
