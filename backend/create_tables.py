"""One-shot script to create all database tables."""

import asyncio

from sqlalchemy.ext.asyncio import create_async_engine

import app.modules.agent.model

# Import all modules to register their table metadata
import app.modules.auth.model
import app.modules.change.model
import app.modules.git_gateway.model
import app.modules.git_identity.model
import app.modules.settings.model
import app.modules.spec_profile.model
import app.modules.spec_workspace.model
import app.modules.task.model
import app.modules.workspace.model
import app.modules.worktree.model  # noqa: F401  WorktreeLease
from app.core.config import get_settings
from app.models.base import BaseModel


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=True)
    async with engine.begin() as conn:
        await conn.run_sync(BaseModel.metadata.create_all)
    await engine.dispose()
    print("\n✅ All tables created!")


if __name__ == "__main__":
    asyncio.run(main())
