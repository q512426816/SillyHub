---
author: flow-machine-draft
created_at: 2026-10-13T03:59:07.723Z
---
# 任务注册表（Tasks）— 2026-10-13-editpatch-fullchain

- [x] task-01: 测试先行——daemon parse-claude-code.test.ts 增 toolUseResult.structuredPatch → tool_result 段 edit_patch 用例（3 个：附着/缺省/超 64KB 不附着）；frontend tool-renderers-write-diff.test.tsx 增 EditToolPreview 三用例（patch→DiffView / 无 patch→LCS / 超大→红绿两块）；backend test_agent_log_messages.py 增 edit_patch 透传断言 + 既有精确字典断言补 edit_patch 键 + openapi 属性集补键，跑新用例确认先红。验证：daemon 1 failed（11:44）/frontend 3 failed（11:46）/backend 2 failed（11:47）
- [x] task-02: daemon 实现——parse-zcode-model-io.ts NormalizedLogMessage 增 edit_patch 可选字段；parse-claude-code-jsonl.ts 行级 toolUseResult.structuredPatch（非空数组序列化，超 64KB 不附着）传入 userSegments 附着到该行 tool_result 段。验证：parse-claude-code + read-agent-log-messages 35/35 绿（11:52）
- [x] task-03: backend schema——platform_sync/schema.py AgentLogMessageItem 增 edit_patch 字段（extra=ignore 下不声明即被剥离，必须显式）+ `pnpm gen:types` 刷新 backend/openapi.json 与 frontend api-types.ts（openapi +12 行 / api-types +5 行，provider-caps 三端镜像无漂移）。验证：backend test_agent_log_messages 19/19 绿（11:55）+ test_provider_caps_alignment 5/5 绿 + gen:types 产物已入提交
- [ ] task-04: 前端渲染——computeLineDiff 迁入 agent-log/tool-diff.tsx（daemon re-export 兼容）；EditToolPreview 接 editPatch（parseStructuredPatch→DiffView，无 patch→computeLineDiff LCS，超大 null→既有红绿两块）+ ToolCallPreview Edit 分派透传 + agent-log-card ConversationSegment tool_use 增 editPatch（result.edit_patch）传入。验证：前端新用例绿
- [ ] task-05: 回归——daemon 相关测试 + backend 相关测试 + frontend 相关套件全绿 + 前端 `pnpm typecheck` + daemon tsc。验证：全部绿
