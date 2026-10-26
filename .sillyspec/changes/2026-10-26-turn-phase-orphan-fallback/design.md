---
author: flow-machine-draft
created_at: 2026-10-26T07:01:45.648Z
---
# 设计记录（Design Record）— 2026-10-26-turn-phase-orphan-fallback

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 frontend/src/components/daemon/session-panel/turn-state.ts 的 applyTurnPhase 一处：run_id 精确匹配（含 realRunId）未命中时，若 currentRunId 指向活跃轮（pending/running/interrupting）则把 {phase, at} 回退写入该轮，否则维持原丢弃。方案=「回退活跃轮」而非「暂存池」：借平台单会话单活跃 run 不变式（后端忙轮守卫+排队机制硬保证），零新增状态、零 TTL、零补写钩子；暂存池（缓存未命中事件+过期+两处补写）是补丁性质且复杂度更高，已与用户对比后否决。背景：生产实证（会话 221ac351）daemon 每轮正常上报（TRACE 记点成对）但事件跑赢 HTTP 响应（占位轮未换真实 run_id）时被前端按"孤 phase 丢弃"设计吞掉，间歇性永远卡「执行器已接收」超时警示；本机 daemon 事件路径快，竞态高发。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

applyTurnPhase 签名不变（turns, runId, phase）→ turns；仅未命中分支行为变化（丢弃→回退写 currentRunId 轮）。后端/daemon/协议零改动（无端点、无事件格式变化）。replacePlaceholderTurn 不改（spread 已保留 currentPhase，仅测试锁定）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-panel/turn-state.ts | applyTurnPhase 未命中分支：currentRunId 活跃轮回退写（FR-01/02/04） |
| 修改 | frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts | 竞态回退/无活跃轮丢弃/排队轮不接 三组用例（FR-01/02/04） |
| 修改 | frontend/src/components/daemon/session-panel/__tests__/turn-state.test.ts | replacePlaceholderTurn 保留 currentPhase 锁定（FR-03；文件已存在则追加用例） |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
成立——last-write-wins 不变（回退写入同样按事件到达序覆盖）；迟到事件在无活跃轮时丢弃（FR-02），有活跃轮时按到达序参与覆盖（与正常事件同语义，不因回退引入特殊乱序路径）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
纯函数不可变更新（map 返回新数组），React 状态机单线程消费 SSE 事件流，无并发写面。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
安全——回退只写 currentRunId 指向轮；轮终态由现有 clearTurnPhase 清 phase（不变）；占位轮竞态兜底（replacePlaceholderTurn 的 raced 分支）不受影响（phase 随字段展开保留）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
不会——turn_phase 事件按 session SSE 频道路由（agent_session:{id}），applyTurnPhase 作用于本会话 turns；currentRunId 是会话内状态机，无跨会话面。回退安全性前提=单会话单活跃 run（FR-05 反例排查：子代理/团队/steering/排队均不构成多活跃轮）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：前端 currentRunId 与后端真实活跃轮短暂不一致（前端状态滞后窗口）——回退写入的是前端眼中的活跃轮，与真实轮错位时 phase 显示到错轮；该窗口内 last-write-wins 与后续精确命中事件会自愈，且原方案（丢弃）在此窗口同样不正确（事件直接丢），回退严格不劣于现状。放弃的方案：①暂存池（未命中事件缓存 30s+建轮时补写）——TTL 管理、补写钩子分散、补丁性质（用户对比后否决）；②backend 延迟发 dispatched/delivered——时序不可控且不解决 daemon 事件与 HTTP 响应的赛跑本质；③前端本地兜底计时器伪造阶段——造假，掩盖真实事件。
