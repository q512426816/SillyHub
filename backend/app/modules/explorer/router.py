"""HTTP routes for the explorer module — 工作区文件浏览器（只读）四端点。

「浏览器 → backend → daemon → 宿主机磁盘」只读浏览链路的 HTTP 层（design §7.2）：

- 四 GET 端点统一 ``require_permission(Permission.WORKSPACE_READ)`` 门控，
  依赖形态沿用 spec_workspace/router.py 先例（``Annotated[User, Depends(...)]``）；
- 显式超时与全量错误映射（AppError 子类中文文案）已在 service 层收口
  （task-02），router 直接抛出、不二次映射；
- download 端点把 service 返回的 base64 content 解码为字节，以
  ``StreamingResponse`` + RFC 5987 ``filename*`` 头回传（中文名/特殊字符名
  不炸头；file/router.py ``download_file`` 同款写法），截断时附 ``X-Truncated``。

设计依据：``.sillyspec/changes/2026-08-18-workspace-file-browser/design.md``
（§7.2 端点表与错误映射 / R-04 显式超时）。
"""

from __future__ import annotations

import base64
import binascii
import io
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.explorer.schema import (
    ExplorerFileResponse,
    ExplorerSearchResponse,
    ExplorerTreeResponse,
)
from app.modules.explorer.service import ExplorerContractGap, ExplorerService

router = APIRouter(
    prefix="/workspaces/{workspace_id}/explorer",
    tags=["explorer"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/tree", response_model=ExplorerTreeResponse)
async def get_explorer_tree(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    path: str = Query(default="", description="相对工作区根的目录路径，空 = 根"),
) -> ExplorerTreeResponse:
    """列目录（懒加载逐层；design §7.2 GET /tree，RPC 超时 30s）。"""
    service = ExplorerService(session)
    return await service.list_tree(workspace_id, user.id, path)


@router.get("/file", response_model=ExplorerFileResponse)
async def get_explorer_file(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    path: str = Query(min_length=1, description="相对工作区根的文件路径"),
) -> ExplorerFileResponse:
    """读文件预览（encoding=utf8；design §7.2 GET /file，RPC 超时 30s）。"""
    service = ExplorerService(session)
    return await service.read_file(workspace_id, user.id, path)


@router.get("/download")
async def download_explorer_file(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    path: str = Query(min_length=1, description="相对工作区根的文件路径"),
) -> StreamingResponse:
    """下载文件（encoding=base64 强制；design §7.2 GET /download，RPC 超时 60s）。"""
    service = ExplorerService(session)
    dl = await service.download(workspace_id, user.id, path)
    try:
        content = base64.b64decode(dl.content_b64, validate=True)
    except binascii.Error as exc:
        # daemon 返回不合法 base64 = 契约缺口（CONTRACT_GAP），显式上报而非 500。
        raise ExplorerContractGap(
            "守护进程返回的文件内容不是合法的 base64 数据，请升级 daemon 后重试。",
            details={"workspace_id": str(workspace_id), "path": path},
        ) from exc
    # RFC 5987：filename* 承载中文名，filename 给 ASCII 回退（file/router.py 同款）。
    ascii_name = dl.filename.encode("ascii", "ignore").decode() or "file"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(dl.filename)}"
    headers = {
        "Content-Disposition": disposition,
        # Content-Length 必须等于实际 body 字节数——truncated 时 dl.size 是
        # 原文件大小而 body 只有截断后的字节，按 size 写头会让客户端读错位。
        "Content-Length": str(len(content)),
    }
    if dl.truncated:
        headers["X-Truncated"] = "true"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/octet-stream",
        headers=headers,
    )


@router.get("/search", response_model=ExplorerSearchResponse)
async def search_explorer(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    q: str = Query(min_length=1, description="文件名/目录名关键词（大小写不敏感子串）"),
) -> ExplorerSearchResponse:
    """按文件名全树搜索（design §7.2 GET /search，RPC 超时 60s；空关键词 422）。"""
    service = ExplorerService(session)
    return await service.search(workspace_id, user.id, q)
