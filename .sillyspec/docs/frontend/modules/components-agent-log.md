---
schema_version: 1
doc_type: module-card
module_id: components-agent-log
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-agent-log

## 定位
Agent / 运行时日志的渲染引擎（`agent-log-viewer.tsx` + `agent-log/*`）。把后端 SSE 推来的原始日志流归一化、按"轮次(turn)"分组、识别思考/工具调用/工具结果/待回复 input 等语义，渲染成带折叠、复制、工具预览的交互式日志视图。是 AgentPage / 运行时会话查看历史的核心展示层。

## 契约摘要
- `AgentLogViewer`（`agent-log-viewer.tsx`）：主组件，`useMemo(() => normalizeLogs(logs??[]))` 归一化后按 turn 分组渲染。
- `normalizeLogs(logs)`（`agent-log/normalize.ts`）：原始日志 → `ProcessedLog[]`，处理 redaction、时间戳等。
- `parseToolCallContent(raw)`（normalize.ts）：从日志 content 解析出工具调用条目（`ToolCallEntry | null`）。
- `isThinkingContent(content)` / `isPendingReplied(timestamp, allLogs)`：语义判定（思考块 / 该 input 是否已被后续回复）。
- `groupIntoTurns(logs: ProcessedLog[])`：按轮次分组成 `ProcessedLog[][]`。
- `AgentLogRow`：单行渲染，按 log 类型分流（工具调用 → `ToolCallPreview`、结果 → `ToolResultCard`、思考块 → 折叠、待回复 → 高亮）。
- 辅助展示：`ToolCallPreview` / `ToolResultCard` / `CopyButton` / `CollapsibleSection`。
- 常量：`COMMAND_COLLAPSE_LINES=5` / `COMMAND_COLLAPSE_CHARS=500`（长命令折叠阈值）、`EMPTY_REPLIED_INPUTS`。
- 类型：`ProcessedLog`（`agent-log/types.ts`）。

## 关键逻辑
- 归一化 + 分组流水线：
  ```
  const processed = useMemo(() => normalizeLogs(logs ?? []), [logs])
  const turns = groupIntoTurns(processed)
  // 渲染：turns.map(turn => turn.map(log => <AgentLogRow log={log} allLogs={processed} .../>))
  ```
- AgentLogRow 语义分流：工具调用走 `parseToolCallContent`；待回复 input 用 `isPendingReplied` 判断是否已被回复（`repliedInputs.has(log.id)` 或时间戳推断）；stdout + `isThinkingContent` 判为思考块。

## 注意事项
- 日志量可能很大，归一化与分组都用 `useMemo` 缓存，避免每次渲染重算；改 logs 引用时要保证数组 identity 稳定才有效。
- `isPendingReplied` 既查显式 `repliedInputs` 集合也按时间戳兜底推断，逻辑较细，改动需配套测试（`agent-log/__tests__`）。
- 长命令/长输出靠 `COMMAND_COLLAPSE_*` 折叠，改阈值影响默认展开体验。
- content_redacted 是后端脱敏后的字段，前端不要再尝试还原敏感内容。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
