---
id: task-11
title: frontend 续聊按钮（可用性 D-004）+ SessionListSection 接线（历史回看↔attach 面板切换）
priority: P0
depends_on: [task-10]
blocks: []
requirement_ids: [FR-2]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
---

## 修改文件
- `frontend/src/app/(dashboard)/runtimes/page.tsx`：`SessionHistoryView`（:957 加续聊按钮）、`SessionListSection`（:1031 接线切换）
- 测试：`runtimes/page.test.tsx`

## 覆盖来源
- design.md §4.3.3、§13；decisions D-002@v1、D-004@v1；requirements FR-2

## 实现要求
1. `SessionHistoryView` header（:983）加「继续对话」按钮 + `onContinue?: (session) => void` prop；可用性（D-004）：
   `canResume = session.provider === "claude" && !!session.agent_session_id && (status==="ended" || status==="failed")`
   - canResume → 可点（调 onContinue）
   - 不满足 → 置灰 + `title` 提示（codex→「codex 暂不支持续聊」/ 无 agent_session_id→「会话未建立，无法续聊」/ active→不显示按钮，本就活跃）
2. `SessionListSection` 新增 `attachSession` 状态（reopen 成功的 session）；右侧渲染分支：
   - `attachSession` 存在 → `<InteractiveSessionPanel attachSessionId={attachSession.id} initialTurns={logsToTurns(logs)} ... />`（task-10 attach 模式）
   - 否则 selected → `<SessionHistoryView ... onContinue={handleContinue} />`
   - 否则 → `<InteractiveSessionChatSection />`（新建）
3. `handleContinue(session)`：调 `reopenSession(session.id)` → 成功 → `setAttachSession(session)`（右侧切 attach 面板）；失败（ApiError）→ setListError 提示
4. `logsToTurns(logs)`：按 run_id 分组 → 每 run 一 turn：`channel==="user"` 的 log→`prompt`，其余 log→`output`（拼接）；turn/seenLogIds 占位
5. attach 面板「新建会话」/ 关闭 → 清 attachSession 回 selected/null

## 接口定义
- `SessionHistoryView` 加 prop：`onContinue?: (s: AgentSessionRead) => void`
- 续聊可用性：`canResume(s) = s.provider==="claude" && !!s.agent_session_id && ["ended","failed"].includes(s.status)`
- `SessionListSection` 状态：`attachSession: AgentSessionRead | null`
- `logsToTurns(logs: AgentRunLogEntry[]): SessionTurnView[]`

## 边界处理
1. **codex 会话**：按钮置灰 + title「codex 暂不支持续聊」
2. **无 agent_session_id（create 失败的 failed）**：置灰 + title「会话未建立，无法续聊」（D-004）
3. **active 会话选中**：不显示续聊按钮（本就活跃，走 live）；选中 active 仍是只读回看（ql-007）
4. **reopen 失败（409 OFFLINE 等）**：ApiError → setListError 提示，不切 attach
5. **切换时清旧 SSE**：attachSession 变化 → InteractiveSessionPanel 重 mount（key=session.id）自然清旧（task-10 unmount close）
6. **logsToTurns 空 logs**：返回空 turns（防御）

## 非目标
- 不改 SessionsSidebar 删除（task-04）
- 不实现 panel attach 内部（task-10）
- 不实现 reopen API（task-09）

## 参考
- SessionListSection 现状：`page.tsx:1031-1146`
- SessionHistoryView header：`:983-995`
- InteractiveSessionChatSection（新建包装）：`:379`

## TDD 步骤
1. 写测试：ended claude 会话（有 agent_session_id）回看显示可点「继续对话」；codex/无 id 置灰；active 不显示；点击 → reopen → 右侧切 attach panel
2. 确认失败
3. 实现按钮 + 可用性 + handleContinue + attachSession 状态 + logsToTurns
4. 确认通过；补 reopen 失败提示 + logsToTurns 转换测试
5. 回归 page.test.tsx（含 ql-007）

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | ended claude 会话回看 | 显示可点「继续对话」按钮 |
| AC-02 | codex 会话回看 | 按钮置灰 + title 提示 |
| AC-03 | 无 agent_session_id failed | 按钮置灰 + title 提示 |
| AC-04 | active 会话回看 | 不显示续聊按钮 |
| AC-05 | 点击续聊 | reopen → 右侧切 attach InteractiveSessionPanel（预填历史 turn） |
| AC-06 | reopen 失败 | setListError 提示，不切换 |
| AC-07 | logsToTurns | user log→prompt、其余→output，按 run 分组 |
| AC-08 | page.test.tsx 回归 | 全绿 |
