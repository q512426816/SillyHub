---
id: task-03
title: DaemonInstance.started_at column + Alembic migration
title_zh: DaemonInstance 加 started_at 列 + Alembic 迁移
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/<rev>_daemon_started_at.py
provides:
  - contract: DaemonInstance
    fields: [started_at]
expects_from: []
goal: >
  DaemonInstance 加 started_at nullable datetime 列存 daemon 进程启动时间，
  并新建 Alembic migration 建列可回退（upgrade add_column NULL / downgrade drop_column）。
implementation:
  - model.py DaemonInstance 加 started_at 字段（datetime | None，nullable，仿 last_heartbeat_at:92-95 写法，含 Field/default None/DateTime(timezone=True)）
  - 新建 migration 文件（revision 新 id，down_revision 接当前 alembic head），upgrade 用 op.add_column('daemon_instances', sa.Column('started_at', sa.DateTime(timezone=True), nullable=True))
  - downgrade 用 op.drop_column('daemon_instances', 'started_at')（仿 202607041800_daemon_instance_build_id.py 风格）
acceptance:
  - DaemonInstance 含 started_at nullable datetime 字段（datetime | None）
  - migration upgrade head 后 daemon_instances 表有 started_at 列
  - migration downgrade -1 后 started_at 列被删除
  - model 与 migration 不影响其他字段（id/hostname/version/build_id/last_heartbeat_at 等不变）
verify:
  - cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head（验证可逆）
  - cd backend && pytest app/modules/daemon -k "model or instance"（若有相关测试）
constraints:
  - nullable 列（旧 daemon 不上报 started_at 则 NULL）
  - Postgres 加 nullable 列不锁表
  - downgrade 必须 drop_column
  - migration 文件名格式 <revision>_daemon_started_at.py
  - 不改 daemon_runtimes 表（D-002@v1 instance 级，runtime 不加）
  - alembic.ini 在 backend/ 根、env.py 在 backend/migrations/（design §5.B.2 已确认路径）
---
