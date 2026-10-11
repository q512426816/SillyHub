---
author: flow-machine-draft
created_at: 2026-10-11T03:36:49.940Z
---
# 设计记录（Design Record）— 2026-10-11-task-sweep-liveness-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户指正上一变更（2026-10-10-run-close-task-sweep）的核心假设错误：「run 终态 = 任务必死」不成立——后台子代理任务本来就跨轮次存活（主代理开轮派发后轮结束、任务继续跑、跑完发 [后台任务通知] 唤醒新轮继续回复），且线上 agent_session_task.is_async 恒为 false（daemon 上报未打标），按标记排除保护不了它们；run 关闭即清扫会把真实在跑的后台任务错标「已停止」，而迟到 running 心跳又被终态吸收冻结在错误状态（该清扫代码已被并行会话部署上线，一次扫了 112 条，当时恰好零异步任务零实际误伤，语义缺口真实存在）。修法三件：①死判改「最近无心跳」——两个清扫函数条件收紧为 is_async=false 且 updated_at 距清扫时刻超 TASK_SWEEP_GRACE（5 分钟，心跳活跃即豁免）；②清扫行带 RUN_CLOSE_SWEEP_REASON 标记 + upsert 复活分支（标记行收 running 心跳即复活，自愈误收；真实终态行维持吸收）；③close 恒排延迟复扫（宽限+60s 后重跑 finalize，新鲜后沉默的孤儿不靠后端重启收敛）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `finalize_running_tasks_for_run` / `sweep_orphan_running_tasks`（agent_task_store）：收口条件收紧（新增 is_async 与 updated_at 宽限过滤）；sweep 新增可选 `now` 参数（测试确定性）。
- `upsert_agent_task`（agent_task_store）：语义②新增清扫标记行复活例外（仅 message=RUN_CLOSE_SWEEP_REASON 的 stopped 行放行 running）。
- 新增导出常量 `RUN_CLOSE_SWEEP_REASON` / `TASK_SWEEP_GRACE`（原模块私有 _RUN_CLOSED_REASON 转公开，复活识别需要）。
- `close_run_steps` 新增模块级 `_delayed_task_resweep`（内部后台任务，不导出）；close_interactive_run 恒排复扫。
- HTTP API / 表结构零改动。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/daemon/agent_task_store.py | 清扫条件收紧 + 常量公开 + upsert 复活分支 |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | _delayed_task_resweep + close 恒排复扫 |
| 修改 | backend/app/modules/daemon/tests/test_agent_session_tasks.py | TestRunCloseTaskSweep 重写为 5 用例（新语义） |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。复活分支只认「running 事件 + 清扫标记行」——误收任务下一心跳即自愈；真实终态事件（completed/failed）对清扫行照常 latest-wins 覆盖（语义③），终态信息不失真。迟到 running 对真实终态行维持吸收（零回归，测试钉死）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

安全。upsert 持任务行 FOR UPDATE（上一变更 P3-1 修复），与清扫 UPDATE 行级锁串行化：清扫先落则 upsert 读到 stopped+标记走复活；upsert 先落 running 则清扫按其 updated_at 重新判窗。延迟复扫与立即清扫/启动兜底并发时均为幂等 UPDATE（条件同款，重复收敛 stopped）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。延迟复扫为独立 DB session 的后台任务（对齐 dispatch_next_queued_message 的 H1 模式），异常交 _fire_background_task done_callback 记日志，不影响已提交终态；进程重启丢失复扫任务时由启动兜底清扫补位（条件同款）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。复扫按 run_id 限定、清扫条件不跨会话；多 backend 实例并发复扫幂等收敛（UPDATE 条件原子）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：宽限窗 5 分钟是启发式——「真死但 5 分钟内曾心跳」的任务在收口时点不被收、依赖延迟复扫；「活着但超 5 分钟无心跳」（长静默后台任务）仍会被误收——由复活分支兜底（下一心跳自愈），最坏窗口=下一心跳间隔。心跳间隔取决于 daemon 上报节奏（工具调用/进度行），长纯计算任务可能稀疏——已知残留，如实接受。
- 放弃方案「按 is_async 排除」：线上标记恒 false，保护不了实际跨轮任务（已验证 0 条异步行）；放弃「run 收口不清扫、只靠启动兜底」：回到原始 bug（不重启永卡 running）。
- 前一变更被本次修正的裁决：其「run 终态后任务不可能仍合法运行」表述作废，收口面由本变更收窄。
