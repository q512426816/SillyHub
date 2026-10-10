"""Local conftest for linked_repos tests（2026-10-10-workspec-maintenance task-01）。

复刻 member_runtimes/tests/conftest.py 的 selected-metadata 范式：只建本模块
需要的表（含 FK 闭包），规避根 conftest 全量 ``BaseModel.metadata`` 在 SQLite
下的 DDL 时序问题。
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def _selected_metadata() -> Any:
    from app.models.base import BaseModel

    # import 注册（幂等）：auth/users、workspace、agent_profile FK 闭包、daemon。
    from app.modules.admin import model as _admin  # noqa: F401
    from app.modules.agent.profile import model as _agent_profile  # noqa: F401
    from app.modules.auth import model as _auth  # noqa: F401
    from app.modules.daemon import model as _daemon  # noqa: F401
    from app.modules.llm_provider import model as _llm_provider  # noqa: F401
    from app.modules.tool_gateway.tool_policy import ToolPolicy  # noqa: F401
    from app.modules.workspace import model as _ws  # noqa: F401
    from app.modules.workspace.linked_repos import model as _lr  # noqa: F401

    full = BaseModel.metadata
    needed = {
        "users",
        "workspaces",
        # workspaces 的 FK 闭包：agent_profiles → tool_policies / llm_providers。
        "agent_profiles",
        "tool_policies",
        "llm_providers",
        # sync_states.machine_id FK → daemon_instances.id。
        "daemon_instances",
        # task-03：build_sync_payload/summary 按 (workspace,user) 查成员绑定行；
        # 其 runtime_id FK → daemon_runtimes（建表闭包）。
        "workspace_member_runtimes",
        "daemon_runtimes",
        # RBAC：require_permission 闭包对普通（非 admin）用户查角色四表
        # （member_runtimes/tests/conftest.py 同款；403 用例依赖）。
        "roles",
        "role_permissions",
        "user_workspace_roles",
        "user_roles",
        # 本模块三表。
        "workspace_linked_repos",
        "workspace_linked_repo_paths",
        "workspace_linked_repo_sync_states",
    }
    meta = MetaData()
    for name in needed:
        if name in full.tables:
            full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def db_engine():
    from sqlalchemy import event

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)

    # 开 FK pragma：让 ondelete=CASCADE 在 SQLite 下与 PostgreSQL 行为一致
    # （task-01 级联删除用例依赖）。
    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _record):  # pragma: no cover - 引擎钩子
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

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
