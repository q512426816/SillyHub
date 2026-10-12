---
author: qinyi
created_at: 2026-10-12T10:05:00.000Z
---
# 设计记录（Design Record）— 2026-10-12-duration-backfill-harness-align

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：用户正确质疑昨日守卫（duration_api_ms > duration_ms 拒收）——子代理并行时
Σ(各代理 API 窗口) > 父轮墙钟是合法形态，守卫会拒掉真实值。对照 deepseek-harness
本地源码（packages/session/session-stats/src/projection.ts:154-175）：终态时长权威
=事件层自测窗口逐步累加（llmMs=完成时刻−step 开始、decodeMs=完成−首 token，
按 step 求和），不消费提供方 duration 聚合，Σ窗口>墙钟合法无守卫。本平台等价物
=已建的实时窗口累加（usage.api_duration_ms，claude/codex/pi 桶计时）。故撤销墙钟
守卫，close 元数据降级为回填（列 NULL 才写，实测值权威不覆盖）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：签名零变化。close_interactive_run 行为变化：duration_api_ms 由「有值即覆盖
（昨日版含墙钟守卫）」改为「仅列 NULL 时回填」——实测值（实时窗口累计）权威。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。close 每轮一次（TERMINAL 幂等既有）；usage 管线实时值先于 close
   落列（submit_messages 在 close 之前），回填只发生在无实时值时。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：不适用——单 run 的 close 单点收口；实时写回（submit）与 close 分属请求
   边界，TERMINAL 终态守卫防 close 复活。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。回填不引入新状态；列值要么实测要么回填一次，无累加面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不串台——按 run 行操作。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险——旧 daemon（未部署实时计时）+ 新 backend 下，close 回填的值仍
可能是会话累计垃圾（daemon 差分修复 27695397c 未部署时），过渡期老轮显示仍
失真。缓解：部署时 backend 与 daemon 同批换镜像（deploy-to-server 单包交付），
过渡窗口仅存在于分步部署场景。放弃方案：①保留墙钟守卫（拒真实并行子代理值，
用户正确否决）；②close 完全不写 duration_api_ms（无实时计时的引擎/旧 daemon
彻底没速度，回填好于空白——值语义在 daemon 差分部署后为正确增量）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | 撤墙钟守卫 → 仅回填 |
| 改 | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | 两守卫用例 → 回填/不覆盖两用例 |
| 改 | .sillyspec/docs/backend/modules/daemon.md | usage 管线段语义修正 |
