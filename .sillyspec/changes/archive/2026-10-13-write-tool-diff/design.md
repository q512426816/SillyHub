---
author: flow-machine-draft
created_at: 2026-10-13T02:48:04.597Z
---
# 设计记录（Design Record）— 2026-10-13-write-tool-diff

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

会话面板 Write 工具展开区此前只渲染纯文本全文（`<pre>`），diff 渲染只接给了 Edit 分支。数据侧 `edit_patch`（SDK `tool_use_result.structuredPatch` 序列化）的抓取与配对链路本就不限工具名（backend sdk_pipeline.py / daemon claude-events.ts 抓取，session-log-assembler.ts 配对写入 `segment.editPatch`），Write 覆盖已有文件时数据现成，纯属性前端没接线。

故只改 `frontend/src/components/daemon/tool-args-detail.tsx` 一处：`WriteArgsDetail` 接 `segment.editPatch` 走 `parseStructuredPatch`→`DiffView`（与 Edit 完全同管线）；无 patch（新建文件 type:"create" 天然无 structuredPatch、非 claude provider 无此通道）回退整文件按新增行全绿展示。实证依据：本机 Claude Code 会话 JSONL 抽样，structuredPatch 仅 Edit 与 Write 覆盖写（type:"update"）携带。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `WriteArgsDetail`（模块内私有组件，非导出面）签名从 `{ raw }` 扩为 `{ raw, editPatch? }`；`argsDetailOf` 的 Write 分支开始传 `segment.editPatch`。
- 对外可见行为变化：Write 工具展开区从纯文本全文 pre 变为 DiffView——覆盖写显示红删绿增（真实文件行号）+ 标题「变更对比（覆盖写入 +N −M）」；无 patch 显示全绿新增行 + 标题「写入内容（N 行）」；复制按钮两个分支均保留（复制完整原文）。超过 2000 行走 DiffView 既有截断护栏。
- `DiffView` 截断提示文案改为工具中性（「完整内容用『复制新文本』」→「完整内容用『复制』按钮」），无测试断言该文案。
- 端点/命令/文件格式：无。其余工具（Edit/Bash/Read/Grep/Glob/Agent/通用）渲染零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。渲染只读装配产物 `segment.editPatch` 单字段，不依赖行序；edit_patch 随 tool_result 行配对写入是装配器既有逻辑。editPatch 缺失、迟到（未配对段）或 JSON 非法/形状不符时 `parseStructuredPatch` 返回 null → 全绿回退，渲染不崩。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：纯渲染层改动，无共享可变状态、无 I/O 写面；组件只读 segment 不可变字段。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。展开区按需挂载（ToolRowView open 时），切会话/重放随段重建，无跨渲染持久状态；slim 全文回填路径（`effectiveSegment.raw` 替换后重渲染）与 diff 渲染天然兼容——回填前后渲染逻辑同一条。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。改动仅会话面板 daemon 工具展开区单文件，editPatch 按段携带、随段消亡，无跨工作区/跨仓/多实例共享数据流。变更运行日志视图（agent-log/tool-renderers.tsx）不在本次范围。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：无 patch 的覆盖写（非 claude provider）被整文件全绿展示，视觉上像新建文件。缓解：该分支标题保留「写入内容（N 行）」不称「新增文件」，复制按钮给完整原文兜底；claude 会话（主场景）覆盖写必有 patch、不受影响。

放弃的方案：(a) 嗅探 tool_result 文本（"File created successfully" vs "updated"）区分新建/覆盖——依赖各 provider 文案措辞，脆弱，放弃；(b) 同步接线 agent-log 变更运行日志视图——该视图 edit_patch 数据链未通（normalize 链需另动），超出薄跑道范围，留后续变更。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/tool-args-detail.tsx | WriteArgsDetail 接 editPatch + 全绿回退；文件头 docblock Write 行更新；DiffView 截断提示中性化 |
| 修改 | frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx | 新增 Write 展开 diff 两用例（有/无 editPatch） |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 两个旧 Write 渲染契约用例同步新契约（pre→diff 行、截断断言更新） |
