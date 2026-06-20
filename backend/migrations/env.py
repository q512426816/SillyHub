"""Alembic env.

Runs migrations against the same async engine the application uses, so the URL
and pool config are always in sync. The async engine is created on the fly here
to keep migrations independent from the application lifespan.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import get_settings
from app.models.base import BaseModel
from app.modules.agent import model as _agent_model  # noqa: F401

# Eagerly import every feature module so its SQLModel tables are attached to
# ``BaseModel.metadata`` before autogenerate runs. Add new modules here.
from app.modules.auth import model as _auth_model  # noqa: F401
from app.modules.change import model as _change_model  # noqa: F401
from app.modules.daemon import model as _daemon_model  # noqa: F401
from app.modules.git_gateway import model as _gg_model  # noqa: F401
from app.modules.git_identity import model as _gi_model  # noqa: F401
from app.modules.incident import model as _incident_model  # noqa: F401
from app.modules.ppm.plan import model as _ppm_plan_model  # noqa: F401
from app.modules.ppm.problem import model as _ppm_problem_model  # noqa: F401
from app.modules.ppm.project import model as _ppm_project_model  # noqa: F401
from app.modules.ppm.task import model as _ppm_task_model  # noqa: F401
from app.modules.release import model as _release_model  # noqa: F401
from app.modules.scan_docs import model as _scan_model  # noqa: F401
from app.modules.settings import model as _settings_model  # noqa: F401
from app.modules.spec_profile import model as _spec_profile_model  # noqa: F401
from app.modules.spec_workspace import model as _spec_ws_model  # noqa: F401
from app.modules.task import model as _task_model  # noqa: F401
from app.modules.tool_gateway import model as _tg_model  # noqa: F401
from app.modules.tool_gateway import tool_policy as _tg_policy  # noqa: F401
from app.modules.workflow import model as _workflow_model  # noqa: F401
from app.modules.workspace import model as _workspace_model  # noqa: F401
from app.modules.worktree import model as _worktree_model  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = BaseModel.metadata


def run_migrations_offline() -> None:
    """Generate SQL without a live DB connection."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = settings.database_url
    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
