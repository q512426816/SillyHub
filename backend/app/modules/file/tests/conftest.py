"""file 模块测试 conftest。

提供 MockStorage（内存实现 StorageBackend，不依赖真实 MinIO，NFR-4）+
挂载 file router 并注入 mock storage / 测试 DB session 的 httpx 客户端。
file 测试自挂 router 与依赖覆盖，不走全局 ``client`` fixture（避免真实 storage 兜底）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.db import get_session
from app.main import app
from app.modules.storage.base import ObjectStat, StorageBackend
from app.modules.storage.factory import get_storage_backend


class MockStorage(StorageBackend):
    """内存存储后端。record put 调用、回放 get 内容，供断言。"""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    async def get_object_stream(self, key: str) -> AsyncIterator[bytes]:
        data, _ = self.objects[key]
        yield data

    async def delete_object(self, key: str) -> None:
        self.objects.pop(key, None)

    async def head_object(self, key: str) -> ObjectStat:
        data, ctype = self.objects[key]
        return ObjectStat(size=len(data), content_type=ctype)


@pytest.fixture()
def mock_storage() -> MockStorage:
    return MockStorage()


@pytest.fixture()
async def file_client(db_engine: Any, mock_storage: MockStorage) -> AsyncIterator[AsyncClient]:
    """挂载 file 依赖覆盖（测试 session + mock storage）的 HTTP 客户端。"""
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_storage_backend] = lambda: mock_storage
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_storage_backend, None)


def png_upload(
    name: str = "现场照片.png", data: bytes = b"\x89PNG\r\n\x1a\n-fake"
) -> dict[str, Any]:
    """构造一个 png multipart 上传体。"""
    return {"file": (name, data, "image/png")}


def make_id() -> uuid.UUID:
    return uuid.uuid4()
