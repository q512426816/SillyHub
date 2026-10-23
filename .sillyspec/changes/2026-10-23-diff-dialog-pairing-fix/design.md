---
author: flow-machine-draft
created_at: 2026-10-23T06:40:17.501Z
---
# 设计记录（Design Record）— 2026-10-23-diff-dialog-pairing-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：根因两层（第二层为评审修正后的关键发现）：

**第一层（表象）**：`collectTurnFilePatches` 的②回退配对把无主补丁「按日志序塞给路径命中目标文件的第一个未用编辑调用」——隐含假设「无主补丁都属于弹窗目标文件」，多文件编辑轮必然张冠李戴（2026-10-23 实证：会话 49c5c3ec / run 63130ca1，点 task-runner.test.ts 显示 design.md 内容）。

**第二层（真根因）**：①精确配对读的是日志行顶层 `entry.tool_use_id`，但 `agent_run_logs` **没有该列**（backend schema 注释明写「DB 无此列」，仅 slim 截断时由路由内存回填）——真实配对键在 `metadata.agent_event.call_id`（新轨事件逐行落库，`submit_steps.py:594/628`）。因此①在弹窗的真实 REST 链路上**从未生效**，全部补丁都落进②启发式配对，这才是错配的系统性成因。

**修法**：①配对键改为 `entryCallId(entry)`——`metadata.agent_event.call_id` 为主，回退顶层 `tool_use_id`（slim）与 content JSON 内 `tool_use_id`（旧轨）；id 索引全量预建（容忍乱序批次）。②回退改为**子代理轨道隔离 + 同轨唯一悬置**：按 `parent_tool_use_id` 分轨，候选取「同轨、日志序已出现、未消费的编辑族调用」，恰好一个才配、否则丢弃（平台支持后台子代理并行，跨轨配对会把 A 的补丁挂到 B 名下；同轨多悬置亦无法确证）。

选「就近紧邻」而非「修数据面补 id」的原因：数据面哪一环丢 id 未定（本地 transcript/rollout 均无 structuredPatch，取证只能靠平台日志接口——当日对长会话持续超时），前端就近配对在 id 缺失前提下独立成立且立刻止血；数据面问题登记 docs/sillyspec 活跃坑留待根治（FR-04）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- 修改 `collectTurnFilePatches(logs, repoRelPath)`（turn-file-diff.ts）：**导出签名不变**，内部重写——①配对键 `entryCallId(entry)`（`metadata.agent_event.call_id` > 顶层 slim `tool_use_id` > content JSON `tool_use_id`），id 索引全量预建；②回退按 `parent_tool_use_id` 轨道隔离，同轨唯一悬置才配、否则丢弃。
- 新增内部函数 `entryCallId(entry)`（配对键单一入口）。
- 无端点、无 DTO、无组件 props 变化；TurnFileDiffDialog 与 file-changes-card 零改动。
- docs/sillyspec/edit-patch-tool-use-id-missing.md 按修正后事实改写（DB 无顶层列、id 在 metadata.agent_event.call_id）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：①的全量预建索引使「result 行先于 call 行」的乱序批次仍能配对（评审 P3 修正）；②回退只看「日志序已出现」的同轨调用，迟到补丁落在哪就按哪的候选面判定，不回溯。真并行（后台子代理/同轨多 tool_use）经轨道隔离 + 唯一性判定处理：跨轨互不干扰，同轨多悬置诚实丢弃。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：无新写面。本函数是纯映射（logs 只读→sections 新数组），弹窗每次 open 拉一次日志（AbortController 竞态守卫沿用）；无共享状态、无缓存。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。无跨调用状态；弹窗关闭 abort 请求（既有）；重试按钮重建状态（既有）。就近游标是函数内局部变量，单次调用生命周期。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。输入 logs 已按 sessionId+runId 圈定（弹窗 fetch 参数），路径过滤按仓根相对路径（matchesRepoPath 既有）；就近配对只在单轮日志内进行，无跨轮/跨会话状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是「无 id 且同轨多悬置时补丁显示率下降」——诚实丢弃，用户看到无补丁说明。定性：错内容比没内容危害大；且①恢复 metadata 键后真实链路绝大多数补丁走精确配对，②只在极旧/异常数据上兜底。次风险：`metadata.agent_event` 在新轨未落库的历史行上缺失 → 回落顶层 slim 键；两者都缺 → ②同轨唯一悬置。均已如实降级、不伪造。

试过放弃的方案：①只改②回退「就近最近悬置」（首版实现，评审否决）——未发现①从未生效的真根因，且串行假设不成立于后台子代理并行形态，会把 A 的补丁挂到 B 名下；②悬置>1 一律丢弃但不修①——真实链路仍全落②，串行轮也可能因悬空而大面积丢段，放弃；③按「补丁内容文件路径启发式」猜归属（structuredPatch 不带路径，伪归因，放弃）；④弹窗列出「本轮全部无主补丁」转嫁用户（弹窗语义劣化，放弃）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/file-changes/turn-file-diff.ts | ②回退改就近紧邻配对 + 诚实丢弃；①分支零改动 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts | 就近配对/交错丢弃/实证复现用例 + 既有用例零回归 |
| 新增 | docs/sillyspec/edit-patch-tool-use-id-missing.md | 数据面 id 缺失已知问题登记（现象/影响/取证路径） |
