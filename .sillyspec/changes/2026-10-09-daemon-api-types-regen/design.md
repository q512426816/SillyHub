---
author: flow-machine-draft
created_at: 2026-10-08T17:57:00.000Z
---
# 设计记录（Design Record）— 2026-10-09-daemon-api-types-regen

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单一动作：在 sillyhub-daemon 目录跑既有 `pnpm gen:types`（scripts/gen-api-types.mjs 消费仓库 backend/openapi.json 单一契约源），重生成 src/api-types.ts。动机：2026-10-09 风险审查实证该副本仍是旧 72 项 Permission 联合（含 2026-10-08 RBAC 清理删除的 16 个死键），且落后多轮后端契约（含知识图谱端点）；daemon 源码无按值消费死键的代码（grep 实证），故为类型债而非运行时风险，但仍违反规则 21「生成物不落后后端」精神。选纯重生成而非手改：生成物逐字来自 openapi.json，手改必再造漂移。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/api-types.ts`：整文件重生成（+5625/−1591——多轮后端契约追赶：RBAC 58 项联合、知识图谱端点等）。类型面（编译期擦除），daemon 运行时行为零变化。
- backend / 前端 / daemon 手写代码：零改动。
- HTTP 端点 / 协议：零变化（openapi.json 本身是既有已提交状态）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：纯生成物同步，无运行时逻辑；生成脚本确定性消费当前 openapi.json。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：单文件生成，无共享写面（openapi.json 为只读输入）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：类型文件无生命周期；生成中断只是旧文件保留，重跑幂等。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：生成输入锚定仓库内 backend/openapi.json 相对路径（脚本 resolve 同仓），不取远端或环境相关源。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：大 diff（5625+/1591-）可能携带生成器版本差异噪音（openapi-typescript 7.13.0 与上次生成版本的输出形态差）——已由 daemon tsc 0 error 消解编译面疑虑；类型联合收缩理论上可能破坏穷举 switch，但 grep 实证 daemon 源码零处按值消费被删键。试过放弃：(a) 手改 Permission 联合一处——放弃，其余多轮落后面仍在且手改生成物必漂移；(b) 顺带把 gen:types:check 接进 CI workflow——放弃，超出本变更（审查风险收口）范围，留作后续建议。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/api-types.ts | pnpm gen:types 重生成（类型债清偿） |
