---
author: flow-machine-draft
created_at: 2026-10-10T15:47:26.914Z
---
# 需求规格（Requirements）— 2026-10-10-run-close-task-sweep

## 功能需求

### FR-01: close_interactive_run 同事务收口该 run 的非终态任务行

- run 终态收口时必须在**同一事务**内把该 run 的 `agent_session_task` 非终态行（status ∉ {completed, failed, stopped}）批量收口为 `stopped`，附可读 message（「轮次已结束，任务未上报终态」），`finished_at`/`updated_at` 同步置位；已终态行必须不被触碰；清扫后迟到的 running 心跳必须被 upsert 终态吸收挡下（不复活）。

#### 场景：子代理未上报终态（线上 47e2ff1a 实证）

- Given 一个 run 执行中派出子代理任务（running 行），run 收口 completed 而子代理未上报终态
- When close_interactive_run 落终态
- Then 该任务行同事务变 stopped（含 message 与 finished_at），任务列表不再显示「进行中」

### FR-02: 启动兜底清扫（自愈存量脏数据）

- 后端启动清理（cleanup_stale_runs）必须追加兜底：`agent_session_task` 中 status 非终态且其 run 已终态（TERMINAL_TURN_STATUSES）的行全量收口 stopped；running run 的任务行必须不被误扫；清扫失败必须仅记日志不阻塞启动。

#### 场景：部署重启自愈存量

- Given 存量脏数据（如 47e2ff1a 的 17 条卡 running，run 已 completed）
- When 后端部署重启执行启动清理
- Then 这 17 条自动变 stopped（message 注明原因），无需手工 SQL

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_finalize_sweeps_running_to_stopped_terminal_untouched」
FR-02: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_orphans_terminal_run_only」
