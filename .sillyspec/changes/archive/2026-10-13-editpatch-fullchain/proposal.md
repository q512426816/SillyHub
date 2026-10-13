---
author: flow-machine-draft
created_at: 2026-10-13T03:59:07.722Z
---
# 提案书（Proposal）— 2026-10-13-editpatch-fullchain

## 动机

任务原话转写：agent-log 视图 Edit 卡与会话化对话视图（agent-log-card）的 Write/Edit 卡仍无行级 diff：①EditToolPreview 接 editPatch（parseStructuredPatch 优先、computeLineDiff 回退，computeLineDiff 迁入共享 tool-diff）；②daemon read_agent_log_messages 解析 structuredPatch 让对话视图 Write/Edit 卡带 diff
成功标准：
- agent-log EditToolPreview 有 editPatch 渲染红删绿增 DiffView，无 patch 回退 LCS 行级 diff，超大输入回退既有红绿两块
- daemon 消息解析在 claude 日志 toolUseResult.structuredPatch 存在时把 edit_patch 带到 tool_result 消息项，前端对话视图 Write/Edit 卡消费
- 相关 daemon/backend/前端测试通过，gen:types 同步（若 backend schema 变更），既有行为零回归

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. agent-log EditToolPreview 有 editPatch 渲染红删绿增 DiffView，无 patch 回退 LCS 行级 diff，超大输入回退既有红绿两块
2. daemon 消息解析在 claude 日志 toolUseResult.structuredPatch 存在时把 edit_patch 带到 tool_result 消息项，前端对话视图 Write/Edit 卡消费
3. 相关 daemon/backend/前端测试通过，gen:types 同步（若 backend schema 变更），既有行为零回归

## 成功标准（可验证）

1. agent-log EditToolPreview 有 editPatch 渲染红删绿增 DiffView，无 patch 回退 LCS 行级 diff，超大输入回退既有红绿两块
2. daemon 消息解析在 claude 日志 toolUseResult.structuredPatch 存在时把 edit_patch 带到 tool_result 消息项，前端对话视图 Write/Edit 卡消费
3. 相关 daemon/backend/前端测试通过，gen:types 同步（若 backend schema 变更），既有行为零回归
