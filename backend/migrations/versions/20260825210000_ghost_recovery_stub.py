"""ghost recovery stub（2026-08-25 部署事故修复）。

背景：并行会话曾以工作树态（未提交）部署过 revision=20260825210000 的迁移，
数据库 alembic_version 已升至该版本、其 DDL 已生效；随后源文件被删除且从未
进入 git 历史——DB 版本指向"幽灵修订"，任何不含本文件的构建启动即
``Can't locate revision``（本机部署 backend 健康检查不过的根因）。

处置：本文件为**空壳恢复桩**——revision 对齐 DB 现值使链条可解析；
upgrade/downgrade 均为 no-op（真实 DDL 已在库中，无法从历史重建；downgrade
语义不完整是已知取舍，记录于案）。若原作者后续找回真实迁移文件，以真实
内容替换本桩即可（同 revision 直接覆盖）。

Revision ID: 20260825210000
Revises: 20260825160000
"""

revision: str = "20260825210000"
down_revision: str | None = "20260825160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # no-op：DDL 已随幽灵迁移在库中生效。
    pass


def downgrade() -> None:
    # no-op：无法从历史重建原 DDL 的逆操作（见文件头说明）。
    pass
