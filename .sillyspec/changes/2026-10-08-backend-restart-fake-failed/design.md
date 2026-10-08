---
author: flow-machine-draft
created_at: 2026-10-08T03:57:52.316Z
---
# 设计记录（Design Record）— 2026-10-08-backend-restart-fake-failed

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

线上实证（会话 968e58be，2026-10-08 11:28）：部署重启后端容器时，启动清理
`_cleanup_stale_runs_impl` 只看 DB `status='running'` 就把仍在 daemon 上实际执行的轮判成
failed + SERVICE_RESTART_INTERRUPTED；daemon 6 分钟后跑完并 POST 成功结果，被
`close_interactive_run` 的终态幂等守卫（`interactive_run_close_already_terminal`）no-op 拒收，
UI 永远显示假失败。修两处，互为防线：

1. **事前防误杀**（`backend/app/modules/agent/service.py`）：清理前查该 run 的
   `agent_run_logs` 最新 `timestamp`（该列口径=后端收到上报时刻，正是"daemon 还在报"的信
   号；有 `ix_agent_run_logs_run_timestamp` 联合索引）。距今 ≤ 宽限窗 10 分钟 → 跳过判死
   保持 running；`AgentService.cleanup_stale_runs` 发现跳过项后 fire 一个延迟复扫后台任务
   （睡满宽限窗再查一次，日志停止老化才判 failed），防止 daemon 真死时永卡 running。
   宽限窗覆盖典型部署窗口（容器切换期间 daemon 上报中断通常 <2 分钟，10 分钟留足余量）。
2. **事后能回正**（`backend/app/modules/daemon/run_sync/service/close_run_steps.py`）：终态
   守卫放行唯一例外——run 为 failed + `error_code=SERVICE_RESTART_INTERRUPTED` 且本次上报
   `status=success, is_error=false` 时，清掉误杀残留（error_code/error_detail/output_redacted
   兜底文案）后落入正常收口流程（`_close_apply_terminal` 落 completed + usage/summary、
   `_close_flip_session` 翻会话、post-commit 钩子重发 turn_completed 事件，前端实时收敛）。

迟到的失败结果不回正（不在本变更范围）：status 本就 failed，展示与语义一致，维持拒收。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `AgentService.cleanup_stale_runs()` 对外签名不变，返回值语义微调：仅统计实际判死数量
  （跳过项不计数，`main.py` 既有 count 日志行为兼容）。
- `_cleanup_stale_runs_impl(session)` 内部函数签名不变，新增行为：recent-log 活性检测跳过
  （新增模块常量 `STALE_RUN_ACTIVE_GRACE = timedelta(minutes=10)` 承载宽限窗）；配套新增
  模块级 helper `_has_recently_active_running_runs` / `_recheck_stale_runs_loop`（延迟复扫
  链，仅由 `cleanup_stale_runs` 在跳过发生时调度，测试直调 impl 不触发调度）。
- `close_interactive_run(...)` 公共签名与 HTTP 契约不变（200 + run 快照）；唯一行为变化是
  上述误杀+迟到成功的例外路径从 no-op 变为重放收口。
- daemon / 前端零改动：daemon 本就会重试上报结果（本变更让后端能接住）；前端读 run 终态
  与 turn_completed 事件，回正后自然显示完成。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/agent/service.py | `_cleanup_stale_runs_impl` 加 recent-log 活性检测跳过 + `STALE_RUN_ACTIVE_GRACE` 常量；`cleanup_stale_runs` 跳过项 fire 延迟复扫后台任务（`_fire_background_task` 强引用防 GC 模式） |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | `close_interactive_run` 终态守卫加 SERVICE_RESTART_INTERRUPTED + 迟到成功例外，清残留后走正常收口 |
| 新增 | backend/tests/modules/agent/test_stale_run_cleanup_liveness.py | FR-01 三用例：近期上报跳过 / 停滞清理 / 无日志清理 |
| 新增 | backend/tests/modules/daemon/test_close_interactive_run_retroactive.py | FR-02 两用例：误杀回正 / 其余终态仍 no-op |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   设计核心就是迟到到达——成功迟到被回正；失败/打断迟到维持拒收（status 语义已一致）。
   复扫与迟到结果竞态：若复扫先把活跃轮判死（日志恰好停满宽限）、随后成功结果到达，
   恰好落入 FR-02 回正路径，闭环自愈。日志迟到（daemon 断线缓冲后补报）只会让
   timestamp 更新，方向是"更活跃、更不判死"，安全。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   `close_interactive_run` 全程持该 run 的 FOR UPDATE 行锁，回正分支在同一锁内判定+写入，
   与其它并发收口串行化；复扫后台任务用独立 session（`get_session_factory`），写前同样走
   `_cleanup_stale_runs_impl` 的逐 run 更新，与迟到结果竞态最坏情况同上——先误判后回正，
   收敛。SQLite 测试库下写入天然串行，无死锁面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   复扫任务睡在 asyncio 里，后端再次重启时任务随进程消亡，新一次启动清理重新接管（幂
   等）；任务异常由 `_on_background_task_done` 记日志，不复活不重试（下次重启兜底）。回
   正路径重放 `_close_post_commit` 钩子：auto-recover 只对 failed 生效（回正后是
   completed，no-op）、gate/borrow/排队派发按 completed 语义走，均为正确行为而非重复副
   作用。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   活性检测按 run_id 查日志、回正按 run 行锁判定，均不跨会话/工作区；多 daemon 多实例
   场景下每轮 run 唯一归属一个 daemon 的上报流，日志 recency 就是该 daemon 的活性，
   无串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：宽限窗选小了误杀仍发生（长安静期轮被复扫判死）——但此时 FR-02 兜底回正，最坏
结果是徽标先失败后自动变回完成；窗选大了 daemon 真死时 UI 多挂一会儿"运行中"（10 分钟上
限，可接受）。放弃的方案：(a) 启动清理时探测 daemon WS 在线状态——backend 重启瞬间
daemon 往往尚未重连（实证重启后 41 秒才恢复上报），启动时点探测必假阴性，且"daemon 在线"
≠"该轮还在跑"，信号弱于日志 recency；(b) 迟到结果一律允许重放终态——会破坏既有幂等语义
（失败轮被重复 result 触发重复 auto-recover/事件），风险面大，收窄到误杀标记+成功这一种
组合。
