"""preview_office 路由（2026-08-26-onlyoffice-preview，design §6）。

- ``GET /api/preview/office-config?source=&id=``：JWT 鉴权 → 完整 DS 编辑器配置
  （含 token 签名与 ds_url）。DS 未启用 503（前端降级锚点）。
- ``GET /api/preview/file/{token}``：DS 匿名回拉（无 JWT），一次性令牌 → 流式对象。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.config import get_settings
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.storage.factory import get_storage_backend

from . import service
from .service import PreviewOfficeDisabled

router = APIRouter(prefix="/preview", tags=["preview"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/office-config")
async def get_office_config(
    session: SessionDep,
    user: CurrentUser,
    source: str = Query(description="session_attachment | file"),
    id: uuid.UUID = Query(description="附件/文件 id"),
) -> dict:
    """Office 家族文件预览配置（FR-01/03/04/05；ql-20260826-011 扩展双模式）。

    返回 ``{"mode": "pdf", "pdf_path"}``（Word 走 LibreOffice→PDF，docGrid 排版
    保真）或 ``{"mode": "ds", "ds_url", "config"}``——config 可直接交给
    ``DocsAPI.DocEditor``（document.url 已指向一次性文件令牌端点，顶层 token 为
    DS 签名）。503 = 未启用（前端降级本地渲染器）。
    """
    return await service.build_preview(session, source=source, object_id=id, user_id=user.id)


@router.get("/file/{token}")
async def get_preview_file(token: str) -> Response:
    """一次性令牌文件回拉（DS 容器匿名访问；FR-03）。

    无 JWT——安全性完全由令牌承担（HS256 + 5min TTL + redis jti 一次性）。
    """
    settings = get_settings()
    object_key = await service.consume_file_token(token, settings=settings)

    backend = get_storage_backend()

    async def stream() -> AsyncIterator[bytes]:
        async for chunk in backend.get_object_stream(object_key):
            yield chunk

    # 原文件走 octet-stream（DS 自带文件名）；LO 转换的 PDF 必须给真 MIME——
    # 浏览器对 octet-stream blob 不做内联渲染，iframe 会触发下载（ql-20260826-012）。
    media = (
        "application/pdf" if object_key.startswith("preview-pdf/") else "application/octet-stream"
    )
    return StreamingResponse(
        stream(),
        media_type=media,
        headers={
            "Content-Disposition": 'inline; filename="preview"',
            "Cache-Control": "no-store",
        },
    )


# PreviewOfficeDisabled 供 OpenAPI/前端类型感知（503 语义在 service 定义）。
_ = PreviewOfficeDisabled
