---
id: task-02
title: daemon_runtimes 退化为从属清单（加 daemon_instance_id + 移除机器级字段 + 移除 display_alias）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: [task-01]
blocks: [task-05, task-08]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/
---
## goal
> daemon_runtimes 加 daemon_instance_id（FK CASCADE 非空）+ 索引，移除提升到 daemon_instances 的机器级字段与 display_alias（design §4.2 / D-002 / X-004）。
## implementation
- `DaemonRuntime` model 新增 `daemon_instance_id`：Uuid FK→daemon_instances，ondelete=CASCADE，nullable=False。
- 新增索引 `idx_daemon_runtimes_instance` on daemon_instance_id。
- 移除列：os、arch、allowed_roots、capabilities（已提升到 daemon_instances）；移除 display_alias（X-004：与 daemon_instance.display_alias 语义碰撞，YAGNI 移除）。
- 保留：id、user_id、name、provider、status、version（provider 级二进制版本，不挪）、last_heartbeat_at。
- alembic migration：add_column daemon_instance_id（先 nullable 过渡）、回填为空因 D-007 重置（直接留空→改 NOT NULL 需谨慎，本项目允许重置）、create_index、drop_column os/arch/allowed_roots/capabilities/display_alias；downgrade 逆向恢复列 + drop 索引。
## acceptance
- DaemonRuntime.daemon_instance_id 非空 FK CASCADE；idx_daemon_runtimes_instance 存在。
- os/arch/allowed_roots/capabilities/display_alias 列已从 model 与表中移除。
- version/provider/status/last_heartbeat_at/user_id/name/id 保留。
- `cd backend && uv run alembic upgrade head` 成功且可逆（downgrade 恢复列）。
## verify
- cd backend && uv run pytest app/modules/daemon/tests
- cd backend && uv run alembic upgrade head
## constraints
- brownfield 兼容（D-007 重置）：旧 daemon_runtimes 行无 daemon_instance_id 线索，迁移期该列允许过渡 nullable 或在 cleanup 脚本中清空旧数据（task-13）再 NOT NULL；本项目未上线允许重置。
- 引用被移除列的既有代码（如 register_runtime / schema）由 task-05 配套改造，本 task 只动 model + migration。
- 不动 daemon_task_leases / daemon_change_writes 的 runtime_id FK（D-003）。
- covers D-002。
