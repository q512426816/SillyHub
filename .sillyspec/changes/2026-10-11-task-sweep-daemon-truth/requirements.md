---
author: flow-machine-draft
created_at: 2026-10-11T03:58:30.390Z
---
# 需求规格（Requirements）— 2026-10-11-task-sweep-daemon-truth

## 功能需求

### FR-01: daemon session_live_tasks RPC 返回会话活跃任务快照

- daemon 必须注册 `session_live_tasks` RPC（backend→daemon 既有 rpc_id 通道，list_dir 平名先例）：入参 `{session_id}`，返回 `{session_id, live_task_ids}`——数据源为后台任务注册表 `mgr._backgroundTasks`（task_started 注册 / task_notification 注销 / 会话终态清空）的只读快照；未注册会话返回空数组且不得产生写副作用；session_id 缺失或 session manager 未就绪必须 throw（backend 侧跳过该批）。

#### 场景：问询

- Given daemon 上会话 S 有任务 t-1（注册中）、t-2（已注销）
- When backend 调 session_live_tasks(S)
- Then 返回 live_task_ids=["t-1"]；对未注册会话返回 [] 且不建条目

### FR-02: 后端清扫改为确认制（daemon 真相源，废除全部时间启发式）

- `sweep_confirmed_dead_tasks`（替代 v1 run 终态即收 / v2 5 分钟宽限）必须：会话终态（ended/failed）或无绑定 runtime 的候选行直接收口（daemon「会话终态=SDK 进程 kill、任务随进程消亡」的权威语义背书）；其余候选按 runtime 分组调 session_live_tasks RPC，候选 task_id 不在活跃集内才收口；daemon 离线/超时/旧版 method_not_found 必须跳过该批（fail-open 保活，下轮触发点再问）；TASK_SWEEP_GRACE 与 is_async/updated_at 时间启发式必须全部移除出死判。

#### 场景：确认死才收

- Given 活跃会话两个 running 任务行，daemon 活跃集只含 t-alive
- When 清扫执行
- Then t-dead 收口 stopped（带标记），t-alive 保持 running（哪怕它静默数小时）

#### 场景：daemon 离线

- Given daemon 掉线（send_rpc 抛离线/超时）
- When 清扫执行
- Then 该批候选全部保留 running（不误收）

### FR-03: run 收口延迟确认清扫 + 启动确认清扫

- run 收口瞬间不得判任务死活（后台任务跨轮存活）；该 run 存在非终态候选时必须 fire 60s 后的延迟确认清扫（run_id 限定，独立 DB session，问 daemon）；后端启动清理必须改调确认清扫（全量）；触发时机不得引入时间死判。

#### 场景：run 收口后孤儿收敛

- Given run 收口时有后台任务在跑（终态事件后因 daemon 注册表丢失/无 runId 被跳过而丢失）
- When 60s 后延迟确认清扫执行
- Then daemon 注册表已注销（或会话已终态）→ 收口；仍在注册表 → 保留

### FR-04: 标记与复活保留 + 回归

- 清扫行必须继续写 RUN_CLOSE_SWEEP_REASON 标记；upsert 复活分支（标记行收 running 心跳复活）与真实终态吸收行为保持；既有 agent_session_tasks 测试语义迁移后全绿，close 链路回归通过，daemon typecheck/测试/bundle 通过。

#### 场景：回归

- Given 本变更合入
- When 运行后端任务测试 + close 回归 + daemon typecheck/测试
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts「注册表内的 task_id 全量返回」
FR-02: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_daemon_confirmed_dead_only」
FR-03: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_run_scoped_filter」
FR-04: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_stopped_row_revives_on_running_heartbeat」
