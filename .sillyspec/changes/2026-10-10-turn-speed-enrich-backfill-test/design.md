---
author: flow-machine-draft
created_at: 2026-10-10T19:06:00.000Z
---
# 设计记录（Design Record）— 2026-10-10-turn-speed-enrich-backfill-test

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：上变更 2026-10-10-session-turn-token-speed 独立评审唯一 P3——enrichDisplayTurns
的 apiDurationMs 回填仅 typecheck 覆盖。新增聚焦单测文件直接驱动该纯函数
（enrichDisplayTurns(turns, runsMeta, llmProviders, agentDisplayName, sessionUserId)），
构造最小 SessionTurnView / SessionRunRead fixture，六用例锁定回填优先级、缺失
兜底与引用稳定语义。纯测试补充，实现零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无。零实现改动、零接口变化；仅新增测试文件
frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：不适用——纯函数测试，无事件时序面；测试本身锁定的正是「快照迟到不覆盖
   实时值」语义（?? 链）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：不适用——纯函数无共享可变态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：不适用——无状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不适用——runsMeta 以 run_id 键匹配，测试内 fixture 隔离。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是 fixture 与 SessionTurnView/SessionRunRead 真实形状漂移（手工
构造遗漏必填字段编译报错，tsc 兜底）。放弃的方案：塞进 session-panel-history-race
集成测试（组件级成本高、断言间接）——纯函数直测更聚焦（评审建议即此）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 增 | frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts | 六用例行为测试 |
