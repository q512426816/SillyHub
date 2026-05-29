"""One-shot script to create all database tables."""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.models.base import BaseModel
from app.core.config import get_settings

# Import all modules to register their table metadata
import app.modules.auth.model       # noqa: F401  User
import app.modules.workspace.model  # noqa: F401  Workspace, WorkspaceComponent
import app.modules.change.model     # noqa: F401  Change, ChangeDocument
import app.modules.task.model       # noqa: F401  Task
import app.modules.agent.model      # noqa: F401  AgentRun, AgentRunLog
import app.modules.worktree.model   # noqa: F401  WorktreeLease
import app.modules.git_identity.model    # noqa: F401  GitIdentity
import app.modules.git_gateway.model     # noqa: F401  GitOperationLog
import app.modules.settings.model        # noqa: F401  PlatformSetting
import app.modules.spec_workspace.model  # noqa: F401  SpecWorkspace
import app.modules.spec_profile.model    # noqa: F401  SpecProfileManifest, SpecConflict


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=True)
    async with engine.begin() as conn:
        await conn.run_sync(BaseModel.metadata.create_all)
    await engine.dispose()
    print("\n✅ All tables created!")


if __name__ == "__main__":
    asyncio.run(main())
