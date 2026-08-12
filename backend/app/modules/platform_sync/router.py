"""platform_sync router — 进度同步层 3 端点（契约 sillyhub-progress-sync-contract.md）。

- POST /changes/{name}/progress：上行 progress + §4.2 base_ts 冲突检测（200/409）
- GET /changes：轻量列表（裸数组，按 token 派生 workspace 过滤）
- GET /changes/{name}/progress：完整 JSON（裸六表 + 顶层 last_pushed_at，404）

router **不自带 prefix**，路径在路由内写全（``/changes/...``）；main 挂 ``prefix="/api"``
落地 ``/api/changes/...``。不自带 prefix 是为了避开 FastAPI 对 ``GET /changes`` 的
尾斜杠 redirect（307）——客户端 ``sync.js:543`` 打无尾斜杠 ``/api/changes``。

Change 2026-08-11-change-progress-projection task-07：3 端点从 require_platform_sync
解包 ``(user, workspace_id)``，透传 workspace_id 给 service 做收件箱隔离（shpsync_ token
派生工作区；shk_live_/JWT 过渡期 None 走全局聚合 fallback）。
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.platform_sync.auth import require_platform_sync
from app.modules.platform_sync.schema import (
    ChangeApprovalResponse,
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
    auth: Annotated[tuple[User, uuid.UUID | None], Depends(require_platform_sync)],
) -> Any:
    """POST 上行 progress + base_ts 冲突检测（契约 §4）。

    读 3 个 ``X-SillySpec-*`` header（User/Base-Ts/Pushed-At，缺失/空均 None）。
    200=接受（客户端据此更新 platform_last_sync）；409=冲突（body
    ``{conflict, platform_progress, last_pushed_at}``，客户端写冲突文件走 resolve）。
    body 是裸 ``serializeForSync`` 六表 JSON（NG-6 透传，不强类型校验）。

    workspace_id 从 require_platform_sync 派生（shpsync_ token 绑定工作区；shk_live_/JWT
    过渡期 None 走全局聚合 fallback），透传 service 做收件箱隔离（task-06/07）。
    """
    _user, workspace_id = auth
    base_ts = _header(request, "X-SillySpec-Base-Ts")
    pushed_at = _header(request, "X-SillySpec-Pushed-At")
    user = _header(request, "X-SillySpec-User")
    result = await PlatformSyncService(session).upsert_progress(
        workspace_id=workspace_id,
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
    auth: Annotated[tuple[User, uuid.UUID | None], Depends(require_platform_sync)],
) -> list[ChangeListItem]:
    """GET 轻量 change 列表（契约 §5，裸数组形态 D-007，按 token 派生 workspace 过滤）。"""
    _user, workspace_id = auth
    items = await PlatformSyncService(session).list_lightweight(workspace_id=workspace_id)
    return [ChangeListItem(**it) for it in items]


@router.get("/changes/{name}/progress")
async def get_progress(
    name: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: Annotated[tuple[User, uuid.UUID | None], Depends(require_platform_sync)],
) -> Any:
    """GET 单 change 完整 progress JSON（契约 §6，裸六表 + 顶层 last_pushed_at）。

    不存在/跨 workspace → 404（客户端 fetchJson 返回 null 降级不阻断，契约 §8/§10）。
    """
    _user, workspace_id = auth
    progress = await PlatformSyncService(session).get_progress(workspace_id, name)
    if progress is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="change progress not found",
        )
    return progress


@router.get("/changes/{name}/approval")
async def get_approval(
    name: str,
    auth: Annotated[tuple[User, uuid.UUID | None], Depends(require_platform_sync)],
) -> ChangeApprovalResponse:
    """GET 单 change 审批状态——给 sillyspec CLI execute 审批门控用（ql-20260812-001-6eb8）。

    CLI ``sync.js checkApproval`` 在 execute 启动时 GET 此端点，读 ``status``：
    rejected/pending 阻断 execute，其他（approved）放行（command.js:1071-1080）。

    **不查库、不因 change 不存在 404**：change 可能尚未上行 progress（execute 前），
    若 404 CLI 会 fetchJson→null→误判 pending 卡死（与本端点放行初衷相悖）。当前后端
    无审批策略 → 所有 change 默认 ``approved`` 放行。鉴权失败仍 401（require_platform_sync）。
    """
    return ChangeApprovalResponse(
        status="approved",
        reason="no approval policy configured; auto-approved",
    )
