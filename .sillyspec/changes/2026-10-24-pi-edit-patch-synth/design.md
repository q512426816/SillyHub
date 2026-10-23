---
author: flow-machine-draft
created_at: 2026-10-23T16:07:38.885Z
---
# 设计记录（Design Record）— 2026-10-24-pi-edit-patch-synth

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：pi 运行时（pi-events.ts 设计期把 edit_patch 列为"非目标"）的工具结果只有"Successfully wrote/replaced …"确认文本，无任何 diff 数据——但 **edit 的入参 `edits[{oldText,newText}]` 与 write 的入参 `content` 本身就是完整变更内容**（实测会话 f019f0d2 第 8 轮：490 条日志 0 条 edit_patch 行，11 个 write/edit 调用入参齐全）。修法在 daemon 侧合成：`tool_execution_end` 到达且工具为 edit/write 且成功时，从该 call_id 登记的入参合成 structuredPatch（前端既有格式 `[{oldStart,newStart,lines:["-old","+new"]}]`）挂到 tool_result 事件的 `edit_patch`——backend 对 edit_patch 是字符串透传、前端 parseStructuredPatch 既有消费，**双侧零改动**。行号来源：end 时读改后文件，按顺序定位每块 `newText` 得 `newStart`（前缀换行计数），`oldStart = newStart + 前块净行偏移`（多块累积）；write 全 add 行（覆盖写旧行不可知，如实展示写入后全文）。

配套前端兜底（FR-04）：daemon 升级前的存量 pi 轮次仍无补丁，弹窗无补丁文案按"文件行编辑归因"区分——有归因（改N次>0）改说"确实来自 agent 编辑但运行时未上报补丁"，消除"明明是 agent 写的却说不是"的错误断言（用户实证主诉）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- 修改 `sillyhub-daemon/src/interactive/pi-events.ts`：①`handleToolStart` 增加入参登记（`Map<callId, {toolName, args}>`，实例字段；turn_end 随 `segments.clear()` 同点清理 + 容量上限 64 防泄漏——归一化器原"零状态"设计为局部突破，登记仅轮内生命周期）；②`handleToolEnd` 工具名 `edit`/`write` 且 is_error=false 时调合成函数，产物挂 `ev.edit_patch`（string）。**AgentEvent 协议零变化**（edit_patch 是既有一等字段，claude 轨道同款）。
- 新增 `sillyhub-daemon/src/interactive/pi-edit-patch-synth.ts`：纯合成模块 `synthesizePiEditPatch(args, readFile)` / `synthesizePiWritePatch(args)`（readFile 可注入测试）；产出 structuredPatch JSON 串或 null。64KB 上限（对齐 claude 轨道附着惯例）。
- 修改 `frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx`：新增可选 prop `agentEdited?: boolean`（卡片行点击时传 `edits>0`）；无补丁文案二态。卡片 `file-changes-card.tsx` 行点击回调透传该值（onOpenFile 载荷加字段或组件侧组装，取最小面）。
- 无端点、无 DTO、无 OpenAPI 变化；backend 零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：end 时读盘定位基于「文件已是该工具执行后的状态」——pi 事件流 tool_execution_end 在工具实际完成后发出，成立。若 end 与下一工具 start 之间他进程再改文件导致 newText 定位不到 → FR-03 放弃（不附着），安全降级；定位到错误位置（newText 在文件中多次出现且首现非真实位置）→ 行号近似偏差，diff 内容本身仍真实（来自入参），可接受并已在 jsdoc 披露。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：合成只读盘（readFile）+ 写事件字段（进程内），无工作区写面；与并行会话改同一文件的竞态落 FR-03 定位失败放弃。登记 Map 为归一化器实例内私有（每会话独立实例），无跨会话共享。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：登记 Map 在 turn_end 清理（与 segments 同点）；会话中断残留条目由容量上限 64 兜底（超限逐出最旧）；合成失败仅缺 edit_patch，工具结果事件本体不受影响。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。入参登记按 call_id（pi call_id 会话内唯一）；读盘路径来自入参 path（该会话工作区内）；多 daemon 实例各自进程内状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是 **oldStart 行号的近似性**——块替换前面的内容有他源改动时，累积偏移算出的旧行号有偏差（diff 内容仍真实，行号标注可能偏几行）。缓解：jsdoc 披露；newStart（新文件行号，弹窗主体信息）由实盘定位恒精确。次风险：入参登记打破 pi-events 零状态设计——登记面收敛为 call_id→args 单 Map、轮内生命周期、容量上限，复杂度受控。

试过放弃的方案：①daemon 在 tool_use 时刻读旧文件、end 时刻读新文件算真 diff——旁路观察与工具执行竞态（start 到 end 间他源改动会被误算入该工具），且 pi 工具在 driver 外执行、时序不可靠，放弃；②解析 pi 结果文本中的路径与块数——结果无内容无行号，解析只得元数据无 diff 体，放弃；③前端从 tool_call 入参自行渲染（A+ 方案）——不改 daemon 但弹窗要做第二套渲染（write 全文视图/edit 块视图），且每会话拉全量 tool_call 入参放大 payload，放弃（用户已裁决走根治）；④放宽前端 parseStructuredPatch 行号可空——动 claude 轨道共用解析器，回归面大，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/pi-events.ts | handleToolStart 入参登记 + handleToolEnd 合成挂 edit_patch |
| 新增 | sillyhub-daemon/src/interactive/pi-edit-patch-synth.ts | 合成纯函数（edit 定位行号/write 全 add/64KB 上限） |
| 新增 | sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts | 合成矩阵单测 + pi-events 事件级接线用例 |
| 修改 | frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx | agentEdited prop + 无补丁文案二态 |
| 修改 | frontend/src/components/daemon/file-changes/file-changes-card.tsx | 行点击透传 agentEdited（最小面） |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx | 文案区分用例 |
