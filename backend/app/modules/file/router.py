"""file 模块 router — 平台级文件中心 HTTP API（/api/file）。

五端点：上传 / 下载预览 / 单条元数据 / 批量元数据 / 软删。
大小/类型校验在 service 抛 ``AppError``（413/415），未登录由 JWT 依赖抛 401，
统一经 ``register_exception_handlers`` 全局转响应。

D-009 预览安全契约：图片白名单 inline 预览，其余（含 svg/html）强制 attachment
下载；上传白名单已排除 text/html、image/svg+xml 等可渲染危险类型。

设计依据：design.md §D-003/D-009 + tasks/task-05.md。
"""

from __future__ import annotations

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, UploadFile
from fastapi import File as FastAPIFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.file.schema import BatchMetaRequest, FileMetaResp, FileUploadResp
from app.modules.file.service import FileService
from app.modules.storage.base import StorageBackend
from app.modules.storage.factory import get_storage_backend

router = APIRouter(tags=["file"])

# D-009：可安全 inline 预览的图片白名单；其余一律强制 attachment。
_INLINE_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})


def _make_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    storage: Annotated[StorageBackend, Depends(get_storage_backend)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> FileService:
    return FileService(session, storage, settings)


@router.post("/upload", response_model=FileUploadResp, status_code=201)
async def upload_file(
    service: Annotated[FileService, Depends(_make_service)],
    current_user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, FastAPIFile()],
    owner_type: Annotated[str, Query()] = "",
    owner_id: Annotated[uuid.UUID | None, Query()] = None,
) -> FileUploadResp:
    """上传文件（multipart）。query 传 owner_type/owner_id（新建可空，D-008）。"""
    data = await file.read()
    return await service.upload_file(
        original_name=file.filename or "unnamed",
        data=data,
        mime_type=file.content_type or "application/octet-stream",
        uploaded_by=current_user.id,
        owner_type=owner_type,
        owner_id=owner_id,
    )


@router.get("/{file_id}")
async def download_file(
    file_id: uuid.UUID,
    service: Annotated[FileService, Depends(_make_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """下载/预览文件流。图片白名单 inline，其余强制 attachment（D-009）。"""
    row, stream = await service.get_stream(file_id)
    disposition = "inline" if row.mime_type in _INLINE_IMAGE_TYPES else "attachment"
    # RFC 5987：filename* 承载中文名，filename 给 ASCII 回退。
    ascii_name = row.original_name.encode("ascii", "ignore").decode() or "file"
    cd = f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(row.original_name)}"
    return StreamingResponse(
        stream,
        media_type=row.mime_type,
        headers={"Content-Disposition": cd},
    )


@router.get("/{file_id}/meta", response_model=FileMetaResp)
async def get_file_meta(
    file_id: uuid.UUID,
    service: Annotated[FileService, Depends(_make_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FileMetaResp:
    """单条文件元数据。"""
    row = await service.get_meta(file_id)
    return FileMetaResp.model_validate(row)


@router.post("/batch-meta", response_model=list[FileMetaResp])
async def batch_file_meta(
    payload: BatchMetaRequest,
    service: Annotated[FileService, Depends(_make_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[FileMetaResp]:
    """批量文件元数据（前端回显用）。"""
    return await service.batch_meta(payload.ids)


@router.delete("/{file_id}", status_code=204)
async def delete_file(
    file_id: uuid.UUID,
    service: Annotated[FileService, Depends(_make_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """软删文件（置 deleted_at）。"""
    await service.soft_delete(file_id)
