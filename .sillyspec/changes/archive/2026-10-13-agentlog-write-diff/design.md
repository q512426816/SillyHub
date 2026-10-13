---
author: flow-machine-draft
created_at: 2026-10-13T03:16:53.101Z
---
# 设计记录（Design Record）— 2026-10-13-agentlog-write-diff

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

变更运行日志视图（agent-log-viewer）的 Write 工具卡此前只显示全文预览，与会话面板已上线的 Write diff（2026-10-13-write-tool-diff）不一致。数据面 edit_patch 早已到达前端行（AgentRunLogEntry.edit_patch 列 / AgentEvent.edit_patch 一等字段），缺口纯在 normalize 配对不拾取、渲染不消费。

做法：normalize.ts `mergeToolResult` 增 editPatch 拾取（首条语义，与 toolDurationMs 同范式；显式参数 ?? sourceLog.edit_patch 行列双源），fromAgentEvent tool_result 两处传 ev.edit_patch；diff 原语（DiffRow/parseStructuredPatch/DiffView）从 daemon/tool-args-detail 迁出到 agent-log/tool-diff 共享（依赖方向维持 daemon→agent-log 单向，同 CopyButton 先例，daemon 侧 re-export 零破坏）；WriteToolPreview 有可解析 patch 渲染 DiffView，无 patch 回退既有全文形态。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ProcessedLog` 增 `editPatch?: string`（types.ts）；`mergeToolResult` 增第 4 可选参 `editPatch?: string | null`（模块内私有函数）；`ToolPreviewProps` 增 `editPatch?: string`，`ToolCallPreview`/`WriteToolPreview` 透传（可选 prop，agent-log-card 等未传调用方零改动）。
- 新增导出模块 `agent-log/tool-diff.tsx`（DiffRow/parseStructuredPatch/DiffView/DIFF_MAX_ROWS）；daemon/tool-args-detail 保留同名 re-export，既有导入面（本文件测试、computeLineDiff 消费方）零改动。
- 对外可见行为变化：变更运行日志视图 Write 卡片在覆盖写场景显示红删绿增 diff 区（替换内容预览区）；无 patch 卡片渲染与改前逐字一致。EditToolPreview、Bash/Read/Grep 等其余预览零改动。端点/命令/文件格式：无。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。拾取发生在 mergeToolResult 配对时点（result 到达才写卡片），首条语义对同卡多 result 取第一条 patch（与既有 toolDurationMs 同规则）；patch 缺失/迟到（未配对孤儿 result）→ 卡片无 patch 走全文回退，JSON 非法由 parseStructuredPatch 返回 null 回退，不崩。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：normalize 是纯函数单遍归一化（normalizeLogs 内部循环），无共享可变状态、无 I/O 写面；editPatch 只写在本条配对卡片的自身对象上。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。ProcessedLog 是归一化产物（每次 normalizeLogs 重建），无跨渲染持久状态；SSE 增量与历史回放两条入口走同一函数，中断重放幂等（同输入同输出）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。改动收敛在 agent-log 归一化/渲染链与 viewer 透传，editPatch 随单条日志行/卡片生命周期，无跨工作区/跨仓共享数据流；agent-log-card 会话化对话视图（daemon messages 端点数据源）本次未接线，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：共享模块迁移（daemon/tool-args-detail → agent-log/tool-diff）破坏既有导入面。缓解：daemon 侧保留同名 re-export，既有测试（tool-args-detail.test.tsx 直接 import DiffView/parseStructuredPatch）零改动通过即证明。

放弃的方案：(a) agent-log 直接 import daemon/tool-args-detail 的 DiffView——会形成 tool-renderers ↔ tool-args-detail 循环依赖（后者已 import 前者的 CopyButton），放弃；(b) 同步接线 agent-log-card 会话化对话视图——其数据源是 daemon read_agent_log_messages（另一条链，daemon 侧需动 messages 解析），超出薄跑道范围，留后续变更；(c) Write 无 patch 时也整文件全绿（照搬会话面板行为）——本变更成功标准承诺零回归保持全文预览，且 agent-log 面已提供「原始数据」折叠兜底，不做双面不一致的行为扩散。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/components/agent-log/tool-diff.tsx | DiffRow/parseStructuredPatch/DiffView/DIFF_MAX_ROWS 共享原语（自 daemon 迁出） |
| 修改 | frontend/src/components/agent-log/types.ts | ProcessedLog 增 editPatch 字段 |
| 修改 | frontend/src/components/agent-log/normalize.ts | mergeToolResult 拾取 editPatch（双源首条语义）+ fromAgentEvent 传 ev.edit_patch + AgentEvent.edit_patch 注释对齐 |
| 修改 | frontend/src/components/agent-log/tool-renderers.tsx | ToolPreviewProps/ToolCallPreview/WriteToolPreview 接 editPatch 渲染 DiffView |
| 修改 | frontend/src/components/agent-log-viewer.tsx | 两处 ToolCallPreview 透传 editPatch |
| 修改 | frontend/src/components/daemon/tool-args-detail.tsx | diff 原语改自共享模块导入 + re-export（零破坏） |
| 修改 | frontend/src/components/agent-log/__tests__/normalize.test.ts | 新增 edit_patch 配对四用例 + renderModelOf 补 editPatch 键 |
| 新增 | frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx | WriteToolPreview diff 渲染三用例 |
