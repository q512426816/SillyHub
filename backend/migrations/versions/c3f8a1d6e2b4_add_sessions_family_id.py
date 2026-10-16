"""sessions 加 family_id 列（2026-10-16-fix-auth-random-logout task-01 / D-001@v1）。

背景：refresh token 复用检测（旧 token 超 grace 窗再提交）现行处置是吊销该用户
**全部**会话（service._consume_refresh_token 重放分支），多标签页/休眠恢复的
正常竞态即全设备团灭。本迁移给 ``sessions`` 加 ``family_id``（UUID，可空）建模
"会话族"——同一次登录衍生的全部 session 共享一个族值；后续变更把复用检测改
为只吊销命中族（D-002@v1）。

- 仅加 nullable 列：存量行 family_id=NULL，运行时按"自成一族"处理（读取侧
  ``family_id or id`` 兜底），零回填、零强制登出。
- 不加索引：族吊销 UPDATE 谓词 ``user_id=? AND revoked_at IS NULL AND
  (family_id=? OR (family_id IS NULL AND id=?))`` 走既有 ``ix_sessions_user_revoked``
  （每用户 session 行数少，user_id 前导过滤后残余行数个位数）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a1d6e2b4"
down_revision: str | Sequence[str] | None = "20261016100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("family_id", sa.Uuid(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "family_id")
