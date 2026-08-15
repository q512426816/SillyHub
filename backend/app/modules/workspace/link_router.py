"""HTTP routes for PPM project ↔ workspace links (workspace dimension).

change ``2026-07-28-ppm-project-link-workspace`` A 阶段 task-05 / design §5 Phase2。
工作区维度 GET/POST/DELETE ``/workspaces/{workspace_id}/ppm-projects``,与项目维度
(``ppm/project/router.py``)操作同一张 ``ppm_project_workspace`` 表(双边对称,数据一致)。

仿 :mod:`app.modules.workspace.members_router`:
- 所有写操作(bind/unbind)经 ``require_permission(Permission.WORKSPACE_MEMBER_MANAGE)``;
- 列表(list)经 ``WORKSPACE_READ``;
- ``{workspace_id}`` 自动注入 RBAC 闭包(``app.core.auth_deps.require_permission`` 按
  ``Path(...)`` 提取,故本 router prefix 必须含该占位符)。
表级逻辑全部委托 :mod:`app.modules.workspace.link_service`,本模块不直接操作 DB。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AppError
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.workspace import link_service
from app.modules.workspace.schema import BindPpmProjectRequest, PpmProjectBrief

router = APIRouter(
    prefix="/workspaces/{workspace_id}/ppm-projects",
    tags=["workspace-ppm-links"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[PpmProjectBrief])
async def list_linked_projects(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[PpmProjectBrief]:
    """列出工作区关联的 PPM 项目(过滤软删除工作区,FR-06)。权限:工作区可见。"""
    return await link_service.list_by_workspace(session, workspace_id=workspace_id)


@router.post(
    "",
    response_model=PpmProjectBrief,
    status_code=status.HTTP_201_CREATED,
)
async def link_project(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: BindPpmProjectRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> PpmProjectBrief:
    """绑定 PPM 项目到本工作区。权限:工作区成员管理。

    重复绑定 409、目标项目不存在 404(由 link_service 抛)。回读 list 取带
    project_name/status 的摘要(link_service.bind 返回关联行,摘要需回查项目实体)。
    """
    await link_service.bind(
        session,
        ppm_project_id=payload.ppm_project_id,
        workspace_id=workspace_id,
    )
    linked = await link_service.list_by_workspace(session, workspace_id=workspace_id)
    for brief in linked:
        if brief.project_id == payload.ppm_project_id:
            return brief
    # 防御:bind 已提交成功,list 必含目标,理论不可达。
    raise AppError(
        "关联已创建但回读失败，请刷新列表查看。",
        code="internal_error",
        http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


@router.delete("/{ppm_project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_project(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    ppm_project_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> None:
    """解绑 PPM 项目。权限:工作区成员管理。幂等(不存在静默 204)。"""
    await link_service.unbind(
        session,
        ppm_project_id=ppm_project_id,
        workspace_id=workspace_id,
    )
    return None
