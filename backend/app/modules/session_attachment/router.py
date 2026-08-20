"""session_attachment router——附件上传/读取/删除端点（task-03 + task-04）。

挂载：main.py ``include_router(session_attachment_router, prefix="/api")`` →
实际路径 ``/api/daemon/session-attachments``（本 router 自带
``prefix="/daemon/session-attachments"``，齐 daemon 路由先例）。

鉴权：``get_current_user``（同 file 模块上传先例）；归属校验按 ``user_id``
过滤（404 隐藏语义，不泄露存在性）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, Response, UploadFile
from fastapi import File as FastAPIFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.storage.factory import get_storage_backend

from .model import SessionAttachment
from .schema import AttachmentKind, AttachmentRead
from .service import SessionAttachmentService
from .storage import SessionAttachmentStorage

log = get_logger(__name__)

router = APIRouter(prefix="/daemon/session-attachments", tags=["session-attachments"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _make_storage() -> SessionAttachmentStorage:
    return SessionAttachmentStorage(get_storage_backend())


@router.post("", response_model=AttachmentRead, status_code=201)
async def upload_attachment(
    session: SessionDep,
    storage: Annotated[SessionAttachmentStorage, Depends(_make_storage)],
    current_user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, FastAPIFile()],
    kind: Annotated[AttachmentKind, Form()] = "image",
) -> AttachmentRead:
    """上传会话附件（multipart：file + kind 表单；FR-1/FR-3/FR-8）。

    成功即建草稿行（session_id NULL）；限制校验（大小/白名单/PIL magic）
    在 service 抛 413/415（AppError 惯例同 file 模块）。
    """
    service = SessionAttachmentService(session, storage)
    data = await file.read()
    return await service.upload(
        user_id=current_user.id,
        kind=kind,
        name=file.filename or "unnamed",
        media_type=file.content_type or "application/octet-stream",
        data=data,
    )


# ── task-04：读取 / 删除（FR-6 / FR-8；D-8 生命周期）───────────────────────


class SessionAttachmentNotFound(AppError):
    """附件不存在 / 非本人所有（404，不泄露存在性）。"""

    code = "HTTP_404_SESSION_ATTACHMENT_NOT_FOUND"
    http_status = 404


class SessionAttachmentBound(AppError):
    """已绑定消息的附件不可删（409；design §10 bound 终态只读）。"""

    code = "HTTP_409_SESSION_ATTACHMENT_BOUND"
    http_status = 409


async def _get_owned_attachment(
    session: AsyncSession, attachment_id: uuid.UUID, user_id: uuid.UUID
) -> SessionAttachment:
    row = (
        await session.execute(
            select(SessionAttachment).where(
                SessionAttachment.id == attachment_id,
                SessionAttachment.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise SessionAttachmentNotFound(
            "附件不存在或无权访问。",
            details={"attachment_id": str(attachment_id)},
        )
    return row


@router.get("/{attachment_id}/content")
async def get_attachment_content(
    attachment_id: uuid.UUID,
    session: SessionDep,
    storage: Annotated[SessionAttachmentStorage, Depends(_make_storage)],
    current_user: Annotated[User, Depends(get_current_user)],
    if_none_match: str | None = None,
) -> Response:
    """流式回附件字节（历史回显/预览/daemon 回拉；FR-6）。

    内容寻址不可变 → ``Cache-Control: immutable`` + ETag=sha256 + If-None-Match
    命中短路 304（同对象二次拉取零字节）；展示名走 RFC 5987（中文兼容）。
    """
    row = await _get_owned_attachment(session, attachment_id, current_user.id)
    etag = f'"{row.sha256}"'
    base_headers = {
        "Cache-Control": "private, max-age=31536000, immutable",
        "ETag": etag,
    }
    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=304, headers=base_headers)

    backend = get_storage_backend()

    async def stream() -> AsyncIterator[bytes]:
        async for chunk in backend.get_object_stream(row.object_key):
            yield chunk

    filename_star = quote(row.name)
    return StreamingResponse(
        stream(),
        media_type=row.media_type or "application/octet-stream",
        headers={
            **base_headers,
            "Content-Disposition": f"inline; filename*=UTF-8''{filename_star}",
        },
    )


@router.delete("/{attachment_id}", status_code=204)
async def delete_attachment(
    attachment_id: uuid.UUID,
    session: SessionDep,
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """删除草稿附件（仅 session_id NULL；bound 409；FR-8）。

    只删行不删对象（D-5：内容寻址对象可能共享，V1 孤儿由清理任务兜）。
    """
    row = await _get_owned_attachment(session, attachment_id, current_user.id)
    if row.session_id is not None:
        raise SessionAttachmentBound(
            "附件已随消息发送，不可删除。",
            details={"attachment_id": str(attachment_id)},
        )
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
