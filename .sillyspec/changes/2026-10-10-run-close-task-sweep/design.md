---
author: flow-machine-draft
created_at: 2026-10-10T15:47:26.914Z
---
# 设计记录（Design Record）— 2026-10-10-run-close-task-sweep

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

线上实证（会话 47e2ff1a，run 5e485ba2 completed 09:00:41）：`agent_session_task` 17 条卡 running（最后更新停在 08:37，全部属该 run），任务列表在会话结束后仍显示子代理「进行中」。根因：该表只按 `agent_task_status` 事件 upsert（agent_task_store），run 终态的两条路径——close_interactive_run（daemon 收口）与 cleanup_stale_runs（重启判死）——都不清理其任务行，子代理被放弃/未上报终态时永卡 running。修法：agent_task_store 新增 `finalize_running_tasks_for_run`（单 run 批量 UPDATE running→stopped + 可读 message），close_interactive_run 在终态 commit 前同事务调用（原子：run 终态与任务收口同生共死）；新增 `sweep_orphan_running_tasks` 启动兜底（run 已终态但任务仍 running 的存量全量收口，自愈历史脏数据——47e2ff1a 的 17 条在下次部署重启后自动修复，无需手工 SQL），挂在 cleanup_stale_runs 尾部 try/except。不选「读端把终态 run 的 running 任务渲染为停止」——治标且脏数据永存。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `agent_task_store` 新增两个导出 async 函数：`finalize_running_tasks_for_run(session, *, run_id, now=None) -> int`、`sweep_orphan_running_tasks(session) -> int`（后者自带 commit）。
- `close_interactive_run` 行为增强：终态同事务多一步任务清扫（新日志事件 run_close_task_sweep）；对外签名不变。
- `AgentService.cleanup_stale_runs` 行为增强：尾部追加兜底清扫（新日志 startup_orphan_task_sweep）；返回值语义不变（仍返回 stale run 数）。
- HTTP API / 表结构 / 前端零改动（任务端点读到的 status 自然变 stopped）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/daemon/agent_task_store.py | 新增 finalize_running_tasks_for_run + sweep_orphan_running_tasks |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | close_interactive_run 终态 commit 前接入清扫（同事务） |
| 修改 | backend/app/modules/agent/service.py | cleanup_stale_runs 尾部接入启动兜底清扫 |
| 修改 | backend/app/modules/daemon/tests/test_agent_session_tasks.py | TestRunCloseTaskSweep 三用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。清扫后迟到的 running 事件被 upsert 语义②（终态吸收）整行跳过——任务不复活（test_finalize_after_sweep_running_heartbeat_no_revive 钉死）；迟到的真实终态事件（completed/failed）仍可覆盖 stopped（语义③ 异种终态 latest-wins），信息不失真。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

close 路径持 run 行 FOR UPDATE 后清扫（同事务），与并发 upsert 的竞争由 UPDATE 行级锁串行化；启动兜底与 daemon 收口并发时二者都写 stopped，幂等收敛；rowcount 仅作日志观测。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。清扫与 run 终态同事务（close 失败回滚则清扫一并回滚，不产生「run running 但任务 stopped」的中间态）；启动兜底独立 commit、失败仅日志不阻塞启动。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。两函数均按 run_id / 「run 已终态」限定行集，不触碰其它会话；无跨实例协调面（多 backend 实例并发兜底幂等收敛为 stopped）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：daemon 对「子代理实际还在跑」的极窄窗口（run 收口瞬间任务仍在收尾事件在途）会被提前收口为 stopped——但 run 已终态意味着该轮进程已结束，任务不可能再产出合法结果，收口语义正确；迟到终态事件仍可覆盖（乱序问）。
- 放弃方案「读端把终态 run 的 running 任务渲染为停止」：治标——脏数据永存、导出/其它消费方仍见 running；放弃「给 upsert 加会话级对账」：面大且治不了存量。
- 已知残留：message 覆盖旧值（Optional 字段 latest-wins 既有语义内，可接受）。
