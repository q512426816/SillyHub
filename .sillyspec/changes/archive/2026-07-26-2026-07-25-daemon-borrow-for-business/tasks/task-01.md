---
id: task-01
title: workspace_member_runtimes 加 shared 列 + 部分索引 + 迁移
title_zh: 给工作空间成员绑定表加 daemon 共享标记列
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-01]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/model.py
  - backend/migrations/versions/202607251100_daemon_borrow_shared.py
provides:
  - contract: WorkspaceMemberRuntime
    fields: [shared]
goal: >
  给 workspace_member_runtimes 加 shared 布尔列，让 lender 能把自己的 daemon 标记为工作空间共享。
implementation:
  - model.py 加 shared: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default=sa.text("false")))
  - 加部分索引 ix_wmr_shared（WHERE shared=TRUE）优化借用查询
  - 新 alembic 迁移 add_column shared + create_index，down 反向 drop
  - down_revision 用 alembic heads 实测当前 head（避免多 head 分叉，见 migration-chain-fragmentation-pattern）
acceptance:
  - shared 列存在，默认 false，nullable false
  - 现有 binding 行迁移后 shared 默认 false，行为不变（零回归）
  - 迁移 upgrade/downgrade 可逆
verify:
  - cd backend && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/workspace -q --no-cov
constraints:
  - server_default false 保证旧行零回归
  - 部分索引仅 shared=TRUE，避免全表索引开销
  - 不改既有列语义（collaborative-workspace 兼容）
---
