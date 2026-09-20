# 符号影响面报告 — 2026-09-20-agent-log-session-replay

基准：worktree `.sillyspec/.runtime/worktrees/2026-09-20-agent-log-session-replay`（base 53c67e02 = replay-redo）。逐 task 签名级变更结论：

- **task-01**：接口形状加法变更（additive）——`NormalizedLogMessage`（sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66）增 5 个可选字段、`ZcodeModelIoParseResult`（:107）增可选 `totalUsage`。受影响引用点：registry.ts 类型引用（task-05 范围内）、read-zcode-sqlite.ts 同构返回（task-04 范围内）、host-fs-handler.ts 透传类型（task-05 范围内）。可选字段零破坏，TS 编译兜底；消费方更新全部在任务范围内。
- **task-02**：新符号 `parseClaudeCodeJsonlLog`（NEW:sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts），实现 `AgentLogParser` 签名（registry.ts:63）。无既有签名变更。
- **task-03**：新符号 `parseCursorAgentTranscriptLog`（NEW:sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts），同上。无既有签名变更。
- **task-04**：`readZcodeSqliteMessages` 返回结构加法（可选 usage/turn_id/model/totalUsage），签名（参数表）不变。fixture 构造器 `createZcodeFixtureDb` 增 options 可选参（additive）。
- **task-05**：`AgentLogMessagesResult`（registry.ts:39）增可选 `totalUsage`；`PARSERS` map 增两项。`readAgentLogMessages`（host-fs-handler.ts:2035）签名不变（透传结构扩展）。
- **task-06**：pydantic 模型加法——新 `AgentLogUsage`；`AgentLogMessageItem`（backend/app/modules/platform_sync/schema.py:444）增 5 可选字段；`AgentLogMessagesResponse`（:470）增可选 `totals`。router 端点签名不变；openapi.json/api-types.ts 再生成（生成物，非手写签名）。
- **task-07**：新符号 `buildReplayTurns`/`isSubagentLog`/`selectMainLogs`（NEW:frontend/src/lib/agent-log-replay.ts）。无既有签名变更。
- **task-08**：**破坏性导出移除**——`AgentLogSessionBody`（frontend/src/components/daemon/agent-log-card.tsx:1016）删除。受影响 import 点：session-panel-page.tsx:67（本任务内替换）、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx:48（本任务内迁移/删除）。全仓其余无引用（已 grep 核实：task-execution-panel.tsx/turn-timeline.tsx 仅注释提及）。page-helpers.tsx:69 注释级同步。
- **task-09**：无签名级变更（测试收口与残差修复）。
