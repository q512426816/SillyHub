---
author: flow-machine-draft
created_at: 2026-10-13T03:59:07.723Z
---
# 设计记录（Design Record）— 2026-10-13-editpatch-fullchain

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两条收尾链：① agent-log 视图 EditToolPreview 补行级 diff——editPatch（上一变更已配对到 ProcessedLog）三级渲染：parseStructuredPatch（真实行号）→ computeLineDiff LCS 回退 → 超大 null 回退既有红绿两块；computeLineDiff 自 daemon/tool-args-detail 迁入 agent-log/tool-diff 共享（依赖方向维持 daemon→agent-log 单向）。② 会话化对话视图（agent-log-card，daemon read_agent_log_messages 数据源）通 patch——daemon claude-code 解析器从载体行顶层 toolUseResult.structuredPatch 提取序列化为 tool_result 段的 edit_patch（64KB all-or-nothing），backend AgentLogMessageItem 显式声明透传（extra=ignore 下不声明即被剥离），gen:types 刷新契约，前端 segment 取 result.edit_patch 传入 ToolCallPreview（Write/Edit 渲染面上一变更已就绪）。

字段名沿用全链既有口径 `edit_patch`（snake_case 贯穿 daemon 消息契约 / backend schema / 行列），前端消费侧保持 camelCase editPatch。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- daemon：`NormalizedLogMessage` 增可选 `edit_patch?: string | null`（tool_result 段专用契约扩展，同 2026-09-19 五可选字段先例）；`parseClaudeCodeJsonlLog` user 载体行带 toolUseResult.structuredPatch 时产出带 edit_patch 的 tool_result 段（内部函数 userSegments/makeSegment 增参，模块私有）。
- backend：`AgentLogMessageItem` 增 `edit_patch: str | None`（GET /agent-logs/{id}/messages 响应内层新可选键，老 daemon 不带即 None）；openapi/api-types 经 gen:types 同步。
- frontend：`agent-log/tool-diff.tsx` 新导出 `computeLineDiff`；daemon/tool-args-detail 改导入 + re-export（既有导入面零改动）；`ToolPreviewProps.editPatch` 消费面扩展到 Edit 分支；`ConversationSegment` tool_use 变体增 `editPatch?`（模块内私有类型）。
- 对外可见行为变化：agent-log 视图 Edit 卡三级 diff；对话视图 Write/Edit 卡在 claude 日志有 patch 时渲染行级 diff。端点路径/方法无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。daemon 侧 patch 附着按行自包含（载体行顶层字段随行解析，不跨行状态）；前端对话视图按 tool_use_id 显式 Map 配对（既有），patch 随 result 项走——result 迟到/失配时卡片走无 patch 回退，孤儿 result 独立渲染不丢文本。JSONL 坏行占比守门既有逻辑不受影响。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：daemon 解析器为纯函数（content 注入、无 I/O/时钟读）；backend 是无状态 schema 校验透传；前端为渲染层只读装配，均无共享可变写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。解析器每次调用重建 segments；beforeSeq 切片在 seq 重编号后应用（既有管线），edit_patch 随段走切片窗口内；前端 Provider/展开区按需挂载，无跨渲染持久状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。edit_patch 是单条消息段的自包含字段，跨 workspace 的 404/409 守门在 router 层既有逻辑（本次未触碰）；无跨仓/多实例共享数据流。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：响应体积——structuredPatch 大文件可达数十 KB，messages 窗口多条 patch 叠加膨胀。缓解：daemon 侧 64KB all-or-nothing 上限（残缺 JSON 无消费价值）+ 既有 200 段窗口/20MB 预算守门；超限走无 patch 回退不炸。

放弃的方案：(a) backend 用 extra="allow" 泛化透传 daemon 全部新字段——放宽契约面，字段漂移不可见，违背逐字对齐纪律，放弃（仍显式声明）；(b) edit_patch 附着到 tool_use 段——源数据在载体行（tool_result 侧），放 use 段要跨段回填，放弃；(c) 超限截断 JSON 而非整体丢弃——残缺 JSON 必然 parse 失败等价于丢弃但携带幻觉风险，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts | NormalizedLogMessage 增 edit_patch 可选字段（契约锚点） |
| 修改 | sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | 行级 toolUseResult.structuredPatch 提取（64KB 上限）+ userSegments/makeSegment 附着 |
| 修改 | backend/app/modules/platform_sync/schema.py | AgentLogMessageItem 增 edit_patch 显式声明 |
| 修改 | backend/openapi.json | gen:types 产物 |
| 修改 | frontend/src/lib/api-types.ts | gen:types 产物 |
| 修改 | frontend/src/components/agent-log/tool-diff.tsx | 迁入 computeLineDiff（含 DIFF_MAX_CELLS 护栏） |
| 修改 | frontend/src/components/daemon/tool-args-detail.tsx | computeLineDiff 改共享导入 + re-export |
| 修改 | frontend/src/components/agent-log/tool-renderers.tsx | EditToolPreview 三级 diff + Edit 分派透传 editPatch |
| 修改 | frontend/src/components/daemon/agent-log-card.tsx | ConversationSegment tool_use 增 editPatch 透传（含行尾归一 churn） |
| 修改 | sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts | daemon 三用例 |
| 修改 | backend/app/modules/platform_sync/tests/test_agent_log_messages.py | edit_patch 透传断言 + 夹具/openapi 属性集补键 |
| 修改 | frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx | EditToolPreview 三用例 |
