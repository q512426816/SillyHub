"""preview_office 业务层（2026-08-26-onlyoffice-preview，design §5/§6）。

职责：
1. 归属校验取 object_key（source=session_attachment 走 SessionAttachment 表、
   source=file 走 File 表 get 语义——404 资源隐藏，与既有端点一致）；
2. 一次性 file token（HS256 typ=preview_file + jti redis SETNX 一次性消费）；
3. DS 编辑器配置组装与签名（payload=完整 config，DS 校验顶层 token 字段）。

doc_key 随机（D-004：不做 DS 侧文档缓存，换实现简单）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

_FILE_TOKEN_TYPE = "preview_file"

# 扩展名 → DS documentType（word/cell/slide；ppt 家族含旧格式）。
_DOCUMENT_TYPE_BY_EXT: dict[str, str] = {
    "doc": "word",
    "docx": "word",
    "xls": "cell",
    "xlsx": "cell",
    "ppt": "slide",
    "pptx": "slide",
}


class PreviewOfficeDisabled(AppError):
    """OnlyOffice 未启用（前端据此降级本地渲染器，FR-02）。"""

    http_status = 503
    code = "PREVIEW_OFFICE_DISABLED"
    message = "OnlyOffice 预览未启用。"


class PreviewFileTokenInvalid(AppError):
    http_status = 401
    code = "PREVIEW_FILE_TOKEN_INVALID"
    message = "预览文件令牌无效或已过期。"


class PreviewFileTokenReplayed(AppError):
    http_status = 410
    code = "PREVIEW_FILE_TOKEN_REPLAYED"
    message = "预览文件令牌已被使用。"


class PreviewSourceNotFound(AppError):
    http_status = 404
    code = "PREVIEW_SOURCE_NOT_FOUND"
    message = "文件不存在或无权访问。"


class PreviewFileTokenStoreUnavailable(AppError):
    """Redis 登记失败：一次性令牌无法落地，fail-fast 拒签（503）。"""

    http_status = 503
    code = "PREVIEW_FILE_TOKEN_STORE_UNAVAILABLE"
    message = "预览服务暂不可用，请稍后重试。"


def _ext_of(name: str) -> str:
    dot = name.rfind(".")
    return name[dot + 1 :].lower() if dot >= 0 else ""


class _ObjectRef:
    """归属校验后的对象引用（两 source 归一）。"""

    __slots__ = ("media_type", "name", "object_key")

    def __init__(self, object_key: str, name: str, media_type: str) -> None:
        self.object_key = object_key
        self.name = name
        self.media_type = media_type


async def _resolve_session_attachment(
    session: AsyncSession, *, user_id: uuid.UUID, object_id: uuid.UUID
) -> _ObjectRef:
    from app.modules.session_attachment.model import SessionAttachment

    row = (
        await session.execute(
            select(SessionAttachment).where(
                SessionAttachment.id == object_id,
                SessionAttachment.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise PreviewSourceNotFound(details={"source": "session_attachment"})
    return _ObjectRef(row.object_key, row.name, row.media_type or "application/octet-stream")


async def _resolve_file(
    session: AsyncSession, *, user_id: uuid.UUID, object_id: uuid.UUID
) -> _ObjectRef:
    """File 表 get 语义对齐 file/router.get_stream（FileService.get_meta 的归属口径）。

    file 模块的可见性由 FileService 承担；此处直接复用其 get_meta（内含归属/存在
    校验），避免复制权限逻辑产生第二真相。
    """
    from app.modules.auth.model import User
    from app.modules.file.service import FileService

    user = await session.get(User, user_id)
    if user is None:
        raise PreviewSourceNotFound(details={"source": "file"})
    row = await FileService(session).get_meta(object_id, user=user)
    return _ObjectRef(
        row.stored_key, row.original_name, row.mime_type or "application/octet-stream"
    )


async def resolve_object(
    session: AsyncSession, *, source: str, object_id: uuid.UUID, user_id: uuid.UUID
) -> _ObjectRef:
    if source == "session_attachment":
        return await _resolve_session_attachment(session, user_id=user_id, object_id=object_id)
    if source == "file":
        return await _resolve_file(session, user_id=user_id, object_id=object_id)
    raise PreviewSourceNotFound(details={"source": source})


async def issue_file_token(
    *, object_key: str, settings: Settings, ttl_seconds: int | None = None
) -> str:
    """签一次性文件令牌（jti 入 redis EX；消费端 DELETE 保证一次性）。

    Redis 登记失败 fail-fast 拒签（503）：消费端 consume_file_token 要求
    jti 键存在（DELETE 计数为 0 即判重放 410），登记失败仍签发只会产出
    必然 410 的死令牌，OnlyOffice 静默打不开且无日志——宁可此刻 503。
    """
    now = datetime.now(UTC)
    ttl = ttl_seconds or settings.onlyoffice_file_token_ttl_seconds
    jti = uuid.uuid4().hex
    payload = {
        "typ": _FILE_TOKEN_TYPE,
        "object_key": object_key,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "jti": jti,
    }
    try:
        await get_redis().set(f"preview_file_jti:{jti}", "1", ex=ttl)
    except Exception:
        log.exception("preview_file_token_redis_register_failed")
        raise PreviewFileTokenStoreUnavailable() from None
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


async def consume_file_token(token: str, *, settings: Settings) -> str:
    """校验并消费令牌 → object_key（重放 410 / 无效过期 401）。"""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except JWTError as exc:
        raise PreviewFileTokenInvalid() from exc
    if payload.get("typ") != _FILE_TOKEN_TYPE:
        raise PreviewFileTokenInvalid()
    jti = str(payload.get("jti") or "")
    object_key = str(payload.get("object_key") or "")
    if not jti or not object_key:
        raise PreviewFileTokenInvalid()
    redis = get_redis()
    consumed = await redis.delete(f"preview_file_jti:{jti}")
    if not consumed:
        raise PreviewFileTokenReplayed()
    return object_key


async def build_office_config(
    session: AsyncSession,
    *,
    source: str,
    object_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """归属校验 → 一次性令牌 → DS 编辑器配置（含顶层 token 签名，FR-01/03/05）。"""
    settings = get_settings()
    if not settings.onlyoffice_enabled or not settings.onlyoffice_jwt_secret:
        raise PreviewOfficeDisabled()

    ref = await resolve_object(session, source=source, object_id=object_id, user_id=user_id)
    file_type = _ext_of(ref.name)
    if file_type not in _DOCUMENT_TYPE_BY_EXT:
        raise PreviewSourceNotFound(details={"reason": "not_office_format", "ext": file_type})

    token = await issue_file_token(object_key=ref.object_key, settings=settings)
    ds_secret = settings.onlyoffice_jwt_secret
    document_block: dict[str, Any] = {
        "fileType": file_type,
        "key": uuid.uuid4().hex,  # D-004：随机 key 不做 DS 缓存
        "title": ref.name,
        "url": f"{settings.onlyoffice_file_base_url}/api/preview/file/{token}",
        "permissions": {"read": True, "edit": False, "download": True, "print": True},
    }
    editor_block: dict[str, Any] = {
        "mode": "view",
        "lang": "zh",
        "customization": {
            "forcesave": False,
            "compactHeader": True,
            "hideRightMenus": True,
        },
    }
    # DS 9 JWT（helpcenter docs-configure-jwt）：顶层 token=整 config 签名；
    # document / editorConfig 各自内嵌 token（严格模式分段校验）。三处同 secret。
    document_block["token"] = jwt.encode(document_block, ds_secret, algorithm="HS256")
    editor_block["token"] = jwt.encode(editor_block, ds_secret, algorithm="HS256")
    config: dict[str, Any] = {
        "document": document_block,
        "documentType": _DOCUMENT_TYPE_BY_EXT[file_type],
        "width": "100%",
        "height": "100%",
        "editorConfig": editor_block,
    }
    config["token"] = jwt.encode(config, ds_secret, algorithm="HS256")
    return config
