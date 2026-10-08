---
author: flow-machine-draft
created_at: 2026-10-08T03:57:52.316Z
---
# 任务注册表（Tasks）— 2026-10-08-backend-restart-fake-failed

- [x] task-01: `_cleanup_stale_runs_impl` 加 recent-log 活性检测（≤10 分钟宽限跳过判死）+ `cleanup_stale_runs` 延迟复扫后台任务；验证：test_stale_run_cleanup_liveness.py 三用例绿（近期跳过 / 停滞清理 / 无日志清理）
- [x] task-02: `close_interactive_run` 终态守卫放行「SERVICE_RESTART_INTERRUPTED + 迟到成功」例外，清误杀残留走正常收口；验证：test_close_interactive_run_retroactive.py 两用例绿（回正 / 其余终态仍 no-op）
- [x] task-03: 两测试文件补齐用例并与实现一起提交，跑相关测试全绿（含既有 lease/close 相关测试不回归）
