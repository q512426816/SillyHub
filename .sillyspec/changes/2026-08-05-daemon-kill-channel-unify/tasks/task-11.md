---
id: task-11
title: terminating_at 写/清 + sweeper（覆盖 FR-04, D-007, XC-03/04/08）
title_zh: terminating_at 写清与超时巡检
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: [task-10, task-02, task-05]
blocks: [task-12]
requirement_ids: [FR-04]
decision_ids: [D-007]
allowed_paths:
  - backend/app/modules/daemon/lease_service.py
  # task-14 RS-5 注（CONTRACT_SCOPE_GAP，调度批准扩 scope，同 Wave2 RS-3/RS-4 类）：
  # 原 allowed_paths 仅列 lease_service.py，但 acceptance #2「daemon 回传清
  # terminating_at」的两个清空点在另两类 service——complete_lease 清空点在
  # backend/app/modules/daemon/lease/service.py:307，notifySessionEnd/end_session
  # 收敛清空点在 backend/app/modules/daemon/session/service.py:934。调度独立读
  # lease/__init__.py 核实分治架构（LeaseService 正向生命周期 complete_lease /
  # DaemonLeaseService cancel 分治）后扩入闭合 acceptance #2。非 bug、worktree
  # 未提交、幂等 None-set、低风险（详见 execute-runs review.json task-11 RS-5）。
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/session/service.py
expects_from:
  task-10:
    - contract: DaemonTaskLease.terminating_at
      needs: [terminating_at]
goal: >
  cancel_lease 写 terminating_at，daemon 回传 complete 或 session_end 时清，新增独立 sweeper 对超 30s 未回传告警（落地执行端确认可见性，D-007）。
implementation:
  - cancel_lease 写 terminating_at（仅 cancel，end_session 同事务 completed 不写 XC-03）
  - complete_lease 和 notifySessionEnd 收到回传时清 terminating_at
  - 新增 sweeper 独立查 terminating_at IS NOT NULL（不并入 expire_overdue_leases XC-08），超 30s 告警加标记
  - sweeper 不改 lease.status 不重试（D-007）
acceptance:
  - cancel_lease 写 terminating_at，end_session 不写
  - daemon 回传清 terminating_at
  - sweeper 独立查询超时告警且不改 lease.status
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon
constraints:
  - 仅 cancel 写 terminating_at（XC-03 end_session 同事务 completed 无观测窗口）
  - sweeper 独立查询不并入 expire GC（XC-08 后者只扫 claimed）
  - 不改 lease.status 状态机取值（D-007）
  - cancel_lease 已同步 session 等于 ended 故 session 维度不另设字段（XC-04）
---
