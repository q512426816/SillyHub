---
id: task-03
title: active 会话走 attach 续聊（Wave-2）
priority: P1
estimated_hours: 2
depends_on: [task-01, task-02]
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
author: qinyi
created_at: 2026-06-23T10:29:26+08:00
---

# task-03: active 会话走 attach 续聊

> 在 `RuntimeSessionDialog`（task-02 产物）内实现 `handleSelect` 分支：active 会话走 attach 续聊，ended/failed 仍走只读 `SessionHistoryView`。
> 覆盖：FR-02、D-004@v1、R-01。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `frontend/src/components/daemon/runtime-session-dialog.tsx` | 修改 | `handleSelect` 增加 active 分支：拉 logs → `logsToTurns` 预填 → `setAttachSession`；右侧渲染走 `InteractiveSessionChatSection` attach 模式 |

> 依赖 task-01（`runtime-session-helpers.tsx` 提供 `isActiveSession` / `ACTIVE_SESSION_VIEW_STATUSES` / `logsToTurns` / `canResumeSession` / `SessionHistoryView` / `InteractiveSessionChatSection` 命名导出）与 task-02（`RuntimeSessionDialog` 外壳 + 三态渲染骨架 + `attachSession` state）。

## 覆盖来源

- `design.md` §5 Phase-2（active 续聊：active → `getAgentSessionLogs` → `logsToTurns` → attach SSE + 轮询 + inject）
- `design.md` §10 R-01（预填历史 turn 与 SSE 进行中 turn 按 `run_id` 去重，`TERMINAL_TURN_STATUSES` 幂等兜底）
- `requirements.md` FR-02（GWT：点 active 会话 → attach 模式可发送续聊；进行中 run 推送按 run_id 去重不覆盖终态）
- `decisions.md` D-004@v1（active 复用 `InteractiveSessionPanel.attachSessionId` 模式，不新增 LivePanel resume 重构）
- `plan.md` SC-2（active 点开可发送续聊，非只读）

## 实现要求

### 1. `handleSelect` 分支化（相对 page.tsx 当前统一只读回看）

当前 `page.tsx` 的 `handleSelect`（约 1176-1194）对所有会话一律 `setSelected` + `getAgentSessionLogs` + `setLogs` 进只读 `SessionHistoryView`（注释 `ql-20260619-007` 明确 active 续聊属更大重构）。本 task 在 dialog 内改为分支：

```ts
const handleSelect = useCallback(async (session: AgentSessionRead) => {
  // active/pending/reconnecting → attach 续聊（FR-02 / D-004@v1）
  if (isActiveSession(session)) {
    setAttachSession(session); // 触发右侧 InteractiveSessionChatSection attach 分支
    setSelected(null);          // 清只读选中态，避免双渲染
    setLogs([]);
    setLogsError(null);
    return;
  }
  // ended/failed → 只读历史回看（沿用 task-02 既有路径）
  setSelected(session);
  setAttachSession(null);
  setLogsLoading(true);
  setLogsError(null);
  try {
    const fetched = await getAgentSessionLogs(session.id);
    setLogs(fetched);
  } catch (err) {
    setLogsError(err instanceof ApiError ? err.message : "加载历史失败");
    setLogs([]);
  } finally {
    setLogsLoading(false);
  }
}, []);
```

- `isActiveSession`（`ACTIVE_SESSION_VIEW_STATUSES` = {pending, active, reconnecting}）来自 task-01 helper，语义与 `page.tsx:802` 一致。

### 2. active 分支右侧渲染：attach 链路

`setAttachSession(session)` 后，右侧三态渲染优先级为 `attachSession → InteractiveSessionChatSection`（task-02 已搭骨架）。本 task 确保传入 props 触发 attach 模式：

```tsx
{attachSession ? (
  <InteractiveSessionChatSection
    key={attachSession.id}        // 切换 active 会话 → 重 mount 清旧 SSE
    runtimes={runtimes}
    attachSession={attachSession} // InteractiveSessionPanel 据此进入 attachSessionId 模式
    initialTurns={initialTurns}   // logsToTurns 预填（见下）
    onSessionCreated={...}        // task-04 接 URL 写入，本 task 透传即可
    onSessionReset={...}
    focusProvider={attachSession.provider}
  />
) : selected ? (
  <SessionHistoryView ... />     // ended/failed 只读
) : (
  <InteractiveSessionChatSection ... /> // idle 新建（D-002）
)}
```

- `InteractiveSessionPanel` 的 attach 模式 effect（`interactive-session-panel.tsx` 约 265-282）：`attachSessionId` 变化 → `establishStream(attachSessionId)` 建 SSE + `setView({ status: "reconnecting", turns: initialTurns ?? [] })` 预填。本 task 只需把 `attachSession.id` + `initialTurns` 正确传入，不重复建流逻辑。
- 轮询 effect（约 284-336）：每 `ATTACH_POLL_MS` 调 `getAgentSession`，active → 转 active 启用输入；failed → 回退只读；超时兜底。由 panel 自管，dialog 不干预。

### 3. `logsToTurns` 预填 initialTurns

active 分支需在 `setAttachSession` 前/同时拉历史日志并转 `initialTurns`：

```ts
if (isActiveSession(session)) {
  // 先拉历史 logs → 转 initialTurns（与 attachSession 同步传入，避免 panel 先 mount 空 turns）
  let initialTurns: SessionTurnView[] = [];
  try {
    const logs = await getAgentSessionLogs(session.id);
    initialTurns = logsToTurns(logs);
  } catch {
    initialTurns = []; // 拉取失败不阻塞 attach，SSE 仍会推新 turn
  }
  setAttachInitialTurns(initialTurns); // 透传给 InteractiveSessionChatSection.initialTurns
  setAttachSession(session);
  ...
}
```

- `logsToTurns`（page.tsx 约 927-963）按 `run_id` 分组：`channel==="user_input"` → prompt，其余 → output；每个历史 turn 标记 `runId: __attach_history_{idx}__`、`status: "completed"`、`seenLogIds` 记录已见 log id。
- 时序注意：`initialTurns` 只在 panel mount 时读取一次（panel effect 注释明确「避免 props 变更抖动」），故必须先备好 `initialTurns` 再 `setAttachSession` 触发 mount，或在同一 render 周期内就绪。

### 4. SSE 接续 + inject 续发

attach 完成后（status 转 active），用户在输入框发消息走 `InteractiveSessionPanel.handleSend` 的 active 分支（约 456-498）：`injectSession(sessionId, prompt)` → 占位 turn → SSE 推送真实 run_id 更新。本 task 无需改 handleSend，复用即可。

### 5. ended/failed 走回看保留

- ended/failed **claude**：右侧 `SessionHistoryView` 只读 + 「继续对话」按钮（`canResumeSession` 为 true 时可点 reopen → 转 attach，沿用 task-02 既有按钮）。
- ended/failed **codex**：只读 `SessionHistoryView`，「继续对话」置灰（`canResumeSession` 返回 false，`resumeDisabledTitle` 提示「codex 暂不支持续聊」）。
- 此分支行为与当前 `page.tsx` 一致，本 task 仅是「保留」，不新增逻辑。

### 引用：`interactive-session-panel.tsx` attach effect

实现时对照 `interactive-session-panel.tsx`：
- attach 建流 effect（约 265-282）：清旧 SSE → `establishStream(attachSessionId)` → 预填 `initialTurns`。
- attach 轮询 effect（约 284-336）：`getAgentSession` 轮询到 active/failed/超时。
- `upsertTurn`（约 915-961）：`run_id` 去重（unknown run 先建无 prompt turn）+ `TERMINAL_TURN_STATUSES`（completed/failed/killed）幂等，不被 SSE 重连重发覆盖。

## 完成标准

- [ ] **SC-2**：弹窗左侧点 active 会话项 → 右侧进入 attach 模式，输入框可用且可发送续聊（非只读空白）。
- [ ] active 会话点开右侧预填历史 turn（来自 `logsToTurns`），与 SSE 推送的新 turn 共存不冲突。
- [ ] active attach 后 SSE 推送进行中 run 的 log → 预填历史 turn 与进行中 turn 按 `run_id` 区分，已终态历史 turn 不被覆盖。
- [ ] ended/failed claude 会话点开仍只读 + 「继续对话」可用；codex ended 只读、按钮置灰（沿用 `canResumeSession`）。
- [ ] 切换不同 active 会话 → `key={attachSession.id}` 重 mount，旧 SSE 清理。
- [ ] `tsc --noEmit` + `pnpm lint` 通过（task-03 改动范围内）。

## 注意事项

- **R-01 run_id 去重幂等**：预填历史 turn 的 `runId` 为 `__attach_history_{idx}__`（非真实 run_id），与 SSE 推送的真实 run_id 天然不冲突；`upsertTurn` 的 `TERMINAL_TURN_STATUSES` 幂等兜底防止历史 completed turn 被 SSE 重连重发的 turn_completed 改写。无需在本 task 新增去重代码，依赖 panel 既有机制，但需在 PR 描述/注释中点明此约束已覆盖。
- **复用 key 重 mount**：`InteractiveSessionChatSection` 的 `key={attachSession?.id ?? "live"}`（task-02 已定）——切换 active 会话或从 attach 回到 idle/selected 时，key 变化触发 unmount → panel cleanup effect（`closeStream` + `clearInterval`），避免 SSE/轮询泄漏（R-02 由 task-02 骨架 + 本 task key 配合覆盖）。
- **initialTurns 时序**：`initialTurns` 仅 mount 时读取（panel effect 注释），故须在 `setAttachSession` 触发 mount 前备好；推荐先 `await getAgentSessionLogs` + `logsToTurns`，再 `setAttachInitialTurns` + `setAttachSession` 同批 setState。
- **依赖 task-01/02**：本 task 仅改 `runtime-session-dialog.tsx`，不改 `interactive-session-panel.tsx`（attach/inject 链路复用）、不改 `page.tsx`（page 侧改造属 task-04）。若 task-01 helper 未就绪或 task-02 dialog 骨架未搭，本 task 阻塞。
- **不改后端契约**（§7.5）：attach + inject 为既有链路，无新事件。
