"""deploy_records API endpoints（只读，零写端点——D-004@v1）。

change 2026-10-14-deploy-release-notes task-02 / FR-02/FR-03。
平台级端点（无 workspace 路径前缀，聚合全部 workspace），鉴权走
``require_permission_any``（无 ws_id 的 API 惯例，auth_deps.py 注释口径；
``require_permission`` 隐式 ``Path workspace_id`` 依赖会 422）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.deploy_records.schema import DeployRecordDetail, DeployRecordSummary
from app.modules.deploy_records.service import DeployRecordService

router = APIRouter(tags=["deploy-records"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/deploy-records",
    response_model=list[DeployRecordSummary],
)
async def list_deploy_records(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_RECORD_READ))],
) -> list[DeployRecordSummary]:
    """全部 workspace 的部署发布记录列表（按 deployed_at 倒序）。"""
    svc = DeployRecordService(session)
    return await svc.list_records()


@router.get(
    "/deploy-records/{record_id:path}",
    response_model=DeployRecordDetail,
)
async def get_deploy_record(
    record_id: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_RECORD_READ))],
) -> DeployRecordDetail:
    """单条发布记录详情（元数据 + md 正文原文）。

    ``record_id`` 形如 ``<workspace_id>/<file_stem>``（含 ``/``，路由用
    ``:path`` 形态整段接收——R-06 定型）。
    """
    svc = DeployRecordService(session)
    return await svc.get_record(record_id)
