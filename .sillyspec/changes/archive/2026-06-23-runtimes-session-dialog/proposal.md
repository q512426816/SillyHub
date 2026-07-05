---
author: qinyi
created_at: 2026-06-23T15:40:00+08:00
---

# Proposal: /runtimes 会话弹窗化 + active 续聊

## 动机

`/runtimes` 页面的会话交互体验有三个问题：会话区常驻页面底部导致整页过长、点 runtime 卡片「会话」是滚动跳转而非弹窗、active 会话点开后只能只读回看无法继续聊天。本次把会话区重构为弹窗并打通 active 续聊。

## 关键问题（现有方案为何不够）

1. **会话区常驻占满底部，页面过长**：`SessionListSection` 固定 `min-h-[520px]` 常驻页面底部，runtime 列表 + 会话区纵向堆叠，首屏信息密度低、滚动疲劳。
2. **「会话」按钮是滚动跳转而非弹窗**：`handleOpenSession = setFocusedRuntime + scrollIntoView`，用户点「会话」被拉到页面底部，脱离 runtime 卡片上下文，不符合「点击卡片→就地弹出」的现代交互预期。
3. **active 会话点开后无法继续聊天**：`handleSelect` 对所有会话（含 active）走只读 `SessionHistoryView`（`ql-20260619-007`），用户看一个进行中的会话却发不了消息。而 `InteractiveSessionPanel` 已具备 attach 模式（建 SSE + 轮询到 active），能力现成却未接到会话列表。

## 变更范围

- 新建 `runtime-session-dialog.tsx`：runtime 专属会话工作台弹窗（左历史会话列表 + 右会话区），自管会话状态。
- 新建 `runtime-session-helpers.tsx`：提取 `SessionsSidebar` / `SessionHistoryView` / `InteractiveSessionChatSection` / `logsToTurns` / `canResumeSession` 等。
- 改 `page.tsx`：移除底部常驻会话区，点「会话」开弹窗，runtime 卡片调大，URL `?session=` 恢复接弹窗 open。
- active 会话点开走 attach（非只读）。
- 测试同步更新 + 新增弹窗测试。

## 不在范围内（显式清单）

- 不改后端 API / 数据模型 / 会话状态机（纯前端）。
- 不支持同时打开多个 runtime 弹窗（单例 D-001）。
- 不新增 codex ended/failed 续聊（受 `canResumeSession` 限制，codex 只读）。
- 不改 AskUserQuestion 卡片 / 权限审批面板逻辑。
- 不改 runtime 注册 / 心跳 / 启禁用逻辑。
- 不保留页面常驻会话区双形态（直接替换）。

## 成功标准（可验证）

- **SC-1**：点 runtime 卡片「会话」→ 弹窗打开，左侧列出该 runtime 历史会话。
- **SC-2**：active 会话点开 → 可直接发送续聊，输入框可用。
- **SC-3**：ended/failed claude 会话 → 只读回看 + 「继续对话」可点 reopen。
- **SC-4**：codex ended → 只读，续聊按钮置灰。
- **SC-5**：弹窗关闭 → SSE/轮询清理无泄漏。
- **SC-6**：页面无底部常驻会话区，runtime 卡片更舒展。
- **SC-7**：会话活跃中刷新浏览器 → URL `?session=` 自动开弹窗 attach。
- **SC-8**：主动关闭弹窗 → 清 `?session=`，刷新不再自动弹。
- **SC-9**：`page.test.tsx` 全绿 + 新增 `runtime-session-dialog` 测试通过。
- **SC-10**：`pnpm lint` + `tsc --noEmit` 通过。
