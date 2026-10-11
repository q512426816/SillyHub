---
author: flow-machine-draft
created_at: 2026-10-11T03:58:30.390Z
---
# 设计记录（Design Record）— 2026-10-11-task-sweep-daemon-truth

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户两轮指正击毙了两代启发式：v1「run 终态即收」（后台任务跨轮存活）、v2「5 分钟无心跳即收」（长耗时任务可能静默更久）。任何基于时间/轮次的推断都猜不准「静默但活着」与「死了没上报」——唯一可靠判据是 daemon 后台任务注册表（mgr._backgroundTasks：task_started 注册 / task_notification 注销 / 会话终态清空=SDK 进程 kill 任务随进程消亡，daemon 自己的权威语义）。本变更把死活判定搬到真相源：daemon 新增 `session_live_tasks` 只读 RPC（既有 rpc_id 请求-响应通道，list_dir 平名注册先例；数据经新 helper sessionLiveTaskIds 只读快照，不建空条目）；后端清扫重写为 `sweep_confirmed_dead_tasks`——会话终态/无 runtime 候选直接收（daemon 语义背书），其余逐 runtime 问活跃集、不在集内才收，daemon 离线/超时/旧版 method_not_found 跳过该批（fail-open 保活）；run 收口不再立即收（只在该 run 有非终态候选时 fire 60s 后的 run 限定确认清扫），启动清理同改确认制；TASK_SWEEP_GRACE/is_async/updated_at 全部移出死判；清扫标记与复活分支保留为误收兜底。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- daemon：新增 RPC method `session_live_tasks`（params `{session_id}` → result `{session_id, live_task_ids: string[]}`）；`background-tasks.ts` 新增导出 `sessionLiveTaskIds(mgr, sessionId)`。既有事件/消息契约零改动。
- backend：`agent_task_store` 导出面变化——删除 `finalize_running_tasks_for_run` / `sweep_orphan_running_tasks` / `TASK_SWEEP_GRACE`，新增 `sweep_confirmed_dead_tasks(session, *, hub, run_id=None, rpc_timeout=5.0)`；`RUN_CLOSE_SWEEP_REASON` 保留。
- `close_interactive_run`：收口路径不再同步清扫，改为有候选时 fire `_delayed_task_resweep`（60s 后 run 限定确认清扫）；`AgentService.cleanup_stale_runs` 尾部改调确认清扫。
- HTTP API / 表结构零改动。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | sessionLiveTaskIds 只读快照 helper |
| 修改 | sillyhub-daemon/src/daemon.ts | _registerSessionLiveTasksRpcHandler + 注册接线 |
| 新增 | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | helper 3 用例 |
| 修改 | backend/app/modules/daemon/agent_task_store.py | sweep_confirmed_dead_tasks 重写（删两代启发式函数） |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | 收口改延迟确认清扫（有候选才 fire） |
| 修改 | backend/app/modules/agent/service.py | 启动清理改调确认清扫（传 ws hub） |
| 修改 | backend/app/modules/daemon/tests/test_agent_session_tasks.py | TestRunCloseTaskSweep 迁移为确认制 6 用例 + _StubHub |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。清扫与事件写入（upsert 持任务行 FOR UPDATE）交错时 UPDATE 行级锁串行化；确认后收口的行收迟到 running 心跳走复活分支自愈、收真实终态事件 latest-wins 覆盖（语义③）；RPC 问询与注册表变更的竞态只会让本次判定偏保守（问早了活跃集还含该任务 → 保留）或下次触发点再收敛，无永久错误态。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

安全。确认清扫 UPDATE 按行 id 原子；多 backend 实例并发触发清扫幂等收敛；daemon 注册表单线程维护（daemon 事件循环），RPC 快照读取与注销无撕裂（同一 tick 内完成序列化）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。延迟确认清扫为独立 DB session 后台任务（H1，异常记日志不伤终态）；进程重启丢任务由启动确认清扫补位；daemon 重启清空注册表 = 其上任务随进程消亡（daemon 语义），重启后问询返回空集 → 候选正确收口。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。RPC 按 (runtime_id, session_id) 定向问询；候选行按会话归属分组，run 限定清扫不越界；daemon 注册表本机作用域（问错 daemon 返回空集——但路由按会话绑定的 runtime，正常不发生；即便发生，空集收敛方向与死判一致且有复活兜底）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：部署窗口内 daemon 旧版（无该 RPC method）→ method_not_found 跳过 → 卡死行暂不收敛（回到 v1 之前的滞留态）直到 daemon 升级——安全方向的退化（宁可不收不错收），daemon 经 /daemon 分发自动升级，窗口有限。
- 放弃方案「问询结果缓存 + TTL」：重新引入时间参数且收益微小（清扫触发点低频）；放弃「daemon 周期性全量推送任务表」：广播放大 + 双端状态机，远重于按需问询。
- 已知残留：daemon 注册表本身的丢失窗口（重启后 task_notification 无处可归被跳过——17 条实证根因）仍会让终态事件丢失，但确认清扫在下一触发点把它收敛（这正是本设计的收敛路径）；is_async 列仍恒 false（daemon emit 不带 async 字段——遗留元数据问题，不再是死判依赖，留待后续按需修）。
- 前两代裁决作废声明：run-close-task-sweep 的「run 终态即收」与 task-sweep-liveness-guard 的「5 分钟宽限」死判均被本变更废除，标记/复活机制沿用。
