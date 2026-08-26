"""preview_office 单测（2026-08-26-onlyoffice-preview，FR-02/03/04）。

覆盖：
1. 令牌生命周期：签发→消费（一次性：二消费 410）；无效/过期 401；typ 伪造 401。
2. build_office_config：未启用 503；归属 404（跨用户/不存在）；非 office 扩展名 404；
   成功结构（document.url 指向一次性端点、mode=view、顶层 token 可被 DS secret 验签）。
3. 跨 source：session_attachment 与 file 两条归属链（file 走 FileService 语义）。

夹具：in-memory SQLite（daemon tests 同款）+ redis mock（service 内 get_redis patch）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from jose import jwt

from app.core.config import get_settings
from app.modules.preview_office import service as svc
from app.modules.preview_office.service import (
    PreviewFileTokenInvalid,
    PreviewFileTokenReplayed,
    PreviewOfficeDisabled,
    PreviewSourceNotFound,
)

# 模块级注册表：db_engine 的 create_all 按显式 import 收集模型（根 conftest 模式），
# session_attachment 不在其列——此处顶层 import 注册 session_attachments 表。
from app.modules.session_attachment import model as _session_attachment_model  # noqa: F401


async def _create_user(session, *, admin: bool = False) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"po-{uid}@example.com",
            password_hash="x",
            display_name="PO",
            status="active",
            is_platform_admin=admin,
        )
    )
    await session.commit()
    return uid


async def _seed_attachment(session, user_id: uuid.UUID, *, name: str = "报表.xls") -> uuid.UUID:
    from app.modules.session_attachment.model import SessionAttachment

    aid = uuid.uuid4()
    session.add(
        SessionAttachment(
            id=aid,
            user_id=user_id,
            session_id=None,
            kind="file",
            media_type="application/vnd.ms-excel",
            bytes=64,
            name=name,
            object_key=f"attachments/{user_id}/{uuid.uuid4().hex}.bin",
            sha256=uuid.uuid4().hex,
            created_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return aid


@pytest.fixture()
def mocked_redis():
    """简易 redis mock：set 登记 + delete 消费（一次性语义）。"""
    seen: set[str] = set()

    async def set_key(key: str, value: str = "1", ex: int | None = None) -> bool:
        seen.add(key)
        return True

    async def delete_key(key: str) -> int:
        if key not in seen:
            return 0
        seen.discard(key)
        return 1

    redis = MagicMock()
    redis.set = AsyncMock(side_effect=set_key)
    redis.delete = AsyncMock(side_effect=delete_key)
    with patch("app.modules.preview_office.service.get_redis", return_value=redis):
        yield redis


def _settings(**over):
    s = get_settings()
    s.onlyoffice_enabled = over.pop("enabled", True)
    s.onlyoffice_jwt_secret = over.pop("jwt_secret", "ds-test-secret")
    s.gotenberg_url = over.pop("gotenberg_url", "")
    return s


# ── 1. 令牌生命周期 ───────────────────────────────────────────────────────────


class TestFileToken:
    @pytest.mark.asyncio
    async def test_issue_and_consume_once(self, db_session, mocked_redis) -> None:
        s = _settings()
        token = await svc.issue_file_token(object_key="attachments/a/b.bin", settings=s)
        key = await svc.consume_file_token(token, settings=s)
        assert key == "attachments/a/b.bin"
        # 二次消费：重放 410。
        with pytest.raises(PreviewFileTokenReplayed):
            await svc.consume_file_token(token, settings=s)

    @pytest.mark.asyncio
    async def test_invalid_token_rejected(self, db_session) -> None:
        with pytest.raises(PreviewFileTokenInvalid):
            await svc.consume_file_token("not-a-jwt", settings=_settings())

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, db_session, mocked_redis) -> None:
        s = _settings()
        now = datetime.now(UTC)
        payload = {
            "typ": "preview_file",
            "object_key": "k",
            "iat": int((now - timedelta(seconds=600)).timestamp()),
            "exp": int((now - timedelta(seconds=300)).timestamp()),
            "jti": uuid.uuid4().hex,
        }
        token = jwt.encode(payload, s.secret_key, algorithm="HS256")
        with pytest.raises(PreviewFileTokenInvalid):
            await svc.consume_file_token(token, settings=s)

    @pytest.mark.asyncio
    async def test_wrong_typ_rejected(self, db_session, mocked_redis) -> None:
        s = _settings()
        token = jwt.encode({"typ": "access", "jti": "x"}, s.secret_key, algorithm="HS256")
        with pytest.raises(PreviewFileTokenInvalid):
            await svc.consume_file_token(token, settings=s)


# ── 2. build_office_config ───────────────────────────────────────────────────


class TestBuildConfig:
    @pytest.mark.asyncio
    async def test_disabled_returns_503_error(self, db_session) -> None:
        _settings(enabled=False)
        with pytest.raises(PreviewOfficeDisabled):
            await svc.build_office_config(
                db_session,
                source="session_attachment",
                object_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )

    @pytest.mark.asyncio
    async def test_foreign_attachment_404(self, db_session, mocked_redis) -> None:
        _settings()
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid)
        with pytest.raises(PreviewSourceNotFound):
            await svc.build_office_config(
                db_session,
                source="session_attachment",
                object_id=aid,
                user_id=uuid.uuid4(),  # 他人
            )

    @pytest.mark.asyncio
    async def test_non_office_ext_404(self, db_session, mocked_redis) -> None:
        _settings()
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="图.png")
        with pytest.raises(PreviewSourceNotFound):
            await svc.build_office_config(
                db_session, source="session_attachment", object_id=aid, user_id=uid
            )

    @pytest.mark.asyncio
    async def test_happy_path_config_structure(self, db_session, mocked_redis) -> None:
        s = _settings(jwt_secret="ds-test-secret")
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="考核.xls")
        config = await svc.build_office_config(
            db_session, source="session_attachment", object_id=aid, user_id=uid
        )
        assert config["documentType"] == "cell"
        assert config["document"]["fileType"] == "xls"
        assert config["document"]["url"].startswith(
            f"{s.onlyoffice_file_base_url}/api/preview/file/"
        )
        assert config["editorConfig"]["mode"] == "view"
        # 顶层 token 可用 DS secret 验签且 payload 与 config 一致（DS 校验契约）。
        decoded = jwt.decode(config["token"], "ds-test-secret", algorithms=["HS256"])
        assert decoded["document"]["fileType"] == "xls"
        assert decoded["document"]["url"] == config["document"]["url"]

    @pytest.mark.asyncio
    async def test_redis_register_failure_fails_fast(self, db_session) -> None:
        """ql-20260826-011：Redis SET 失败 → 拒签 503，不再产出必然 410 的死令牌。

        原实现吞掉 SET 异常仍签发，但 consume_file_token 要求 jti 键存在
        （DELETE 计数为 0 判重放），登记失败的令牌消费时恒 410 且无日志。
        """
        from app.modules.preview_office.service import PreviewFileTokenStoreUnavailable

        broken = MagicMock()
        broken.set = AsyncMock(side_effect=RuntimeError("redis down"))
        s = _settings()
        with (
            patch("app.modules.preview_office.service.get_redis", return_value=broken),
            pytest.raises(PreviewFileTokenStoreUnavailable),
        ):
            await svc.issue_file_token(object_key="attachments/x.bin", settings=s)
        broken.set.assert_awaited_once()


# ── 3. build_preview 双模式（ql-20260826-011：Word→LibreOffice→PDF）────────────


class _FakeStorage:
    """head miss→raise / get→固定字节 / put 记录调用 的存储桩。"""

    def __init__(self, *, cached: bool = False) -> None:
        self.cached = cached
        self.put_keys: list[str] = []

    async def head_object(self, key: str):
        if not self.cached:
            raise FileNotFoundError(key)
        from app.modules.storage.base import ObjectStat

        return ObjectStat(size=8, content_type="application/pdf")

    async def get_object_stream(self, key: str):
        yield b"docx-bytes"

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self.put_keys.append(key)


def _mock_convert(pdf: bytes = b"%PDF-1.7 fake"):
    """桩 httpx.AsyncClient：post → 200 + content=pdf。"""
    resp = MagicMock()
    resp.status_code = 200
    resp.content = pdf
    resp.raise_for_status = MagicMock()
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    client_cls = MagicMock()
    client_cls.return_value.__aenter__ = AsyncMock(return_value=client)
    client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    return client_cls, client


class TestBuildPreview:
    @pytest.mark.asyncio
    async def test_word_lo_pdf_mode(self, db_session, mocked_redis) -> None:
        """docx + Gotenberg 配置 → mode=pdf（转换结果入缓存，URL 同源一次性）。"""
        _settings(gotenberg_url="http://gotenberg:3000")
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="指南.docx")
        storage = _FakeStorage()
        client_cls, client = _mock_convert()
        with (
            patch("app.modules.storage.factory.get_storage_backend", return_value=storage),
            patch("app.modules.preview_office.service.httpx.AsyncClient", client_cls),
        ):
            resp = await svc.build_preview(
                db_session, source="session_attachment", object_id=aid, user_id=uid
            )
        assert resp["mode"] == "pdf"
        assert resp["pdf_path"].startswith("/api/preview/file/")
        client.post.assert_awaited_once()
        assert storage.put_keys and storage.put_keys[0].startswith("preview-pdf/")

    @pytest.mark.asyncio
    async def test_word_lo_cache_hit_skips_convert(self, db_session, mocked_redis) -> None:
        """缓存命中（head ok）不再触发转换。"""
        _settings(gotenberg_url="http://gotenberg:3000")
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="指南.docx")
        storage = _FakeStorage(cached=True)
        client_cls, client = _mock_convert()
        with (
            patch("app.modules.storage.factory.get_storage_backend", return_value=storage),
            patch("app.modules.preview_office.service.httpx.AsyncClient", client_cls),
        ):
            resp = await svc.build_preview(
                db_session, source="session_attachment", object_id=aid, user_id=uid
            )
        assert resp["mode"] == "pdf"
        client.post.assert_not_awaited()
        assert storage.put_keys == []

    @pytest.mark.asyncio
    async def test_word_lo_failure_falls_back_to_ds(self, db_session, mocked_redis) -> None:
        """Gotenberg 转换异常 → 回落 mode=ds（OnlyOffice config 完整）。"""
        _settings(gotenberg_url="http://gotenberg:3000")
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="指南.docx")
        storage = _FakeStorage()
        client = MagicMock()
        client.post = AsyncMock(side_effect=RuntimeError("gotenberg down"))
        client_cls = MagicMock()
        client_cls.return_value.__aenter__ = AsyncMock(return_value=client)
        client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        with (
            patch("app.modules.storage.factory.get_storage_backend", return_value=storage),
            patch("app.modules.preview_office.service.httpx.AsyncClient", client_cls),
        ):
            resp = await svc.build_preview(
                db_session, source="session_attachment", object_id=aid, user_id=uid
            )
        assert resp["mode"] == "ds"
        assert resp["config"]["documentType"] == "word"

    @pytest.mark.asyncio
    async def test_non_word_stays_ds(self, db_session, mocked_redis) -> None:
        """xlsx 即使配置了 Gotenberg 也走 DS（Excel 交互预览保留）。"""
        _settings(gotenberg_url="http://gotenberg:3000")
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="考核.xlsx")
        with patch("app.modules.storage.factory.get_storage_backend", return_value=_FakeStorage()):
            resp = await svc.build_preview(
                db_session, source="session_attachment", object_id=aid, user_id=uid
            )
        assert resp["mode"] == "ds"
        assert resp["config"]["documentType"] == "cell"

    @pytest.mark.asyncio
    async def test_gotenberg_unset_stays_ds(self, db_session, mocked_redis) -> None:
        """未配置 Gotenberg（默认）→ 行为与现状一致（mode=ds）。"""
        _settings()
        uid = await _create_user(db_session)
        aid = await _seed_attachment(db_session, uid, name="指南.docx")
        resp = await svc.build_preview(
            db_session, source="session_attachment", object_id=aid, user_id=uid
        )
        assert resp["mode"] == "ds"
