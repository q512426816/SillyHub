"""daemon_instances 加 sillyspec_status_map JSON 列（工作区级总览 map）

Revision ID: 20260908160000
Revises: 20260908140000
Create Date: 2026-09-08 16:00:00

2026-09-08（总览工作区级化）：为 daemon_instances 新增 1 列——

* ``sillyspec_status_map`` JSON NULL：daemon 按 wsId→主仓根映射逐目标采集的
  ``progress show --json`` 摘要 map（{wsId: 摘要}，仅成功项）。

落库语义：心跳该键为对象（含空对象）即整包直写（backend 不增删改写，落库形态
=上报形态）；键不出现=保留旧值（daemon 未启用工作区级采集，旧 daemon 兼容——
与 sillyspec_status 的 None=清除 刻意不同：map 无「清除」终态语义，register 恒清
收敛）。用途：工作台总览卡片按当前工作区取 map[wsId]，修「多工作区串台」。

down_revision 接执行时唯一 head 20260908140000。downgrade 对称删列。结构照
20260908140000_add_machine_sillyspec_status_error.py 先例。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260908160000"
down_revision = "20260908140000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "daemon_instances",
        sa.Column("sillyspec_status_map", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("daemon_instances", "sillyspec_status_map")
