---
id: task-02
title: cancel_lease 对 interactive 改发 SESSION_END（覆盖 FR-09, D-001@v2/XC-01）
title_zh: 取消交互式 lease 改发 SESSION_END
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P0
depends_on: [task-01]
blocks: [task-03, task-11]
requirement_ids: [FR-09]
decision_ids: [D-001@v2]
allowed_paths:
  - backend/app/modules/daemon/lease_service.py
goal: >
  cancel_lease 对 interactive lease 改发 SESSION_END（不再发 SESSION_INTERRUPT），让取消 run 也走 _terminateSession 硬杀链，修 cancel 路径僵尸盲区（XC-01）。
implementation:
  - lease_service.py 的 cancel_lease interactive 分支把 _send_interactive_cancel 发的 SESSION_INTERRUPT 改为 SESSION_END
  - SESSION_INTERRUPT 此后仅 interruptSession 按钮端点使用
  - 确认 daemon 侧 SESSION_END handler 已存在（daemon.ts 约 2592 行调 sessionManager.end）
acceptance:
  - cancel_lease 对 interactive lease 发 SESSION_END
  - interruptSession 按钮仍发 SESSION_INTERRUPT 不受影响
  - daemon 收 SESSION_END 走 _terminateSession 硬杀子进程
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
constraints:
  - 与 task-05 同改 lease_service.py 不同分支（execute 排程注意合并冲突）
  - 守 D-001@v2 仅 cancel 改 END，interrupt 按钮不动
  - 向后兼容 daemon SESSION_END handler 已存在
---
