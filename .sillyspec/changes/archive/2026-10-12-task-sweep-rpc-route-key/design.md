---
author: flow-machine-draft
created_at: 2026-10-12T00:20:58.110Z
---
# 设计记录（Design Record）— 2026-10-12-task-sweep-rpc-route-key

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

确认制清扫的候选按 `AgentSession.runtime_id`（=`daemon_runtimes.id`）分组，而 `DaemonWsHub` 连接表按 `daemon_instance_id` 注册（`gateway_misc.py` 握手 `daemon_local_id`、`ws_hub.py:106`）——runtime 主键是注册时随机 uuid4，与 instance id 永不相等，`is_connected(runtime_id)` 恒 False，确认 RPC 全部被当「离线」跳过。修法：分组后逐 runtime 经既有帮手 `_resolve_daemon_id_for_runtime`（`session/service/helpers.py:133`：`session.get(DaemonRuntime)` 查归属 instance；NULL 回落 runtime_id；行缺失返 None）解析路由键再发 RPC；行缺失时该 runtime 候选整体跳过（fail-open，与离线同语义）。帮手在函数内延迟 import（对齐本模块 `AgentSession` 同款，避免 `session.service` 包级循环依赖）。测试未拦截的根因一并说明：共享夹具 `_create_runtime` 不设 `daemon_instance_id`（恰好走 legacy 回退=错误键）且 `_StubHub` 按错误键收调用——新增用例显式建 instance 并断言映射键。

启动清扫（`cleanup_stale_runs` 内联 await，lifespan 时点执行）在此刻 hub 连接表必空（uvicorn 未开始 accept，单进程 CMD 无 --workers），确认分支恒落空。改为延迟后台任务：对齐 `_recheck_stale_runs_loop` 既有模式——`asyncio.create_task` + `AgentService._background_tasks` 强引用 + `_on_background_task_done` 回收；协程内 `asyncio.sleep(_STARTUP_TASK_SWEEP_DELAY_SECONDS)`（默认 60s，给 daemon WS 重连留窗口）后自开 `get_session_factory()` 独立 session 执行 sweep；全程 try/except 记日志，异常不阻断启动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sweep_confirmed_dead_tasks(session, *, hub, run_id=None, rpc_timeout=5.0)` 签名不变；行为变化仅一处——`send_rpc` 第一参由 runtime_id 改为解析后的 daemon 路由键（对外语义：修复；此前现网恒伪离线，无消费方依赖旧错误行为）。
- `app/modules/agent/service.py` 新增模块级常量 `_STARTUP_TASK_SWEEP_DELAY_SECONDS = 60.0` 与模块级协程 `_startup_orphan_task_sweep()`（私有，不进对外 API）；`cleanup_stale_runs` 内联清扫块替换为创建后台任务。main.py lifespan 调用点零改动（仍调 `cleanup_stale_runs`）。
- 无 schema/端点/迁移变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   RPC 结果晚到不影响——收口按候选 SELECT 快照 + UPDATE 非终态守卫（评审 F1 既有守卫覆盖唯一 UPDATE 点），迟到终态事件先提交则 UPDATE 排除、后提交则复活分支自愈；映射只改路由键，不改变候选判定与收口语义。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   映射查询为只读 `session.get`；两个触发点（run 收口 60s 复扫 / 启动延迟任务）并发执行同一候选时，UPDATE 幂等（终态守卫 + rowcount 归一），重复收口无害；runtime 在 SELECT 与 RPC 之间重绑定 instance 以快照键为准，最坏一次伪离线跳过，下轮触发点自愈。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   启动任务持独立 session（factory 新开），不与 lifespan bootstrap session 交叉（原内联版的 aborted-session 连坐风险随之消失）；进程在延迟窗内退出，任务随事件循环取消，孤儿行留待下次启动——fail-open 不丢数据。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   映射按 runtime 行查归属 instance，不跨 daemon 串台；hub 连接表按 daemon 天然隔离，`session_live_tasks` params 携 session_id 由 daemon 侧会话表二次定位，无双写面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：现网若存在 `daemon_instance_id=NULL` 的 legacy runtime 行，其路由键回落 runtime_id——若 hub 恰也无该键连接，行为与修复前相同（伪离线跳过），不劣化于现状；D-007 迁移已完成（register 必绑定），存量 NULL 行按设计不可达。
- 放弃方案 A：在 `hub.send_rpc` 内做 runtime→instance 兼容映射——否，hub 是纯内存路由层，引入 DB 依赖破坏职责边界且掩盖调用方缺映射的事实；映射归调用方（`daemon_rpc.py:79` 先例）。
- 放弃方案 B：启动清扫挂 daemon 首次连接事件触发——需 hub 新增回调钩子，改动面大且首连早于多 runtime 就绪；固定 60s 延迟达成同等效果、零新耦合，常数可调。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/modules/daemon/agent_task_store.py | sweep 逐 runtime 经 helper 解析 daemon 路由键；行缺失跳过 |
| 改 | backend/app/modules/agent/service.py | 启动清扫改延迟后台任务（独立 session+强引用+done 回收） |
| 改 | backend/app/modules/daemon/tests/test_agent_session_tasks.py | 新增路由键断言 + 启动延迟任务两用例；既有用例不动 |
