---
author: flow-machine-draft
created_at: 2026-10-11T03:58:30.390Z
---
# 任务注册表（Tasks）— 2026-10-11-task-sweep-daemon-truth

- [x] task-01: daemon session_live_tasks RPC 返回该会话注册表活跃 task_id 列表（未注册会话=空表、只读无副作用、缺参/未就绪 throw）——sessionLiveTaskIds helper + daemon.ts 平名注册；用例「注册表内的 task_id 全量返回」等 3 条（daemon 侧 16/16 绿含既有回归）
- [x] task-02: 后端清扫确认制：会话终态/无 runtime 直接收口；活跃会话经 daemon 确认不在活跃集才收口；daemon 离线跳过不误收——sweep_confirmed_dead_tasks 重写；用例 test_sweep_daemon_confirmed_dead_only / test_sweep_daemon_offline_skips / test_sweep_terminal_session_direct_no_rpc
- [x] task-03: 活着但长时间静默的任务（daemon 注册表在）永不被收口——TASK_SWEEP_GRACE/is_async/updated_at 全部移出死判（「确认在活跃集→保留」断言即静默存活语义）；run 收口改 60s 后 run 限定确认清扫（test_sweep_run_scoped_filter）+ 启动清理改确认制
- [x] task-04: 清扫行标记与复活分支保留（test_sweep_stopped_row_revives_on_running_heartbeat）+ 真实终态吸收不回归（test_genuine_stopped_absorbs_running_heartbeat）；后端 24/24 + close 回归 12/12 + ruff/mypy 零错 + daemon typecheck/测试过 + bundle 重建
