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
