---
id: task-10
title: frontend InteractiveSessionPanel attach 模式（SSE + 预填 turn + 轮询到 active 启用输入）
priority: P0
depends_on: [task-08, task-09]
blocks: [task-11]
requirement_ids: [FR-2]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
---

## 修改文件
- `frontend/src/components/daemon/interactive-session-panel.tsx`：新增 attach 模式 props + 轮询
- 测试：`interactive-session-panel.test.tsx`

## 覆盖来源
- design.md §4.3.3、§13；decisions D-002@v1；requirements FR-2

## 实现要求
1. props 增加：`attachSessionId?: string`、`initialTurns?: SessionTurnView[]`（SessionTurnView 为组件内现有类型）
2. mount effect：若 `attachSessionId` 存在 →
   - `establishStream(attachSessionId)` 建 SSE（:125，复用）
   - `setView({ sessionId: attachSessionId, status: "reconnecting", currentRunId: null, turns: initialTurns ?? [], errorMsg: null })`
3. 轮询 effect（仅 attach 模式）：`setInterval(1500)` 调 `getAgentSession(attachSessionId)`：
   - `status === "active"` → `setView status="active"` + 清 interval + 启用输入
   - 仍 `reconnecting` → 保持禁用 + placeholder「恢复会话中…」
   - `failed` 或累计 ~15s（10 次）仍非 active → `setView status="failed"` + errorMsg「会话恢复失败，可能上下文已失效」+ 清 interval（回退只读）
4. `sendingDisabled`（:398）扩展：`view.status === "reconnecting"` 时也禁用
5. unmount：清轮询 interval + close SSE（现有 :185 close 保留）
6. attach 成功 active 后，发送走现有 handleSend 的 active 分支（inject，:263）

## 接口定义
- `InteractiveSessionPanelProps` 加：`attachSessionId?: string`、`initialTurns?: SessionTurnView[]`
- 轮询常量：`ATTACH_POLL_MS = 1500`、`ATTACH_POLL_TIMEOUT_MS = 15000`
- placeholder 扩展（:411）：reconnecting → 「恢复会话中…」

## 边界处理
1. **SSE 在 reconnecting 先建**：establishStream 不阻塞（订阅后续 turn/log），即使 status 非 active 也能收 daemon resume 后的事件
2. **轮询超时（~15s）**：回退 failed + 提示，保留已预填历史 turn 只读
3. **resume 失败（backend failed）**：轮询拿到 failed → 同超时处理
4. **unmount 清理**：clearInterval + streamConnRef.close（防泄漏）
5. **重复 attach（props 变化）**：attachSessionId 变 → 清旧轮询/SSE 重建
6. **无 attachSessionId（正常新建模式）**：不影响现有 idle→create 路径
7. **initialTurns 为空**：attach 后无历史 turn（理论上不该，但有防御）

## 非目标
- 不实现续聊按钮/切换接线（task-11）
- 不改 create/inject 核心逻辑（复用）
- 不实现 reopen API（task-09）

## 参考
- 现有 SSE：`establishStream`（:125）、`streamSession`（lib/daemon.ts）
- handleSend active 分支：`:263`（inject）
- sendingDisabled：`:398`

## TDD 步骤
1. 写测试：渲染 `<InteractiveSessionPanel attachSessionId initialTurns>` → status reconnecting、输入禁用、placeholder「恢复会话中」；mock getAgentSession 返回 active → status active、输入启用
2. 确认失败
3. 实现 attach props + 轮询 + sendingDisabled 扩展
4. 确认通过；补超时回退 + failed 回退 + unmount 清理测试
5. 回归现有 panel 测试（14 用例）

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | attach 模式 mount | 建 SSE、预填 initialTurns、status=reconnecting |
| AC-02 | reconnecting 期间 | 输入禁用、placeholder「恢复会话中…」 |
| AC-03 | 轮询到 active | status 切 active、输入启用、清轮询 |
| AC-04 | 轮询超时/failed | 回退 failed + 提示、保留只读历史 |
| AC-05 | active 后发送 | 走 inject 路径续聊 |
| AC-06 | unmount | 清轮询 + close SSE |
| AC-07 | 现有 panel 测试回归 | 14 用例全绿 |
