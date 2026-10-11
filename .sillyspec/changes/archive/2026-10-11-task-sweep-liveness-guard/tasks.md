---
author: flow-machine-draft
created_at: 2026-10-11T03:36:49.940Z
---
# 任务注册表（Tasks）— 2026-10-11-task-sweep-liveness-guard

- [x] task-01: 清扫（run 收口 + 启动兜底）只收「最近无心跳」的任务：updated_at 距清扫时刻超过宽限窗（5 分钟）且 is_async=false 才收口；活跃心跳中的任务（含跨轮次后台任务）不被误收（finalize/sweep 双函数条件收紧；用例 test_finalize_sweeps_only_stale_sync + test_sweep_orphans_stale_terminal_run_only）
- [x] task-02: 被清扫行保留可识别标记（message=RUN_CLOSE_SWEEP_REASON），后续到达的 running 心跳在「清扫收口行」上复活（status 回 running、finished_at 清空、标记清除），真实在跑的任务下一个心跳即自愈；真实终态行维持终态吸收不复活（用例 test_sweep_stopped_row_revives_on_running_heartbeat + test_genuine_stopped_absorbs_running_heartbeat）
- [x] task-03: run 收口时恒排延迟复扫（_delayed_task_resweep：宽限+60s 后重跑 finalize，独立 DB session，异常仅日志），不靠后端重启兜底孤儿（复扫语义用例 test_delayed_resweep_catches_now_silent；sleep 包装为薄管道不单测）
- [x] task-04: 新单测覆盖：心跳豁免/is_async 豁免/迟到心跳复活/真实终态不复活/延迟复扫；既有 agent_session_tasks 全绿（文件 23/23 + close 回归 12/12 + ruff/format/mypy 零错）
