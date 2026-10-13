---
author: flow-machine-draft
created_at: 2026-10-13T03:16:53.101Z
---
# 任务注册表（Tasks）— 2026-10-13-agentlog-write-diff

- [x] task-01: 测试先行——normalize.test.ts 增 edit_patch 配对用例（旧轨 [TOOL_RESULT] 行 edit_patch 列 → 卡片 editPatch；v2 轨 ev.edit_patch → 卡片 editPatch；renderModelOf 补 editPatch 键）+ 新增 tool-renderers Write diff 渲染用例（有 editPatch 红删绿增 / 无 patch 保持全文预览），跑新用例确认先红。验证：`pnpm exec vitest run src/components/agent-log` 新用例失败（实测 3+2 failed 先红，11:28）
- [x] task-02: 数据链实现——types.ts ProcessedLog 增 editPatch；normalize.ts mergeToolResult 增 editPatch 拾取（首条语义，源=显式参数 ?? sourceLog.edit_patch 行列）、fromAgentEvent tool_result 两处传 ev.edit_patch；agent-log-viewer 两处 ToolCallPreview 传 editPatch。验证：normalize 新用例绿（103/104 全绿仅渲染侧待接，11:33）
- [x] task-03: 渲染实现——新建 agent-log/tool-diff.tsx（DiffRow/parseStructuredPatch/DiffView 自 daemon/tool-args-detail 迁出，daemon 侧 re-export 零破坏），WriteToolPreview 有 editPatch 渲染红删绿增 DiffView（标题「变更对比（覆盖写入 +N −M）」+ 复制完整原文）、无 patch 保持现有全文预览。验证：渲染新用例绿（tool-renderers-write-diff 3/3，11:36）
- [x] task-04: 回归——normalize.test + normalize-dual-path + tool-args-detail + turn-segment-views + agent-log 新用例全绿 + `pnpm typecheck` 零错误。验证：7 文件 260/260 全绿（11:35）+ `pnpm typecheck` 零错误（11:37）；EditToolPreview 与会话面板 Edit/Write 分支零改动（既有用例原样通过）
