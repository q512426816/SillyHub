"""agent_profiles table + agent_runs/workspace profile columns + default seed

Revision ID: 20260802_agent_profile
Revises: 202607311500
Create Date: 2026-08-02

Change 2026-08-02-agent-profile-layer task-01 / design §3.1~§3.3 / D-010 / D-015：
- 建 ``agent_profiles`` 表（智能体档案配置层，design §3.1 全字段）。
- ``agent_runs`` 加 ``agent_profile_id`` (FK nullable) + ``agent_profile_snapshot``
  (JSON nullable) —— design §3.2。
- ``workspaces`` 加 ``default_agent_profile_id`` (FK nullable) —— design §3.3。
- 首次 seed 两平台默认档案：「Claude Code 默认」(provider=claude) + 「Codex 默认」
  (provider=codex)，``is_system_default=True``、``visibility=platform``（D-010/D-015）。
  task-11 startup hook 负责 idempotent 补种，本迁移只做首次落库。

铁律：全新列均 nullable，向后兼容（profile=None 走原 dispatch 路径零回归，C-07）。
``down_revision`` 接 ``202607311500``（当前 head，``alembic heads`` 实测单 head）。

FK ondelete 语义（与现有表风格对齐）：
  - ``owner_user_id`` → users.id SET NULL（用户注销档案保留，审计可追溯）
  - ``workspace_id`` → workspaces.id CASCADE（workspace 删则其下档案级联清）
  - ``tool_policy_id`` → tool_policies.id SET NULL（policy 删档案保留）
  - ``agent_runs.agent_profile_id`` → agent_profiles.id SET NULL（档案删 run 历史保留）
  - ``workspaces.default_agent_profile_id`` → agent_profiles.id SET NULL（软约束兜底，
    档案删 workspace 保留，回退到 default_agent provider 字符串）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260802_agent_profile"
down_revision: str | None = "202607311500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. design §3.1: 建 agent_profiles 表 ──
    op.create_table(
        "agent_profiles",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("workspace_id", sa.Uuid(as_uuid=True), nullable=True),
        # visibility: private / workspace / platform（D-009 三级，DB 层 String，
        # 枚举校验留 model/service 层，与 status 等列同风格免后续加值迁移）。
        sa.Column(
            "visibility",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'private'"),
        ),
        # provider: 供应商偏好（claude/codex/…），作 target_provider（D-014）。
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("tool_policy_id", sa.Uuid(as_uuid=True), nullable=True),
        # mcp_refs / skill_refs：引用列表，非空（空列表 = 不勾选任何引用）。
        sa.Column(
            "mcp_refs",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "skill_refs",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column("allowed_roots_overlay", sa.JSON(), nullable=True),
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "is_system_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
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
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tool_policy_id"],
            ["tool_policies.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_agent_profiles_owner_user_id",
        "agent_profiles",
        ["owner_user_id"],
    )
    op.create_index(
        "ix_agent_profiles_workspace_id",
        "agent_profiles",
        ["workspace_id"],
    )
    op.create_index(
        "ix_agent_profiles_visibility",
        "agent_profiles",
        ["visibility"],
    )
    op.create_index(
        "ix_agent_profiles_provider",
        "agent_profiles",
        ["provider"],
    )
    op.create_index(
        "ix_agent_profiles_is_system_default",
        "agent_profiles",
        ["is_system_default"],
    )

    # ── 2. design §3.2: agent_runs 加 profile 列（nullable 向后兼容） ──
    op.add_column(
        "agent_runs",
        sa.Column("agent_profile_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("agent_profile_snapshot", sa.JSON(), nullable=True),
    )
    op.create_foreign_key(
        "agent_runs_agent_profile_id_fkey",
        "agent_runs",
        "agent_profiles",
        ["agent_profile_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ── 3. design §3.3: workspaces 加 default profile 列（nullable 软约束） ──
    op.add_column(
        "workspaces",
        sa.Column("default_agent_profile_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "workspaces_default_agent_profile_id_fkey",
        "workspaces",
        "agent_profiles",
        ["default_agent_profile_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ── 4. D-010 / D-015: 首次 seed 两平台默认档案 ──
    #    task-11 startup hook 负责 idempotent 补种（按 is_system_default + name 去重），
    #    本迁移只覆盖「新环境从头建库」的首次落库。
    now = datetime.now(UTC)
    agent_profiles_table = sa.table(
        "agent_profiles",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("owner_user_id", sa.Uuid(as_uuid=True)),
        sa.column("workspace_id", sa.Uuid(as_uuid=True)),
        sa.column("visibility", sa.String),
        sa.column("provider", sa.String),
        sa.column("model", sa.String),
        sa.column("system_prompt", sa.Text),
        sa.column("tool_policy_id", sa.Uuid(as_uuid=True)),
        sa.column("mcp_refs", sa.JSON),
        sa.column("skill_refs", sa.JSON),
        sa.column("allowed_roots_overlay", sa.JSON),
        sa.column("version", sa.Integer),
        sa.column("is_system_default", sa.Boolean),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        agent_profiles_table,
        [
            {
                "id": uuid.uuid4(),
                "name": "Claude Code 默认",
                "owner_user_id": None,
                "workspace_id": None,
                "visibility": "platform",
                "provider": "claude",
                "model": None,
                "system_prompt": None,
                "tool_policy_id": None,
                "mcp_refs": [],
                "skill_refs": [],
                "allowed_roots_overlay": None,
                "version": 1,
                "is_system_default": True,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": uuid.uuid4(),
                "name": "Codex 默认",
                "owner_user_id": None,
                "workspace_id": None,
                "visibility": "platform",
                "provider": "codex",
                "model": None,
                "system_prompt": None,
                "tool_policy_id": None,
                "mcp_refs": [],
                "skill_refs": [],
                "allowed_roots_overlay": None,
                "version": 1,
                "is_system_default": True,
                "created_at": now,
                "updated_at": now,
            },
        ],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 相反顺序）。

    seed 的两默认档案随 ``agent_profiles`` 表 drop 一并清除，不单独处理
    （task-11 startup hook 在重新 upgrade 后会 idempotent 补种）。
    """
    # 3. workspaces 列
    op.drop_constraint(
        "workspaces_default_agent_profile_id_fkey",
        "workspaces",
        type_="foreignkey",
    )
    op.drop_column("workspaces", "default_agent_profile_id")

    # 2. agent_runs 列（先 drop snapshot 再 drop id 再 drop FK——FK 先于 id 列 drop）
    op.drop_constraint(
        "agent_runs_agent_profile_id_fkey",
        "agent_runs",
        type_="foreignkey",
    )
    op.drop_column("agent_runs", "agent_profile_snapshot")
    op.drop_column("agent_runs", "agent_profile_id")

    # 1. agent_profiles 表
    op.drop_index(
        "ix_agent_profiles_is_system_default",
        table_name="agent_profiles",
    )
    op.drop_index("ix_agent_profiles_provider", table_name="agent_profiles")
    op.drop_index("ix_agent_profiles_visibility", table_name="agent_profiles")
    op.drop_index("ix_agent_profiles_workspace_id", table_name="agent_profiles")
    op.drop_index("ix_agent_profiles_owner_user_id", table_name="agent_profiles")
    op.drop_table("agent_profiles")
