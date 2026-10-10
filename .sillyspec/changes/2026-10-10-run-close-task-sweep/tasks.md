---
author: flow-machine-draft
created_at: 2026-10-10T15:47:26.914Z
---
# 任务注册表（Tasks）— 2026-10-10-run-close-task-sweep

- [x] task-01: agent_task_store 新增 finalize_running_tasks_for_run（单 run 批量 running→stopped + message）——用例「test_finalize_sweeps_running_to_stopped_terminal_untouched」（已终态不触碰 + message/finished_at 断言）
- [x] task-02: close_interactive_run 终态 commit 前同事务接入清扫——close 回归 test_close_interactive_run_session_status / auto_recover_integration / e2e_model_usage 13/13 绿（接线行为由 task-01 函数级用例 + 回归覆盖）
- [x] task-03: sweep_orphan_running_tasks 启动兜底（run 终态扫 / running 不误扫）+ cleanup_stale_runs 接入——用例「test_sweep_orphans_terminal_run_only」
- [x] task-04: 迟到心跳不复活（upsert 终态吸收）——用例「test_finalize_after_sweep_running_heartbeat_no_revive」；全文件 21/21 绿 + ruff/format/mypy 零错
