---
author: flow-machine-draft
created_at: 2026-11-07T13:34:32.067Z
---
# 任务注册表（Tasks）— 2026-11-07-orphan-pending-dialog-cure

- [x] task-01: backend close_interactive_run 主路径收口事务内联动取消挂起提问（挂点 _close_flip_session 后 commit 前，late import 复用 cancel_pending_dialogs_for_run）+ 新增 test_run_close_cancels_pending_dialogs.py 覆盖「上报失败收口取消」「上报完成收口取消」「answered 行不被覆盖」三用例，跑该文件全绿
- [x] task-02: backend 三个主动 kill 写点（lease_service._mark_agent_run_killed_if_pending / session_lifecycle._end_session_for_delete / control.py end_session 收口）同事务补挂联动取消 + 测试补「cancel_lease kill 联动取消」用例，跑该测试文件全绿
- [x] task-03: 会话列表 pending_dialog_kind 注入 subquery 加 AgentRun 活性 join（过滤在窗口函数之前，口径对齐 list_pending_dialogs）+ test_sessions_list_pending_dialog.py 补「孤儿行不注入」「死活并存取活跃最新」两用例，跑该文件全绿
- [x] task-04: daemon PendingEntry 增 dialogKind + PermissionResolver.hasPendingDialogs() + fireTurnActivityWatchdog 双守卫后挂起 dialog 豁免续防分支 + turn-activity-watchdog.test.ts 补「豁免续防」「settle 后恢复判死」两用例，跑该文件全绿
- [x] task-05: 域内零回归验证：backend 跑 test_sessions_list_pending_dialog.py + 新增测试文件 + dialog/permission 域既有文件（test_session_permissions.py 等），daemon 跑 turn-activity-watchdog / turn-start-watchdog / permission-resolver 相关既有测试，全绿收口
