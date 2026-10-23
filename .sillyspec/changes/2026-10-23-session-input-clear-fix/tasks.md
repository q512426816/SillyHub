---
author: flow-machine-draft
created_at: 2026-10-23T02:51:38.964Z
---
# 任务注册表（Tasks）— 2026-10-23-session-input-clear-fix

- [x] task-01: 写测试基线（FR-01/FR-02/FR-03）：`frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx` 追加两组 describe——「发送受理即清输入框文本（FR-01）」（真会话直发 / 预会话首句两条：mock 挂起 Promise，断言请求在途时输入框已空）、「受理即同步清草稿键（FR-03）」（真会话受理即清键 + 在途切走再切回不残留、预会话 `__pre__:scope` 键受理即清）；验证：`npx vitest run src/components/daemon/__tests__/session-panel-draft-scope.test.tsx`（改前 5 红：FR-01×2、FR-03×2、FR-04 改造×1）
- [x] task-02: 实现受理即清 + 失败恢复（session-panel-page.tsx）：新增 `clearInputAccepted()`（同步 `setInput("")` + `writeSessionDraft(sessionId, "", preDraftScope)`）与 `restoreRejectedSend(raw)`（仅输入框空时回填、草稿键空时写回）；handleSend 全路径（tool_report 接手 / /team 拦截 / 预会话 / 忙轮 / 空闲）改为受理即清；sendFromQueue/sendToServerQueue/handlePreSessionSend 新增 `rawPrompt` 第三参并在 catch 恢复；验证：FR-01/FR-02/FR-03 用例转绿
- [x] task-03: 群聊同款（group-chat-panel.tsx + `src/components/group-chat/__tests__/group-chat-panel.test.tsx`）：新增「发送受理即清：sendGroupMessage 未响应时输入框已空且草稿键已清」「发送失败：文本恢复到输入框可重试」两用例；performSend 受理点 `setDraft("")` + `writeGroupDraft(groupId, "")`，catch 按防空条件回填并写回草稿；验证：78 用例全绿（改前 2 红）
- [x] task-04: 预会话恒空白（session-panel-page.tsx 草稿回读 effect）：`sessionId` 非空才 `readSessionDraft`；预会话态 `setInput("")` + 清残留 `__pre__:scope` 键（dialog 模式不受影响，其恢复语义在另一文件保留）；同时把既有「同一入口重进：草稿恢复到输入框」用例改写为「输入框恒空白（新建=全新开始，残留键清除）」；验证：draft-scope 16 用例全绿
- [x] task-05: 门户预会话 nonce 强制重挂载（sessions-portal.tsx）：新增 `preMountNonce` 状态 + `openPreSession(ctx)` 统一写入点（enterPreSession 与组头直带链两处），key 改 `pre:<ws>:<rt>:<nonce>`；测试落 `src/components/sessions/__tests__/sessions-portal.test.tsx`「同机器同智能体再次「＋」新建：预会话输入框重置」；验证：该用例红绿双向实证（回退 nonce → `expected 'AAA' to be ''`）
- [x] task-06: 真会话草稿持久化零回归：draft-scope「A 输入草稿 → 切 B：B 显示自有草稿，A 的键不被 B 的写入污染」保持绿（回读/写入时序未改，仅预会话分支改语义）
- [x] task-07: 回归验证：`npx vitest run src/components/daemon/__tests__/session-panel src/components/daemon/__tests__/session-input-bar src/components/group-chat src/components/sessions "src/app/(dashboard)/sessions"` → 41 文件 / 945 用例全绿；`npx tsc --noEmit` 零错
