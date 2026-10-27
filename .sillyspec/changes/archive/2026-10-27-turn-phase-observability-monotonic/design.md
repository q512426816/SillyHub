---
author: flow-machine-draft
created_at: 2026-10-27T04:37:17.255Z
---
# 设计记录（Design Record）— 2026-10-27-turn-phase-observability-monotonic

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

生产实证（2026-10-27 会话 7eff99e1，run 4f2e2cdd）：first_event 信号丢失后前端 phase 停
delivered 干等 141 秒；排障时发现 daemon 上报是 fire-and-forget，**桥层**（session-manager
转发点 daemon.ts:4887 起，inject_received/first_event 等运行时 phase 的必经路）失败仅 debug
日志——生产 info 级不可见；创建链五步（daemon.ts:9537 reportTurnPhase）已有首警 warn 惯例，
桥层是漏网点。另评估确认：steering 忙轮注入时 backend 会为同活跃轮再发 dispatched/delivered，
前端 applyTurnPhase 无条件 last-write-wins 会把已推进 phase **退化回投递段**（first_event
每 run 防重不会重发 → 卡投递段直到终态）——显示退化真实存在，需单调守卫。

三项改动（daemon 前端各一点）：
1. **桥层失败首警**（daemon.ts:4914-4937 两处）：debug 前补 warnOncePhaseFailure（对齐
   9537 惯例：首警 warn 同 (session_id, phase) 去重 + debug 明细并存，成功仍静默）。
2. **applyTurnPhase 单调守卫**（turn-state.ts）：词表九值定序，回退写（新 phase 序 <
   现值序，双方均词表内）静默丢弃；前跳/同值覆盖/词表外值透传维持 last-write-wins。
3. **log 退位集合扩展**：retireDeliveryPhase 的集合从 {dispatched, delivered} 增
   inject_received（AI 已输出的场合「消息已送达 AI」同样失去展示意义），函数名保留。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/daemon.ts`：桥层拦截分支两个失败 handler 各补一行
  warnOncePhaseFailure 调用（无签名变化）；warnOncePhaseFailure 模块级已 import。
- `frontend/src/components/daemon/session-panel/turn-state.ts`：新增模块级 PHASE_ORDER
  常量（词表九值序）；applyTurnPhase 内部写入前守卫（导出签名不变，行为变化：词表内
  回退写丢弃）；retireDeliveryPhase 的 Set 增 inject_received（导出名不变）。
- backend / SSE 协议 / 词表九值零改动；turn_phase 事件流零改动；无新端点命令。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

守卫按词表序判回退——乱序前跳（delivered 先到、dispatched 迟到）顺手修正为丢弃迟到低序；
双方任一词表外值（未知 phase 透传兼容策略）不参与守卫，维持原 last-write-wins；终态轮迟到
phase 写入问题（消费方 clearTurnPhase 后又被迟到事件写回）为既有边界，本次不扩（见风险节）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

daemon 侧 warnOncePhaseFailure 集合为模块级 Set（有界 512 逐出最旧，turn-phase-
observability 既有惯例，单线程事件循环内无竞态）；前端纯 reducer 串行链，无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

守卫只改写入判定不改清除路径（clearTurnPhase/retireDeliveryPhase 职责不变）；warnedKeys/
notedKeys 随进程重启清零（既有语义）；轮终态清 phase 后新轮事件从 null 起判，无残留。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

daemon 守卫按 (session_id, phase) 键；前端守卫按轮内 currentPhase 单值判定，均不涉跨
工作区/跨仓数据；多 daemon 实例各自进程级集合天然隔离。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：单调守卫对 steering 新消息的取舍——新消息的 dispatched/delivered 被守卫丢弃后，
用户看不到「新消息已送达」的短暂反馈（显示停在旧 phase）；与「退化回已接收」相比是净改善
（随后新消息的 inject_received 同序覆盖可推进），且 30 秒停滞文案兜底仍在。
试过放弃的方案：① 守卫按时间戳而非词表序——phase 事件无服务端序号，at 是前端到达时刻，
乱序前跳会误判；② 终态轮迟到写入一并修——涉及消费方终态幂等链，超出本变更两点收敛原则，
留待实证后再立项。
