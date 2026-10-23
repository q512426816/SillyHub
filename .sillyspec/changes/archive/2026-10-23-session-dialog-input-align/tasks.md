---
author: flow-machine-draft
created_at: 2026-10-23T03:33:04.639Z
updated_by: admin2-dialog-input-fix
---
# 任务注册表（Tasks）— 2026-10-23-session-dialog-input-align

- [x] task-01: 发送受理即清（FR-01）：`session-panel-dialog.tsx` 新增 `clearInputAccepted()`（`setInput("")` + 同步 `writeSessionDraft(..., "", ...)`），在 `handleSend` 守卫全过后、三条路径（idle 首句 create / 活跃轮直发 submitFollowup / 忙轮排队 sendToServerQueue）派发前调用一次；`/team` 拦截路径同点位复用。既有 `onSendSettled` 的 setInput 清空守卫保留（幂等）。落点测试：`session-panel-draft-scope.test.tsx`「dialog 发送受理即清输入框文本（FR-01）」3 例（idle 首句 / 活跃轮直发 / 忙轮排队，均断言请求未 resolve 时输入框已空）。
- [x] task-02: 失败恢复（FR-02）：新增 `restoreRejectedSend(raw)`（仅输入框空时回填 + 仅草稿键空时写回），接线三处失败路径——`sendToServerQueue` 新增第三参 `rawPrompt` 并在 catch 恢复；`handleSend` 的 idle `createSession` catch（原实现丢文本）；`handleSend` 的 `submitFollowup` catch。`handleResend` 不走输入框语义，边界记为不回填（design 风险与死路）。落点测试：同 describe「dialog 发送失败恢复文本（FR-02）」3 例。
- [x] task-03: 受理即同步清草稿键（FR-03）：`clearInputAccepted` 内直接 `writeSessionDraft` 落盘，不依赖 `setInput → 写草稿 effect` 链路（浮窗卸载时 effect 不跑）。落点测试：同文件「dialog 受理即同步清草稿键（FR-03）」2 例（真会话卸载后重开空白 / idle `__pre__:<workspaceId>` 键清空）。
- [x] task-04: idle 恒空白（FR-04）：草稿回读 effect 改 `view.sessionId ? readSessionDraft(view.sessionId, ...) : (setInput("") + writeSessionDraft(null, "", ...))`；真会话回读语义零变化。落点测试：同文件「dialog idle 态恒空白 + 真会话草稿不回归（FR-04）」2 例 + 既有 dialog scope describe 中「同 workspaceId 重开 dialog（idle）」改写为「输入框恒空白（残留键清除）」。
- [x] task-05: 验证面：`npx vitest run src/components/daemon/__tests__/session-panel*`（23 文件 / 275 例）+ `src/components/group-chat src/components/sessions "src/app/(dashboard)/sessions"`（14 文件 / 624 例）全绿；`npx tsc --noEmit` 零错；`npx eslint` 改动两文件仅余 2 条存量警告（`WsRefDesc` 未用、`connGuard` deps，HEAD 版即存在），本次新增代码零警告。
- [x] task-06: 文档同步：`requirements.md` 补「成功标准承接（原文逐字）」一节消除门柱漂移；`design.md` 接口契约按实现修订（`submitFollowup` 未加参——失败恢复由 `handleSend` catch 承担；`sendToServerQueue` 加第三参 `rawPrompt`）。
