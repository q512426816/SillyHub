---
author: flow-machine-draft
created_at: 2026-10-13T03:16:53.100Z
---
# 提案书（Proposal）— 2026-10-13-agentlog-write-diff

## 动机

任务原话转写：变更运行日志视图（agent-log）的 Write 工具卡仍只显示全文预览，与会话面板已上线的 Write diff 展示不一致；打通 normalize.ts 的 edit_patch 数据链并让 WriteToolPreview 复用 DiffView
成功标准：
- normalize 数据链把 tool_result 行/事件的 edit_patch 配对写入对应 tool_call entry
- agent-log 视图 Write 工具卡有 editPatch 时渲染红删绿增 DiffView，无 patch 保持现有全文预览
- 相关前端测试通过，不改动 Edit 预览与会话面板现有行为

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. normalize 数据链把 tool_result 行/事件的 edit_patch 配对写入对应 tool_call entry
2. agent-log 视图 Write 工具卡有 editPatch 时渲染红删绿增 DiffView，无 patch 保持现有全文预览
3. 相关前端测试通过，不改动 Edit 预览与会话面板现有行为

## 成功标准（可验证）

1. normalize 数据链把 tool_result 行/事件的 edit_patch 配对写入对应 tool_call entry
2. agent-log 视图 Write 工具卡有 editPatch 时渲染红删绿增 DiffView，无 patch 保持现有全文预览
3. 相关前端测试通过，不改动 Edit 预览与会话面板现有行为
