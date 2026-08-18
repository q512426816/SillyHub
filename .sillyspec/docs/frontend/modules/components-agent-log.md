---
schema_version: 1
doc_type: module-card
module_id: components-agent-log
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Agent 日志渲染引擎（components-agent-log）

## 定位
Agent / 运行时日志的渲染引擎（`agent-log-viewer.tsx` 主组件 + `agent-log/` 子模块 5 文件）。
把后端 SSE 推来的原始日志流归一化、按轮次（turn）分组、识别思考 / 工具调用 / 工具结果 /
待回复 input / 问答卡片 / 权限审批等语义，渲染成带折叠、复制、工具预览的交互式日志视图。
被 AgentPage、daemon 会话面板（turn-timeline 复用其 renderers 与解析函数）与变更中心消费，
是全站 agent 日志展示的唯一实现。

## 契约摘要
- `AgentLogViewer`（`agent-log-viewer.tsx`）：主组件；同时是桶导出口——re-export
  normalize.ts / tool-renderers.tsx / types.ts 的全部公共符号（含 `classifyLog`、
  `buildErrorLogItem`、`mergeAssistantPiece`、`mergeThinkingPiece` 等），下游统一从
  本文件或子模块 import 均可。
  - 内部集成：`ErrorBoundary` 包裹（单条日志渲染炸不塌整页）、`AskUserDialogCard`
    （daemon 问答卡）与 `PermissionApprovalCard`（权限审批卡，消费
    SessionPermissionRequest）、`MarkdownText` 渲染 assistant 富文本。
  - 待回复 input 行内嵌输入控件（`AgentLogInputControls` 类型约定），可直接回复。
- `agent-log/normalize.ts`（归一化核心，18 个导出）：
  - `normalizeLogs(logs)` → `ProcessedLog[]`：主入口，内含分片合并与语义分类。
  - `parseToolCallContent(raw)` → `ToolCallEntry | null`：解析 content JSON 工具调用
    （args/tool/status/success/description/command/rawArgs/toolUseId；兼容 snake_case
    与 camelCase 的 tool_use_id）。
  - `parseScanCheckOutput(text)` → `ScanCheckResult | null`：中文正则解析 sillyspec
    扫描自检输出（scan 文档数 / 模块数 / 业务流程数 / glossary / 总数 / 是否通过）。
  - `isPendingReplied(id, allLogs, repliedInputs?)`：input 是否已被后续回复
    （显式集合 + 时间戳兜底推断双路径）。
  - 分片合并：`mergeAssistantPiece` / `mergeThinkingPiece`（流式分片拼接）。
  - 判定族：`isThinkingContent` / `isThinkingOnly` / `isAssistantOnly` /
    `isPlainStreamingStdout` / `isAssistantApiErrorText` / `filterToolProtocolLines`。
  - `buildErrorLogItem(...)`：构造错误日志条目（daemon 面板复用）。
  - 常量：`COMMAND_COLLAPSE_LINES=5` / `COMMAND_COLLAPSE_CHARS=500`（长命令折叠阈值）、
    `EMPTY_REPLIED_INPUTS`。
- `agent-log/tool-renderers.tsx`：`ToolCallPreview` / `ToolResultCard` / `CopyButton` /
  `CollapsibleSection` 四个展示件。
- `agent-log/tool-kind-meta.ts`：`toolKindMeta`——14 种工具徽标
  （label ≤3 字 / lucide Icon / tailwind badgeClass），与 backend TOOL_KIND_VALUES、
  sillyhub-daemon tool_kind.ts 三端严格对齐；未知 kind 灰色兜底「工具」（Wrench 图标）。
- `agent-log/run-error-item.tsx`：`RunErrorItem` 运行失败条目渲染。
- `agent-log/types.ts`：`ProcessedLog` / `ToolCallEntry` / `ScanCheckResult` /
  `SemanticCategory` / `AgentLogInputControls`。
- 测试：`__tests__/normalize.test.ts` / `tool-kind-meta.test.ts` / `run-error-item.test.tsx`。

## 关键逻辑
- 归一化 + 分组流水线：
  ```
  const processed = useMemo(() => normalizeLogs(logs ?? []), [logs])
  const turns = groupIntoTurns(processed)            // 按轮次分组
  // 渲染：turns.map(turn => turn.map(log => <AgentLogRow log={log} .../>))
  ```
- 行级着色（`semanticLineClass`）：按 `[TOOL_USE]`/`[TOOL_RESULT]`/`[THINKING]`/`[RESULT`
  前缀分流——user_input 紫 / tool 蓝 / 成功 result 绿 / 失败 result 红 / thinking 灰。

## 注意事项
- 14 枚举工具徽标是三端契约（backend / sillyhub-daemon / 本文件），改任何一个值须
  三端同步（tool-kind-meta.ts 头注释明示）；配色表刻意避开语义分类已占色族。
- 上游 `content_redacted` 可为 null 或偶发非字符串，`parseToolCallContent` 入口用
  `asString` 归一化（ql-20260616-002），下游勿再裸 split / JSON.parse。
- 日志量可能很大：归一化与分组均 `useMemo`，传 logs 须保持数组 identity 稳定否则
  缓存失效全量重算。
- content_redacted 是后端脱敏后字段，前端禁止尝试还原敏感内容。
- `isPendingReplied` 双路径逻辑细，改动必须配套跑 `agent-log/__tests__` 三套测试。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
