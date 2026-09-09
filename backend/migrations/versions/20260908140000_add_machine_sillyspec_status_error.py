"""daemon_instances 加 sillyspec_status_error JSON 列（总览采集失败状态）

Revision ID: 20260908140000
Revises: 20260907231000
Create Date: 2026-09-08 14:00:00

2026-09-08（temp 投毒排障衍生，changes-overview-card 后续强化）：
为 daemon_instances 新增 1 列——

* ``sillyspec_status_error`` JSON NULL：daemon 周期采集 ``progress show --json``
  三态③（超时/非零退出/spawn 失败）持续发生时的错误快照
  （{reason, detail, since}；since=daemon 侧首次失败时刻，恢复即清）。

落库语义同 ``sillyspec_status``（None=清除置 NULL，非 None 整包直写，
register 恒清——见 app/modules/daemon/model.py 权威注释）。用途：前端区分
「总览不可用（数据源查询失败）」与「总览不可用（sillyspec 未安装/版本过低）」
——后者=本列 NULL 且 sillyspec_status 亦 NULL（三态②能力缺失）。

down_revision 接执行时唯一 head 20260907231000（alembic heads 实测单 head）。
downgrade 对称删列。结构照 20260903090000_add_machine_sillyspec_status.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260908140000"
down_revision = "20260907231000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_status_error", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "sillyspec_status_error")
