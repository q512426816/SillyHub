"""Local conftest for member_runtimes tests.

Overrides the shared ``db_engine`` fixture to build only the schema this module
needs. The root conftest builds the *full* ``BaseModel.metadata``; as of this
change a sibling in-flight task (2026-07-02-change-detail-file-tree-editor)
added ``DaemonChangeWrite.kind`` with ``server_default=text("create")`` which
renders as an unquoted SQL keyword on SQLite and aborts ``CREATE TABLE``. That
model is outside task-03's allowed_paths, so we cannot fix it here. Instead we
materialize a fresh metadata containing only the tables actually referenced by
these tests (auth/users, workspace, daemon_runtime, member_runtimes) and build
that — no daemon_change_writes, no syntax error.

This override is scoped to this directory and touches no production source.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def _selected_metadata() -> Any:
    """Build a metadata containing only the tables this module needs.

    Importing the feature models attaches them to ``BaseModel.metadata``; we
    then copy just the relevant ``Table`` objects into a fresh ``MetaData`` so
    ``create_all`` does not try to emit the broken daemon_change_writes DDL.

    2026-07-25-daemon-borrow-for-business task-07：``resolve_runtime_for_writeback``
    借用兜底接入 ``_resolve_borrowed_or_own_runtime`` → ``has_permission``，需要
    RBAC 表（``roles`` / ``role_permissions`` / ``user_workspace_roles`` +
    admin 的 ``user_roles``）。把这些表纳入 selected schema，否则借用回退的权限查询
    在最小 schema 下抛 ``no such table``（既有 not_bound / daemon_offline 用例的 actor
    无任何角色，权限查询返回空集 → helper 返回 None → 原错误文案不变，零回归）。
    """
    from sqlalchemy import MetaData

    from app.models.base import BaseModel

    # Import to ensure registration (order-independent; tables are idempotent).
    from app.modules.admin import model as _admin  # noqa: F401

    # task-02（2026-08-02-agent-profile-layer）Workspace 加 default_agent_profile_id
    # FK→agent_profiles.id；AgentProfile 又 FK→tool_policies.id / users.id / workspaces.id。
    # 本 conftest 自建 selected-metadata 建表，必须把 FK 闭包内的表都纳入 needed，否则
    # to_metadata + create_all 报 NoReferencedTableError('agent_profiles')（同根
    # conftest:86 的 import 注册思路，范式同 daemon/host_fs/tests/test_delegate_integration.py）。
    from app.modules.agent.profile import model as _agent_profile  # noqa: F401
    from app.modules.auth import model as _auth  # noqa: F401
    from app.modules.daemon import model as _daemon  # noqa: F401
    from app.modules.tool_gateway.tool_policy import ToolPolicy  # noqa: F401
    from app.modules.workspace import model as _ws  # noqa: F401
    from app.modules.workspace.member_runtimes import model as _wmr  # noqa: F401

    full = BaseModel.metadata
    needed = {
        "users",
        "daemon_instances",
        "daemon_runtimes",
        "workspaces",
        "workspace_member_runtimes",
        # RBAC（task-07 借用 helper 的 has_permission 查询需要）。
        "roles",
        "role_permissions",
        "user_workspace_roles",
        "user_roles",
        # task-02 FK 闭包：workspaces→agent_profiles→tool_policies。
        "agent_profiles",
        "tool_policies",
    }
    meta = MetaData()
    for name in needed:
        if name in full.tables:
            full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    meta = _selected_metadata()
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture()
async def db_session(db_engine: Any):
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
