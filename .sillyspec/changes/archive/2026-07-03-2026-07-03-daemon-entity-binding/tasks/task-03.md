---
id: task-03
title: workspace_member_runtimes 加 daemon_id 列（FK RESTRICT nullable + 索引）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-01]
blocks: [task-08, task-09]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/model.py
  - backend/migrations/versions/
---
## goal
> per-member 绑定表加 daemon_id 列承载新绑定对象，runtime_id 保留改 nullable 不再写（design §4.3 / D-004）。
## implementation
- `WorkspaceMemberRuntime` model 新增 `daemon_id`：Uuid FK→daemon_instances，ondelete=RESTRICT，nullable=True（便于过渡）。
- 新增索引 `ix_wmr_daemon` on daemon_id（与现有 ix_wmr_runtime 并存）。
- runtime_id 列保留但改 nullable=True，PUT /my-binding 不再写入（D-004 旧数据快照，本 task 仅改列属性，写入逻辑属 task-09）。
- alembic migration：add_column daemon_id（nullable）、create_index ix_wmr_daemon、alter_column runtime_id nullable=True；downgrade 逆向。
## acceptance
- daemon_id 列存在：FK daemon_instances ondelete=RESTRICT、nullable=True。
- ix_wmr_daemon 索引存在，ix_wmr_runtime 仍在。
- runtime_id 改为 nullable（旧值保留不删）。
- `cd backend && uv run alembic upgrade head` 成功且可逆。
## verify
- cd backend && uv run pytest app/modules/workspace
- cd backend && uv run alembic upgrade head
## constraints
- brownfield（D-007 重置）：旧 binding 行 daemon_id 留空，dispatch 改读 daemon_id 后会报「未绑定守护进程，请重绑」（task-08 实现）；旧 runtime_id 值保留但不再读。
- ondelete=RESTRICT（非 CASCADE）：删除 daemon_instance 前需先解绑 member runtime，避免绑定悬空。
- 不动 daemon_task_leases / daemon_change_writes 的 runtime_id（D-003）。
- covers D-004。
