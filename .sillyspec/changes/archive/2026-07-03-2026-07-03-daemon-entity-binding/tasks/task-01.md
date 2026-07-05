---
id: task-01
title: 新建 daemon_instances 表 + DaemonInstance model + alembic 迁移
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-05, task-06, task-13]
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/
---
## goal
> 建立 daemon_instances 实体表，承载守护进程稳定身份（本地 uuid 上报）+ 机器级字段（design §4.1 / D-001）。
## implementation
- 在 `backend/app/modules/daemon/model.py` 新增 `DaemonInstance` SQLModel：id(Uuid PK = daemon 上报的 daemon_local_id)、user_id(FK→users CASCADE)、hostname(String255)、display_alias(String200 nullable)、server_url(String255)、os/arch/version(String50 nullable)、allowed_roots(JSON)、capabilities(JSON nullable)、status(String20 default 'online')、last_heartbeat_at(DateTime nullable)、created_at/updated_at。
- 附加索引 `ix_daemon_instances_user_server` on (user_id, server_url, hostname) 便于查询（design §4.1 唯一性附加）。
- 新建 alembic migration：revision 唯一、down_revision 接真实当前 head（防多 head），建 daemon_instances 表 + 各列 + 索引；downgrade drop table。
## acceptance
- daemon_instances 表存在，列/类型/默认值与 design §4.1 表完全一致。
- id 主键 = daemon 上报的 daemon_local_id（无独立自增 id）。
- (user_id, server_url, hostname) 索引存在；user_id FK CASCADE。
- `cd backend && uv run alembic upgrade head` 成功，`alembic downgrade -1` 可逆。
## verify
- cd backend && uv run pytest app/modules/daemon/tests
- cd backend && uv run alembic upgrade head
## constraints
- 仅建表 + model，不写 register/heartbeat 业务逻辑（属 task-05）。
- 不写历史 daemon_local_id（D-007 重置）：现有 daemon_runtimes 行无对应数据，daemon_instances 初始为空。
- allowed_roots/capabilities 列定义与从 runtime 提升的字段类型一致（task-02 配套移除）。
- covers D-001、D-002。
