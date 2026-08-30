"""changes.location CHECK 扩值（active/archive/deleted）

生产事故修复（2026-08-30，crrcdt.ppdmq.top）：变更中心删除变更 500——
202605300900 建表迁移定义的 ``ck_changes_location`` 只允许 active/archive，
task-06 软删写 ``location='deleted'`` 在生产 PG 触发 CheckViolation。ORM 模型
从未声明该约束（模型↔迁移漂移），SQLite create_all 测试全绿掩盖了它。

本迁移把值集扩为三值，并与 change/model.py 的 CheckConstraint 声明对齐
（漂移修复：create_all 与 PG 行为一致，非法值两侧同拒）。

注：2026-08-30 服务器已用同定义 SQL 手工解锁（ALTER drop+add 同名三值）——
本迁移在其上重跑（drop+add 同义约束）为幂等无害操作。

Revision ID: 20260829230000
Revises: 20260829220000
Create Date: 2026-08-30
"""

from alembic import op

revision: str = "20260829230000"
down_revision: str | None = "20260829220000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_changes_location", "changes", type_="check")
    op.create_check_constraint(
        "ck_changes_location",
        "changes",
        "location IN ('active', 'archive', 'deleted')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_changes_location", "changes", type_="check")
    op.create_check_constraint(
        "ck_changes_location",
        "changes",
        "location IN ('active', 'archive')",
    )
