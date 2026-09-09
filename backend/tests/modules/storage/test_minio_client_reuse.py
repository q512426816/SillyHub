"""MinioStorage client 单例复用测试（ql-20260909-012-f48b）。

原实现每次操作 ``create_client`` + ``async with`` 即建即毁（每次 put/get/
head/delete 重付 TCP+TLS 握手，docstring 却自称"模块级复用"）。改惰性单例后
本测试锁定三点：

- 连续操作复用同一 client 实例（create_client 仅一次）；
- ``aclose`` 关闭后可重建（惰性单例可复活，lifespan 语义）；
- 并发首建无竞态（Lock 双检——gather 多操作仍只建一个）。
"""

from __future__ import annotations

import asyncio

import pytest

from app.modules.storage import minio_backend
from app.modules.storage.minio_backend import MinioStorage


class _FakeS3Client:
    """aiobotocore client 替身：记录操作与 aenter/aexit 次数。"""

    def __init__(self) -> None:
        self.entered = 0
        self.exited = 0
        self.put_calls = 0

    async def __aenter__(self) -> "_FakeS3Client":
        self.entered += 1
        return self

    async def __aexit__(self, *exc: object) -> None:
        self.exited += 1

    async def create_bucket(self, **kw: object) -> None:
        return None

    async def put_object(self, **kw: object) -> None:
        self.put_calls += 1

    async def head_object(self, **kw: object) -> dict[str, object]:
        return {"ContentLength": 1, "ContentType": "text/plain"}


class _FakeSession:
    def __init__(self) -> None:
        self.clients: list[_FakeS3Client] = []

    def create_client(self, *args: object, **kw: object) -> _FakeS3Client:
        client = _FakeS3Client()
        self.clients.append(client)
        return client


@pytest.fixture()
def fake_session(monkeypatch: pytest.MonkeyPatch) -> _FakeSession:
    session = _FakeSession()
    monkeypatch.setattr(minio_backend, "get_session", lambda: session)
    return session


def _backend() -> MinioStorage:
    return MinioStorage(
        endpoint="http://minio:9000",
        access_key="ak",
        secret_key="sk",
        bucket="test-bucket",
    )


async def test_client_reused_across_operations(fake_session: _FakeSession) -> None:
    backend = _backend()
    await backend.put_object("a", b"x", "text/plain")
    await backend.put_object("b", b"y", "text/plain")
    await backend.head_object("a")
    # 单例：3 次操作只建 1 个 client（原实现每次新建）
    assert len(fake_session.clients) == 1
    assert fake_session.clients[0].put_calls == 2


async def test_aclose_then_rebuild(fake_session: _FakeSession) -> None:
    backend = _backend()
    await backend.put_object("a", b"x", "text/plain")
    await backend.aclose()
    # aexit 恰一次（关闭在飞连接池）
    assert fake_session.clients[0].exited == 1
    # 关闭后可复活：新操作建新 client
    await backend.put_object("b", b"y", "text/plain")
    assert len(fake_session.clients) == 2
    assert fake_session.clients[1].entered == 1


async def test_concurrent_first_build_single_client(fake_session: _FakeSession) -> None:
    backend = _backend()
    # 并发首建：gather 10 路同时 _get_client，Lock 双检保证只建一个
    await asyncio.gather(*(backend.put_object(f"k{i}", b"x", "text/plain") for i in range(10)))
    assert len(fake_session.clients) == 1
    assert fake_session.clients[0].put_calls == 10
