---
author: flow-machine-draft
created_at: 2026-10-27T03:15:55.524Z
---
# 设计记录（Design Record）— 2026-10-27-turn-phase-stall-honest-ui

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

生产实证（2026-10-27 会话 7eff99e1）：会话忙时用户消息在 backend 排队/派发链路滞留
9 分钟（10:38 发出、10:47:36 才注入 daemon，daemon.log 全程零 turn_phase 打点佐证），
期间前端轮状态条唯一 phase=delivered 无限计时，用户等 141 秒截图误以为卡死。精确滞留
环节需 backend（腾讯云）日志，本变更只做纯前端显示层双兜底：

1. **停滞文案**（turn-status-bar.tsx）：dispatched/delivered 停留超 30 秒（沿用
   PHASE_TIMEOUT_MS）时标签切 DELIVERY_STALL_LABEL「等待执行器开始处理」排队语义，
   告知「尚未开始处理、可能在排队」而非干等计时；执行期阶段（skills_sync/spawning/…）
   超时仍显词表文案，零变化。
2. **log 退位**（turn-state.ts）：log 事件有 DB 兜底必达——轮收到真实输出时仍挂的
   dispatched/delivered 已失去展示意义，upsertTurn 内对 log 事件的 apply 结果统一过
   retireDeliveryPhase 清除（page/dialog 双模式共用 upsertTurn 单点覆盖）。只清投递
   两阶段，执行期阶段不越权清除。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/components/daemon/session-panel/turn-state.ts`：新增导出纯函数
  `retireDeliveryPhase<T extends {currentPhase?: TurnPhaseState | null}>(turn: T): T`
  （与 clearTurnPhase 并列，泛型同款）；`upsertTurn` 内部对 env.event === "log" 的
  apply 结果包一层 retire——函数签名不变，行为变化：log 事件目标轮的
  currentPhase ∈ {dispatched, delivered} 时被清 null。
- `frontend/src/components/daemon/turn-status-bar.tsx`：新增导出常量
  `DELIVERY_STALL_LABEL = "等待执行器开始处理"`；渲染逻辑新增 stalledDelivery 分支
  （超时且投递两阶段时标签切换）。props 契约不变。
- 后端 / daemon / SSE 协议零改动（turn_phase 词表、事件流均不动）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：turn_phase 与 log 乱序到达按 last-write-wins（applyTurnPhase 既有
   语义）。log 先到清了 delivered、随后迟到的 delivered phase 事件会重写 currentPhase
   ——窗口极窄（delivered 由 backend 在 daemon ack 时即发，log 属执行期，正常序相隔
   分钟级），且即使重写，停滞文案兜底仍生效（30 秒后再次切排队语义），可接受。
2. 并发写：纯前端 reducer 链（SSE 事件串行进 React 状态机），无并发写面。
3. 切换/生命周期：currentPhase 本就是内存态（刷新即失，D-013①），retire 只提前清除
   不引入新生命周期；轮终态清理由 clearTurnPhase 既有路径负责，职责不重叠。
4. 作用域：改动均在 turn-state 共享纯函数与展示组件，按 runId 归属路由（upsertTurn
   既有不变式），不涉跨工作区/跨仓数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：文案语义近似而非精确——「等待执行器开始处理」覆盖排队/补拉/重试多种滞留
成因，无法区分告知用户具体环节；这是纯前端单侧可见性的固有限制（精确区分需 backend
补排队态信号，属后续变更）。
试过放弃的方案：给 upsertTurn 出口对全部轮统一 retire（不分事件类型）——会误清其他
轮的合法 phase（非本事件归属），改为只对 log 事件的 apply 目标轮生效；新增独立停滞
阈值（如 90 秒）——与既有 30 秒警示双阈值叠床架屋，沿用 PHASE_TIMEOUT_MS 单阈值。
