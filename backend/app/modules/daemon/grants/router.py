"""平台共享智能体端点（task-04 / design §5 Phase 3 / §7）。

本文件**只定义不挂载**：task-07 在 ``daemon/router.py`` 仿 audit_router 先例
include 本 router（daemon 父 router 自带 ``prefix="/daemon"``、main 挂 ``/api``，
落地完整路径 ``/api/daemon/shared-agents`` 系列）。故本 router 照同模块子 router
（change_write_router.py / audit/router.py）的写法**不带 prefix**，路径段从
``/shared-agents`` 起。

鉴权：
- 管理端点（GET/POST/PATCH/DELETE ``/shared-agents``）：``require_platform_admin``
  （app/core/auth_deps.py，非 admin 403）；
- ``GET /shared-agents/active``：任意登录用户（``get_current_user``），仅返回
  生效摘要（不含停用行），供会话选择器与守护进程页管理卡消费。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_platform_admin
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.daemon.grants import service
from app.modules.daemon.grants.schema import (
    SharedAgentActiveView,
    SharedAgentCreateRequest,
    SharedAgentCreateResponse,
    SharedAgentPatchRequest,
    SharedAgentView,
)

router = APIRouter(tags=["daemon"])


@router.get("/shared-agents", response_model=list[SharedAgentView])
async def list_shared_agents(
    session: Annotated[AsyncSession, Depends(get_session)],
    _admin: Annotated[User, Depends(require_platform_admin)],
) -> list[SharedAgentView]:
    """管理端全量列表（含停用行）。"""
    rows = await service.list_shared_agents(session)
    return [SharedAgentView.model_validate(row) for row in rows]


@router.post(
    "/shared-agents",
    response_model=SharedAgentCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_shared_agent(
    payload: SharedAgentCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_platform_admin)],
) -> SharedAgentCreateResponse:
    """创建平台共享智能体（五重校验：D-003 runtime 归属+在线 / D-002@v2 writable_dir ⊆
    allowed_roots / 源码工作区存在 / R-05 档案显式升级 / D-008 唯一防重复）。

    ``visibility_promoted=true`` 时表示档案可见性已随本次创建显式升级为 platform
    （R-05「在响应中提示升级结果」）。
    """
    grant, promoted = await service.create_shared_agent(
        session, admin_user_id=admin.id, payload=payload
    )
    resp = SharedAgentCreateResponse.model_validate(grant)
    resp.visibility_promoted = promoted
    return resp


@router.get("/shared-agents/active", response_model=list[SharedAgentActiveView])
async def list_active_shared_agents(
    session: Annotated[AsyncSession, Depends(get_session)],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[SharedAgentActiveView]:
    """生效摘要（任意登录用户）：仅 enabled 行 + 档案显示字段 + runtime 在线状态。"""
    return await service.list_active_shared_agents(session)


@router.patch("/shared-agents/{grant_id}", response_model=SharedAgentView)
async def patch_shared_agent(
    grant_id: uuid.UUID,
    payload: SharedAgentPatchRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    _admin: Annotated[User, Depends(require_platform_admin)],
) -> SharedAgentView:
    """停用/启用共享智能体（仅改 enabled；停用后 active 不再返回该行）。"""
    grant = await service.set_shared_agent_enabled(
        session, grant_id=grant_id, enabled=payload.enabled
    )
    return SharedAgentView.model_validate(grant)


@router.delete("/shared-agents/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shared_agent(
    grant_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    _admin: Annotated[User, Depends(require_platform_admin)],
) -> None:
    """删除共享智能体（物理删行；档案 visibility 不回滚——升级是独立的管理动作）。"""
    await service.delete_shared_agent(session, grant_id=grant_id)
