"""kanban 子域测试 conftest。

职责:
1. 确保 ``ppm.project`` (member 表) + ``ppm.admin`` (org 表) 模型注册到
   ``BaseModel.metadata``,使根 conftest 的 ``create_all`` 能建出相关表
   (根 conftest 已导入 ppm.task,这里补齐 project/admin)。
2. 提供 ``kanban_client`` fixture —— 独立 FastAPI app 只挂 kanban router
   (prefix ``/api/ppm``),供 HTTP 层测试。kanban router **未挂载到
   app.main** (task-08 统一注册),故这里自建 app。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# 模型注册 (根 conftest 已导 ppm.task,补 project/admin)
from app.modules.admin import model as _admin_model  # noqa: F401
from app.modules.ppm.project import model as _project_model  # noqa: F401


@pytest.fixture()
async def kanban_client(db_engine, auth_admin_token: str) -> AsyncIterator[AsyncClient]:
    """挂载 kanban router 的独立 app (session 指向测试 engine)。

    复用根 conftest 的 ``db_engine`` + ``auth_admin_token`` (platform admin)。
    admin 是 platform admin → ``has_permission`` 放行 (与 task 子域 HTTP 测试同套路)。
    """
    from fastapi import FastAPI

    from app.core.db import get_session
    from app.core.errors import register_exception_handlers
    from app.modules.ppm.kanban.router import router as kanban_router

    app = FastAPI()
    app.include_router(kanban_router, prefix="/api/ppm")
    # 复用全局异常处理器,把 AppError 转 HTTP 响应 (与 main app 行为一致)
    register_exception_handlers(app)

    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 注入 admin token 到默认 header
        ac.headers["Authorization"] = f"Bearer {auth_admin_token}"
        yield ac
