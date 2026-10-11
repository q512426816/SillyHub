---
author: qinyi
created_at: 2026-10-10T20:55:00.000Z
---
# 设计记录（Design Record）— 2026-10-10-duration-api-cumulative-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：线上会话 0d6b2ba9 实证（postgres 直查）——claude 引擎 SDK 结果的
duration_api_ms 是**会话级累计快照**（逐轮单调递增：2207767→…→3171192，13 秒
轮被写 52.8 分钟），而 duration_ms 是 per-query 墙钟（各轮=本轮墙钟）。close
原样把累计值写进 per-run 列 → 终态 tok/s = 本轮输出 ÷ 会话累计时长 → 逐轮衰减
（0.4 tok/s 实证）。修复两层：① daemon onTurnResult 按会话差分为本轮增量（照搬
同族量 total_cost_usd/_modelUsageBaselineBySession 的既有累计快照差分范式，
含复位报全量与 onSessionEnd/onSessionReloaded 基线回收）；② backend close 物理守卫
（api 时长 > 墙钟为不可能值拒收，保留既有值）防任何引擎再写垃圾。cumulative
increment 与各轮墙钟吻合（DB 逐轮核对 +28.7s/+9.9s/+13.2s），差分后语义正确。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：函数签名零变化。行为变化两处：daemon onTurnResult 对 duration_api_ms 由
透传改为会话级差分上报（增量语义，同 cost 口径）；backend close_interactive_run
对 duration_api_ms 增超界拒收守卫（api > wall 不覆盖）。payload/DTO 字段不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。基线按会话 FIFO 收敛（onTurnResult 串行）；快照回退（当前 < 基线）
   判 SDK 复位报全量（与 cost 同口径）；backend 守卫再兜一层物理不可能值。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：不适用——daemon 会话事件单驱动串行（onTurnMessage/onTurnResult 同 FIFO）；
   backend close 幂等（TERMINAL 守卫既有）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。基线 Map 随 onSessionEnd / onSessionReloaded 回收（同
   _modelUsageBaselineBySession 既有两处），会话重建后从零起不误差分。
   已知边界：daemon 重启后首轮快照无基线报全量（同 cost 既有局限，留档）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不串台。基线按 sessionId 隔离；backend 守卫按 run 行隔离。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是各 CLI 构建的 duration_api_ms 语义不一（真 Anthropic 可能为
per-query 纯 API 时长）——差分逻辑对「真 per-query」值也正确（第二轮起
snapshot≥base 时差值=snapshot−base 会把 per-query 值误差分！）。缓解：差分仅在
snapshot ≥ base 时做，per-query 形态下 snapshot 无单调性（12s→9s 走复位分支报
全量）→ 不会误差分；单调递增的 per-query 序列理论上会被误差分，但 DB 实证本
部署形态是累计量，真 per-query 序列含工具等待通常非单调——留档该假设。
放弃方案：仅做 backend 守卫不做 daemon 差分（守卫后合法累计增量被整段拒收，
正确数据也进不来）；仅做 daemon 差分不做 backend 守卫（防线单薄，其他引擎再犯
无兜底）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/daemon.ts | duration_api_ms 会话级差分基线（+2 处回收） |
| 改 | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | 差分/复位/回收 3 用例 |
| 改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | 超界拒收守卫 |
| 改 | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | 超界拒收/合法写入 2 用例 |
