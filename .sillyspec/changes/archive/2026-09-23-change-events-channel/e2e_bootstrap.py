"""task-08 端到端验收引导：SQLite create_all 建表 + workspace/user/shpsync_ token 签发。

用法（worktree backend 下）：
  DATABASE_URL=sqlite+aiosqlite:////tmp/events-e2e.db SECRET_KEY=... \
    uv run python ../../.sillyspec/changes/2026-09-23-change-events-channel/e2e_bootstrap.py
输出 JSON：{workspace_id, user_id, token}
"""

import asyncio
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# import app.main 连带注册全部模块 model（router import 链），否则 create_all
# 报 NoReferencedTableError（跨模块 FK 缺表——根 conftest 集中登记同因）。
import app.main  # noqa: F401
from app.core.config import get_settings
from app.core.security import password_hasher
from app.models.base import BaseModel
from app.modules.auth.model import User
from app.modules.platform_sync.token_service import PlatformSyncTokenService
from app.modules.workspace.model import Workspace


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(BaseModel.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        ws = Workspace(
            id=uuid.uuid4(),
            name="ws-events-e2e",
            slug=f"ws-events-e2e-{uuid.uuid4().hex[:6]}",
            root_path="/tmp/ws-events-e2e",
            status="active",
        )
        session.add(ws)
        user = User(
            id=uuid.uuid4(),
            email=f"events-e2e-{uuid.uuid4().hex[:6]}@example.com",
            password_hash=password_hasher.hash("x"),
            display_name="EventsE2E",
            status="active",
        )
        session.add(user)
        await session.commit()
        await session.refresh(ws)
        _row, plaintext = await PlatformSyncTokenService(
            session, settings=settings
        ).create(
            workspace_id=ws.id,
            name="events-e2e",
            created_by=user.id,
        )
        print(
            json.dumps(
                {
                    "workspace_id": str(ws.id),
                    "user_id": str(user.id),
                    "token": plaintext,
                }
            )
        )
    await engine.dispose()


asyncio.run(main())
