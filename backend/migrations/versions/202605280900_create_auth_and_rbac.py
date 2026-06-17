"""create auth and rbac tables, seed system roles

Revision ID: 202605280900
Revises: 202605270900
Create Date: 2026-05-28 09:00:00.000000
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202605280900"
down_revision: str | None = "202605270900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ── Seed data ──────────────────────────────────────────────────────────────
#
# Mirrors references/16-rbac.md §3 (system roles) + §2 (permission strings).
# Permission strings are duplicated here on purpose: migrations must stay
# importable without pulling in app.* (e.g. when generating offline SQL).

SYSTEM_ROLES: list[dict[str, object]] = [
    {
        "key": "platform_admin",
        "name": "平台管理员",
        "description": "拥有全部工作区的全部权限。",
        "permissions": ["platform:admin"],
    },
    {
        "key": "workspace_owner",
        "name": "工作区所有者",
        "description": "对单个工作区拥有完整控制权。",
        "permissions": [
            "workspace:read",
            "workspace:write",
            "workspace:admin",
            "workspace:member:manage",
            "component:read",
            "component:write",
            "component:admin",
            "change:create",
            "change:read",
            "change:update",
            "change:approve",
            "change:archive",
            "task:create",
            "task:assign",
            "task:run_agent",
            "task:cancel",
            "task:approve",
            "code:read",
            "code:write",
            "code:review",
            "deploy:staging",
        ],
    },
    {
        "key": "component_lead",
        "name": "组件负责人",
        "description": "负责工作区内的一个或多个组件。",
        "permissions": [
            "workspace:read",
            "component:read",
            "component:write",
            "change:read",
            "task:assign",
            "code:review",
        ],
    },
    {
        "key": "developer",
        "name": "开发者",
        "description": "日常贡献者。",
        "permissions": [
            "workspace:read",
            "component:read",
            "change:read",
            "task:run_agent",
            "code:read",
            "code:write",
        ],
    },
    {
        "key": "reviewer",
        "name": "审核人",
        "description": "可审核代码与变更，但不能修改。",
        "permissions": [
            "workspace:read",
            "change:read",
            "code:read",
            "code:review",
        ],
    },
    {
        "key": "qa",
        "name": "测试工程师",
        "description": "质量保障，可发起有限的 Agent 运行。",
        "permissions": [
            "workspace:read",
            "change:read",
            "code:read",
            "task:run_agent",
        ],
    },
    {
        "key": "viewer",
        "name": "访客",
        "description": "工作区只读访问。",
        "permissions": [
            "workspace:read",
            "component:read",
            "change:read",
        ],
    },
]


def upgrade() -> None:
    # `gen_random_uuid()` lives in pgcrypto — make sure the extension exists.
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column(
            "is_platform_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("mfa_secret", sa.String(length=64), nullable=True),
        sa.Column(
            "mfa_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("last_login_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ux_users_email_active", "users", ["email"], unique=True)

    op.create_table(
        "sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_sessions_user_revoked", "sessions", ["user_id", "revoked_at"])

    op.create_table(
        "roles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_system",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_roles_key"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("permission", sa.String(length=100), nullable=False),
        sa.PrimaryKeyConstraint("role_id", "permission"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "user_workspace_roles",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("granted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "granted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("user_id", "workspace_id", "role_id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_uwr_user", "user_workspace_roles", ["user_id"])
    op.create_index("ix_uwr_workspace", "user_workspace_roles", ["workspace_id"])

    # ── Seed system roles ───────────────────────────────────────────────
    now = datetime.utcnow()
    role_rows = []
    perm_rows = []
    for spec in SYSTEM_ROLES:
        role_id = uuid.uuid4()
        role_rows.append(
            {
                "id": role_id,
                "key": spec["key"],
                "name": spec["name"],
                "description": spec["description"],
                "is_system": True,
                "created_at": now,
            }
        )
        for perm in spec["permissions"]:  # type: ignore[union-attr]
            perm_rows.append({"role_id": role_id, "permission": perm})

    roles_table = sa.table(
        "roles",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("key", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("is_system", sa.Boolean),
        sa.column("created_at", sa.TIMESTAMP(timezone=True)),
    )
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", postgresql.UUID(as_uuid=True)),
        sa.column("permission", sa.String),
    )
    op.bulk_insert(roles_table, role_rows)
    op.bulk_insert(role_perms_table, perm_rows)


def downgrade() -> None:
    op.drop_index("ix_uwr_workspace", table_name="user_workspace_roles")
    op.drop_index("ix_uwr_user", table_name="user_workspace_roles")
    op.drop_table("user_workspace_roles")
    op.drop_table("role_permissions")
    op.drop_table("roles")
    op.drop_index("ix_sessions_user_revoked", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ux_users_email_active", table_name="users")
    op.drop_table("users")
