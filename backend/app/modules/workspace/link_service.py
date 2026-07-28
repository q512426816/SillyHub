"""PPM 项目 ↔ 工作区 关联表级逻辑(权限无关)。

change ``2026-07-28-ppm-project-link-workspace`` A 阶段 task-04 / design §5 Phase2。
封装 ``ppm_project_workspace`` 关联表的 bind/unbind/list,供工作区侧
(:mod:`app.modules.workspace.link_router`)与项目侧(``ppm/project/router.py``)
两个 router 复用——操作同一张表,数据自动一致(双边对称)。

边界:
- bind 前校验 PPM 项目 / 工作区存在(不存在 → 404),已绑定 → 409(复合主键天然防重);
- 不绑定到软删除工作区(``deleted_at IS NULL`` 校验,R4);
- list 过滤软删除工作区(FR-06 / AC-4);
- 权限校验在 router 层(本模块权限无关)。

仅读 ``ppm_project_maintenance`` 做存在性校验,不碰 PPM 现有业务逻辑(零侵入)。
"""

from __future__ import annotations

import uuid

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.workspace.model import PpmProjectWorkspace, Workspace
from app.modules.workspace.schema import PpmProjectBrief, WorkspaceBrief


async def _get_active_workspace(session: AsyncSession, workspace_id: uuid.UUID) -> Workspace | None:
    """取工作区(过滤软删除)。软删除/不存在均返回 None → bind 时统一 404。"""
    stmt = (
        select(Workspace)
        .where(col(Workspace.id) == workspace_id)
        .where(col(Workspace.deleted_at).is_(None))
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def bind(
    session: AsyncSession,
    *,
    ppm_project_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> PpmProjectWorkspace:
    """绑定 PPM 项目 ↔ 工作区。

    先校验两者存在(404),再查重(409),最后 insert。复合主键天然防重复绑定,
    显式查重让重复走 409 而非 FK/唯一约束 500(FR-04 / R5)。
    """
    project = await session.get(PpmProjectMaintenance, ppm_project_id)
    if project is None:
        raise AppError(
            "PPM project does not exist.",
            code="HTTP_404_PPM_PROJECT_NOT_FOUND",
            http_status=status.HTTP_404_NOT_FOUND,
        )
    workspace = await _get_active_workspace(session, workspace_id)
    if workspace is None:
        raise AppError(
            "Workspace does not exist or has been deleted.",
            code="HTTP_404_WORKSPACE_NOT_FOUND",
            http_status=status.HTTP_404_NOT_FOUND,
        )
    existing = await session.get(PpmProjectWorkspace, (ppm_project_id, workspace_id))
    if existing is not None:
        raise AppError(
            "PPM project and workspace are already linked.",
            code="HTTP_409_PPM_PROJECT_LINK_DUPLICATE",
            http_status=status.HTTP_409_CONFLICT,
        )
    link = PpmProjectWorkspace(ppm_project_id=ppm_project_id, workspace_id=workspace_id)
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return link


async def unbind(
    session: AsyncSession,
    *,
    ppm_project_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> None:
    """解绑 PPM 项目 ↔ 工作区。

    幂等:关联不存在时静默返回(DELETE 语义),router 统一回 204。
    """
    link = await session.get(PpmProjectWorkspace, (ppm_project_id, workspace_id))
    if link is not None:
        await session.delete(link)
        await session.commit()


async def list_by_workspace(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
) -> list[PpmProjectBrief]:
    """列出工作区关联的 PPM 项目(工作区软删除则返回空)。"""
    stmt = (
        select(PpmProjectMaintenance)
        .join(
            PpmProjectWorkspace,
            PpmProjectWorkspace.ppm_project_id == PpmProjectMaintenance.id,
        )
        .join(Workspace, Workspace.id == PpmProjectWorkspace.workspace_id)
        .where(col(PpmProjectWorkspace.workspace_id) == workspace_id)
        .where(col(Workspace.deleted_at).is_(None))
    )
    projects = (await session.execute(stmt)).scalars().all()
    return [
        PpmProjectBrief(
            project_id=p.id,
            project_name=p.project_name,
            project_status=p.project_status,
        )
        for p in projects
    ]


async def list_by_project(
    session: AsyncSession,
    *,
    ppm_project_id: uuid.UUID,
) -> list[WorkspaceBrief]:
    """列出项目关联的工作区(过滤软删除工作区,FR-06 / AC-4)。"""
    stmt = (
        select(Workspace)
        .join(
            PpmProjectWorkspace,
            PpmProjectWorkspace.workspace_id == Workspace.id,
        )
        .where(col(PpmProjectWorkspace.ppm_project_id) == ppm_project_id)
        .where(col(Workspace.deleted_at).is_(None))
    )
    workspaces = (await session.execute(stmt)).scalars().all()
    return [
        WorkspaceBrief(
            workspace_id=w.id,
            name=w.name,
            status=w.status,
            type=w.type,
        )
        for w in workspaces
    ]
