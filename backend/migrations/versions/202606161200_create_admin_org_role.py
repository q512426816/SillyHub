"""create admin org/role tables + extend roles/users

Revision ID: 202606161200
Revises: 202606300900
Create Date: 2026-06-16 12:00:00

Implements change ``2026-06-16-admin-org-role-center`` task-01. Mirrors
the SQL DDL blueprint in design.md §8.1 / §8.2.

Creates:
- organizations (self-ref tree)
- user_organizations (M:N users <-> organizations)
- user_roles (M:N users <-> roles, platform-level)

Extends:
- roles: + is_active BOOLEAN, + updated_at TIMESTAMPTZ
- users: + login_enabled BOOLEAN
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606161200"
down_revision = "202606300900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # === Step 1: roles 表扩展（is_active + updated_at + 索引）===
    op.add_column(
        "roles",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "roles",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_roles_is_active", "roles", ["is_active"])

    # === Step 2: users 表扩展（login_enabled）===
    op.add_column(
        "users",
        sa.Column(
            "login_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    # === Step 3: organizations 表（自引用树 + code 唯一 + status CHECK）===
    op.create_table(
        "organizations",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "parent_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey(
                "organizations.id", ondelete="RESTRICT", name="fk_organizations_parent_id"
            ),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('active', 'disabled')",
            name="ck_organizations_status",
        ),
    )
    op.create_index("ix_organizations_parent_id", "organizations", ["parent_id"])
    op.create_index("ix_organizations_status", "organizations", ["status"])

    # === Step 4: user_organizations 表（复合 PK）===
    op.create_table(
        "user_organizations",
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_user_organizations_org",
        "user_organizations",
        ["organization_id"],
    )

    # === Step 5: user_roles 表（平台级，与 user_workspace_roles 区分）===
    op.create_table(
        "user_roles",
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "role_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("roles.id", ondelete="RESTRICT"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_user_roles_role", "user_roles", ["role_id"])


def downgrade() -> None:
    # LIFO 严格逆序
    # Step 5 逆
    op.drop_index("ix_user_roles_role", table_name="user_roles")
    op.drop_table("user_roles")

    # Step 4 逆
    op.drop_index("ix_user_organizations_org", table_name="user_organizations")
    op.drop_table("user_organizations")

    # Step 3 逆
    op.drop_index("ix_organizations_status", table_name="organizations")
    op.drop_index("ix_organizations_parent_id", table_name="organizations")
    op.drop_table("organizations")

    # Step 2 逆
    op.drop_column("users", "login_enabled")

    # Step 1 逆
    op.drop_index("ix_roles_is_active", table_name="roles")
    op.drop_column("roles", "updated_at")
    op.drop_column("roles", "is_active")
