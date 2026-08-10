"""platform_sync router — 进度同步层 3 端点（契约 sillyhub-progress-sync-contract.md）。

- POST /changes/{name}/progress：上行 progress + §4.2 base_ts 冲突检测（200/409）
- GET /changes：轻量列表（裸数组）
- GET /changes/{name}/progress：完整 JSON（裸六表 + 顶层 last_pushed_at，404）

router **不自带 prefix**，路径在路由内写全（``/changes/...``）；main 挂 ``prefix="/api"``
落地 ``/api/changes/...``。不自带 prefix 是为了避开 FastAPI 对 ``GET /changes`` 的
尾斜杠 redirect（307）——客户端 ``sync.js:543`` 打无尾斜杠 ``/api/changes``。
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.platform_sync.auth import require_platform_sync
from app.modules.platform_sync.schema import (
    ChangeListItem,
    ConflictResponse,
    ProgressSyncOk,
)
from app.modules.platform_sync.service import PlatformSyncService

router = APIRouter(tags=["platform-sync"])


def _header(request: Request, name: str) -> str | None:
    """读 ``X-SillySpec-*`` header，缺失/空均视为 None（契约 §4.1 / D-005 零回归）。"""
    value = request.headers.get(name)
    return value if value else None


@router.post("/changes/{name}/progress")
async def push_progress(
    name: str,
    request: Request,
    body: dict[str, Any],
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: Annotated[User, Depends(require_platform_sync)],
) -> Any:
    """POST 上行 progress + base_ts 冲突检测（契约 §4）。

    读 3 个 ``X-SillySpec-*`` header（User/Base-Ts/Pushed-At，缺失/空均 None）。
    200=接受（客户端据此更新 platform_last_sync）；409=冲突（body
    ``{conflict, platform_progress, last_pushed_at}``，客户端写冲突文件走 resolve）。
    body 是裸 ``serializeForSync`` 六表 JSON（NG-6 透传，不强类型校验）。
    """
    base_ts = _header(request, "X-SillySpec-Base-Ts")
    pushed_at = _header(request, "X-SillySpec-Pushed-At")
    user = _header(request, "X-SillySpec-User")
    result = await PlatformSyncService(session).upsert_progress(
        name=name,
        body=body,
        base_ts=base_ts,
        pushed_at=pushed_at,
        user=user,
    )
    if result.conflict:
        # 409 必须返回正确状态码 + 契约 §4.4 body（客户端 fetchJsonWithStatus 读
        # res.status==409 + res.body.platform_progress，sync.js:314-318）。
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=ConflictResponse(
                conflict=True,
                platform_progress=result.platform_progress or {},
                last_pushed_at=result.last_pushed_at,
            ).model_dump(),
        )
    return ProgressSyncOk()


@router.get("/changes")
async def list_changes(
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: Annotated[User, Depends(require_platform_sync)],
) -> list[ChangeListItem]:
    """GET 轻量 change 列表（契约 §5，裸数组形态 D-007）。"""
    items = await PlatformSyncService(session).list_lightweight()
    return [ChangeListItem(**it) for it in items]


@router.get("/changes/{name}/progress")
async def get_progress(
    name: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: Annotated[User, Depends(require_platform_sync)],
) -> Any:
    """GET 单 change 完整 progress JSON（契约 §6，裸六表 + 顶层 last_pushed_at）。

    不存在 → 404（客户端 fetchJson 返回 null 降级不阻断，契约 §8/§10）。
    """
    progress = await PlatformSyncService(session).get_progress(name)
    if progress is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="change progress not found",
        )
    return progress
