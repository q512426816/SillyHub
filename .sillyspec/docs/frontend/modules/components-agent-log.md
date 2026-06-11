---
schema_version: 1
doc_type: module-card
module_id: components-agent-log
author: qinyi
created_at: 2026-06-10T16:55:00
---

# components-agent-log

## 定位
Agent 运行日志查看器和相关子模块。负责展示 Agent 执行过程中的实时日志流、工具调用结果、用户输入交互。

## 契约摘要
- `agent-log-viewer.tsx` — 日志查看器主组件：展示 AgentRun 日志流、支持全屏/内嵌模式、待输入回复、工具调用渲染
- `agent-log/types.ts` — 类型定义：ToolCallEntry、ScanCheckResult、ProcessedLog 等
- `agent-log/tool-renderers.tsx` — 工具调用结果渲染器：针对不同工具类型的专用渲染
- `agent-log/normalize.ts` — 日志规范化：解析和标准化日志条目

## 关键逻辑
- 实时日志通过 SSE（EventSource）接收，自动去重（seenLogIds）
- 工具调用内容通过 parseToolCallContent 解析，检测结果通过 parseScanCheckOutput 解析
- 支持用户输入（pending_input channel）的回复功能
- 日志行折叠控制：COMMAND_COLLAPSE_LINES / COMMAND_COLLAPSE_CHARS

## 注意事项
- 组件依赖 `@/lib/agent` 的类型定义和 API 函数
- 工具调用渲染器需要随 Agent 工具集扩展而更新

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
