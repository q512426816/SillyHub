---
author: flow-machine-draft
created_at: 2026-10-23T00:07:59.907Z
---
# 设计记录（Design Record）— 2026-10-23-turn-file-diff-dialog

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：纯前端接线，零后端/daemon 改动。现状：`turn-timeline.tsx:1238-1250` 挂 FileChangesCard 时只传 turnNo，未传 onOpenFile，行点击无响应。补丁内容数据面已存在：本轮 Edit/Write 的 structuredPatch 落在 agent_run_logs（backend sdk_pipeline 双写：tool_call 行带 args JSON + tool_use_id；tool_result 行带 edit_patch + tool_use_id），前端已有会话级单轮日志 API `getAgentSessionLogs(sessionId, { runId })`（frontend/src/lib/daemon/sessions.ts:694）与 diff 渲染原语 DiffView/parseStructuredPatch（agent-log/tool-diff.tsx，daemon 侧 tool-args-detail 已有依赖先例）。

选此方案的理由：会话面板已有 sessionId，弹窗打开时按 runKey（realRunId ?? runId）单轮拉日志即配即可，不改读模型、不加端点、不扩 daemon 快照 DTO（把 patch 文本塞进快照会显著放大 /runs 载荷）。共享组件复用先例：shadcn Dialog 形态对齐 session-change-files-hover（点项开大弹窗），DiffView 依赖方向维持 daemon → agent-log 单向。

落地三件：① `file-changes/turn-file-diff.ts` 纯映射（AgentRunLogEntry[] + 仓根相对路径 → 按序补丁段列表；tool_call 行解析 args.file_path 后缀/全等匹配，tool_use_id 配对 tool_result 的 edit_patch，配不上的 result 按序回退）；② `file-changes/turn-file-diff-dialog.tsx` 弹窗组件（受控 open；加载/失败/无补丁/有补丁四态；有补丁态逐段 DiffView + 工具名标注）；③ turn-timeline 接线（新增可选 prop `sessionId`，TurnTimeline 内持弹窗 state，卡片 onOpenFile 行内闭包上抛 path；sessionId 缺省不传 onOpenFile，旧行为零变化）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- 新增 `TurnFileDiffDialog`（frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx）：props `{ sessionId: string; runKey: string; path: string; source?: "tool" | "shell"; status?: FileChangeStatus; open: boolean; onOpenChange: (open: boolean) => void }`；受控组件，open=true 时拉取。
- 新增纯映射 `collectTurnFilePatches(logs: AgentRunLogEntry[], path: string)`（turn-file-diff.ts）：按序返回补丁段 `{ toolName, rows }`；JSON 非法/hunk 形状不符的段保留占位说明（不静默丢弃、不伪造）。
- 修改 `TurnTimelineProps`：新增可选 `sessionId?: string`（缺省 undefined = 旧消费方零回归）。
- 修改 turn-timeline.tsx 文件卡挂载：cardProps 增传 `onOpenFile`（仅 sessionId 非空时）。
- 修改 FileChangesCard：无 props 形状变化（onOpenFile 已存在）；删除行维持不可点（现行为）。
- 后端/daemon：无端点、无 DTO、无行为变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。日志 API 单轮拉取一次性返回（后端 timestamp,id 升序），弹窗按返回序展示补丁段，不依赖流式增量；同一弹窗打开期间的重复/竞态请求以 AbortSignal 取消旧请求 + 请求序号守卫（仅最后一次结果落 state）。轮次进行中快照尚未上报时文件卡本就不渲染，无乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：弹窗只读 agent_run_logs，不写任何数据；多次点击只更新单个 target state，无并发写冲突。会话切换时 TurnTimeline 以 key=sessionId 重挂（既有纪律），弹窗 state 随组件销毁。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。弹窗关闭/组件卸载即 abort 在途请求并清 state；拉取失败保留错误态可手动重试；切换点击目标以新 target 整体替换旧 target，不残留上一文件内容。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。sessionId + runKey 双重归属由后端 logs 端点闸门保证（跨用户/不属于该会话 404），前端不自行拼接其他会话数据；runKey 取 realRunId ?? runId（与 fork/highlight 同源口径），不串轮。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是补丁配对覆盖率——subagent（Task 工具）内部的 Edit 日志带 parent_tool_use_id/depth 归属列，文件卡 numstat 归因不区分主/子代理；方案按「本轮全部日志（含子代理行）」配对，多出的补丁段照实展示（它们确实改了该文件），不做主/子过滤（过滤反而丢内容）。Write 新建文件的 structuredPatch 可能缺行号形态，parseStructuredPatch 对形状不符返回 null → 该段占位「补丁格式不可解析」，不伪造。

试过放弃的方案：① 给 daemon 快照 DTO 增加 patch 文本字段——放大 /runs 全量轮列表载荷（500 文件上限 × patch 体积），且历史轮无数据，放弃；② 新增 daemon `git diff baselineHead -- path` 端点实时重算——可覆盖 shell 归因行，但需 daemon HTTP 面 + backend 代理，且历史正确性妥协（后续轮改同一文件后 diff 不再是「本轮」内容），跨度超出本需求决策面，记为后续独立变更候选；③ 点击跳转 agent-log 视图——非弹窗形式，违背用户明示「弹窗形式」。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/daemon/file-changes/turn-file-diff.ts | 日志→按路径补丁段纯映射 |
| 新增 | frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx | 文件变更 diff 弹窗（受控 Dialog） |
| 新增 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts | 纯映射单测 |
| 新增 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx | 弹窗组件测试 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 可选 sessionId prop + 文件卡 onOpenFile 接线 + 弹窗挂载 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | page 挂载面传 sessionId（接线弹窗取数归属） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | dialog 挂载面传 sessionId（同 page 模式） |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | 接线/零回归测试 |
