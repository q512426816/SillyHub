---
author: flow-machine-draft
created_at: 2026-10-08T17:21:38.088Z
---
# 设计记录（Design Record）— 2026-10-09-stale-recheck-scope

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 `backend/app/modules/agent/service.py` 的 stale run 清理链一处，修 2026-10-09 风险审查实证的三缺陷（原实现来自 2026-10-08-backend-restart-fake-failed）：(1) **范围收窄**——`_cleanup_stale_runs_impl` 之后的排期不再用「全系统任意 running 轮日志新鲜」作条件，新增 `_deferred_run_ids(session)`（单 group-by 查询取 running 轮最新日志时刻，宽限窗内者即启动跳过项）作为复扫链唯一追踪集合快照；`_recheck_stale_runs_loop(deferred_run_ids)` 只对该集合工作，集合清空即退出，启动后新开的轮永不进判死面（长期僵尸归还 patrol）。(2) **daemon 活性门**——新增 `_run_daemon_alive(session, run_id) -> bool | None`（链路 run 最新 lease（updated_at 倒序首见即定）→ runtime → daemon 实例；True=online 或心跳宽限窗内，False=offline 且心跳停滞超窗，None=链路不可解析），复扫对日志停滞的追踪轮：alive=True 保持追踪，False/None 才判死（None 退回纯 recency，防永卡兜底不缩小）。(3) **韧性 + 锁粒度**——循环体逐迭代 try/except（连续失败 ≥ `_RECHECK_MAX_CONSECUTIVE_ERRORS`=5 才 log.error 放弃）；启动清理与复扫都把 recency 判定移到 FOR UPDATE 之前（快照元数据完整的恢复分支仍先加行锁），逐轮 commit 即时释放行锁。判死字段写入提取共用助手 `_mark_stale_run_failed`（字段语义不变，error_code 是 FR-02 回正例外条件的匹配键）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `AgentService.cleanup_stale_runs() -> int`：签名与返回语义不变；内部排期条件从 `_has_recently_active_running_runs`（已删）换为 `_deferred_run_ids` 非空，日志多带 `tracked_runs` 数。
- `_cleanup_stale_runs_impl(session) -> int`：签名不变（三个既有测试文件直接调用并断言 int）；行为变化=先判后锁 + 逐轮提交。
- 新增模块级私有：`_deferred_run_ids`、`_recheck_deferred_runs(session, tracked) -> set[uuid]`、`_run_daemon_alive`、`_mark_stale_run_failed`、`_last_run_log_at`、`_as_utc`、常量 `_RECHECK_MAX_CONSECUTIVE_ERRORS`。
- `_recheck_stale_runs_loop(deferred_run_ids: list[uuid.UUID])`：参数从无到有（内部 fire 时传入）。
- 删除 `_has_recently_active_running_runs`（唯一调用点被 `_deferred_run_ids` 取代）。
- HTTP 端点 / daemon 协议 / DB schema：零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。daemon 迟到成功仍由 FR-02 回正路径兜底——判死写入前后均以 FOR UPDATE 重读 + status 校验拦截并发收口（守卫语义保留，既有用例钉死）；复扫无锁预判到锁定重读之间收口的轮，重读见终态即放弃。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

复扫与 close_interactive_run 的行锁串行化保持；新锁序（先判后锁 + 逐轮提交）把持锁窗口从「全循环」缩到「单轮写入」，10 分钟周期对 daemon 收口的锁竞争面消失。`_deferred_run_ids` 的快照语义（启动时点一次）不受启动后新轮影响。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。循环退出条件从「全系统无活跃轮」改为「追踪集合空」，健康长静默轮（daemon 在线）会一直被追踪——每 10 分钟一次只读查询代价可忽略；进程关停时循环随事件循环消亡（与原实现一致，_background_tasks 强引用防 GC）。单轮复扫的 commit 在 cancel_pending_dialogs_for_run 之后逐轮发生，中断时已处理轮状态完整。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。单 uvicorn worker 进程内至多一条复扫链（排期点唯一：startup lifespan）；追踪集合是进程内存态，多实例部署（当前无此形态）下各自追踪各自启动快照，判写幂等不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：daemon 活性门放过的「在线 daemon + 永久静默轮」会一直被追踪不判死——有意取舍（对齐 patrol 判死段语义：在线 daemon 的轮不判死，归属用户取消/会话超时面）；若需硬上限可后续迭代加最长追踪时长。次风险：`_run_daemon_alive` 的 lease 倒序首见语义在 lease 频繁重建时可能解析到无 runtime_id 的新 pending lease 而返回 None——None 走 recency 判死，方向与原实现一致不放大。试过放弃：(a) 复扫判死面保持全局仅加活性门——放弃，启动后新开轮每 10 分钟进判死面本身就是审查实证缺陷源；(b) 循环异常无限重试——放弃，持久故障下无限日志噪音且违背有界退避要求。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/agent/service.py | 复扫链范围收窄/活性门/韧性/锁粒度四项修复 |
| 新增 | backend/tests/modules/agent/test_stale_run_recheck.py | 范围、daemon 活性、循环韧性、零锁面新用例 ×9 |
