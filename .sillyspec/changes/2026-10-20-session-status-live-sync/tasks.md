---
author: flow-machine-draft
created_at: 2026-10-20T07:02:11.490Z
---
# 任务注册表（Tasks）— 2026-10-20-session-status-live-sync

- [x] task-01: close_run_steps `_close_flip_session` active 分支置 sessions_changed_intent（含注释更新），扩展 test_close_interactive_run_session_status.py 多轮 keep-active 用例断言发布；跑该文件全绿验证单轮终态既有发布零回归
- [x] task-02: inject.py `_inject_into_session` commit 后补发 status_changed（非纯切换轮），新增 test_session_list_live_signal.py 覆盖发布与纯切换轮守卫；跑绿
- [x] task-03: PublishIntent 加 list_signal 标量，submit_commit 激活块置位、publish_submitted_messages 消费补发，扩展 test_tool_report_activation.py 覆盖发/rowcount=0 不发；跑绿
- [ ] task-04: coordinator request_approval/approve commit 后补发，新增 test_coordinator_approval_signal.py 覆盖成功发/拒绝路径不发；跑绿
- [ ] task-05: session-panel-page.tsx onPermissionRequest 加 onSessionListRefresh 兜底，新增 session-panel-approval-list-refresh.test.tsx；跑绿
- [ ] task-06: 全量回归：backend pytest（agent/daemon 触及面 + 信号相关既有用例）+ frontend vitest 触及面 + lint，结果记入本变更
