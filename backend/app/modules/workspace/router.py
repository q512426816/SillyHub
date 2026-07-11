"""HTTP routes for the workspace module.

Authentication / authorization (task-04a auth slice).\n
All workspace endpoints are protected via ``get_current_user`` and RBAC\n
permissions from ``references/16-rbac.md``.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import allowed_workspace_ids
from app.modules.workspace.component_catalog_service import (
    ComponentCatalogService,
    ComponentListResponse,
)
from app.modules.workspace.member_runtimes.router import MemberBindingView, _to_view
from app.modules.workspace.member_runtimes.service import list_my_bindings
from app.modules.workspace.model import Workspace
from app.modules.workspace.scanner import ScanResult
from app.modules.workspace.schema import (
    OwnerRead,
    ScanGenerateRequest,
    ScanGenerateResponse,
    ScanRequest,
    ScanResponse,
    WorkspaceCreate,
    WorkspaceListResponse,
    WorkspaceRead,
    WorkspaceStructureDTO,
    WorkspaceUpdate,
)
from app.modules.workspace.service import WorkspaceService
from app.modules.workspace.skills_view_service import (
    McpConfigViewResponse,
    SkillsViewResponse,
    SkillsViewService,
)
from app.modules.workspace.topology import TopologyBuilder, TopologyResponse

router = APIRouter(prefix="/workspaces", tags=["workspace"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _build_scan_response(result: ScanResult) -> ScanResponse:
    return ScanResponse(
        root_path=result.root_path,
        is_sillyspec=result.is_sillyspec,
        sillyspec_path=result.sillyspec_path if result.is_sillyspec else None,
        structure=WorkspaceStructureDTO(**result.structure.as_dict()),
        warnings=list(result.warnings),
    )


def _build_owner_read(workspace: Workspace, owner: User | None) -> OwnerRead | None:
    """Nested owner DTO (task-05 / D-006@v1).

    ``owner`` 来自 created_by JOIN users；JOIN 不到（user 行缺失）时退化成只
    带 user_id 的 OwnerRead，避免丢弃 workspace。
    """
    if owner is not None:
        return OwnerRead(
            user_id=owner.id,
            email=owner.email,
            display_name=owner.display_name,
        )
    if workspace.created_by is not None:
        return OwnerRead(user_id=workspace.created_by)
    return None


def _workspace_read_with_owner(workspace: Workspace, owner: User | None) -> WorkspaceRead:
    read = WorkspaceRead.model_validate(workspace)
    return read.model_copy(update={"owner": _build_owner_read(workspace, owner)})


@router.post("/scan", response_model=ScanResponse)
async def scan_workspace(
    payload: ScanRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> ScanResponse:
    service = WorkspaceService(session)
    return _build_scan_response(service.scan(payload.root_path))


@router.post("/scan-generate", response_model=ScanGenerateResponse)
async def scan_generate(
    payload: ScanGenerateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> ScanGenerateResponse:
    from app.modules.agent.service import AgentService

    agent_service = AgentService(session)
    service = WorkspaceService(session)
    # daemon-client 唯一入口（2026-07-10-remove-server-local-workspace-mode）：
    # daemon_id 透传作为稳定绑定键，scan-generate 内部建 member binding 行。
    workspace_id, agent_run_id = await service.scan_generate(
        root_path=payload.root_path,
        user_id=user.id,
        agent_service=agent_service,
        provider=payload.provider,
        model=payload.model,
        spec_strategy=payload.spec_strategy,
        daemon_id=payload.daemon_id,
    )
    return ScanGenerateResponse(
        workspace_id=workspace_id,
        agent_run_id=agent_run_id,
    )


@router.post(
    "",
    response_model=WorkspaceRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace(
    payload: WorkspaceCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    workspace = await service.create(payload, created_by=user.id)
    return WorkspaceRead.model_validate(workspace)


@router.post("/{workspace_id}/activate", response_model=WorkspaceRead)
async def activate_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    workspace = await service.activate(workspace_id)
    return WorkspaceRead.model_validate(workspace)


@router.get("/topology", response_model=TopologyResponse)
async def get_topology(
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.TOPOLOGY_READ))],
) -> TopologyResponse:
    """Return the full workspace topology graph."""
    return await TopologyBuilder.build(session)


@router.get("/my-bindings", response_model=list[MemberBindingView])
async def list_my_bindings_endpoint(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> list[MemberBindingView]:
    """Return the caller's member bindings across ALL workspaces.

    daemon-entity-binding：工作区列表卡片按 daemon 实体展示绑定信息，绑定一律存
    member binding 行（workspace_member_runtimes）。批量端点一次拉取当前用户全部
    binding，前端按 workspace_id 索引，避免列表 N 次请求。

    鉴权仅需登录（``get_current_user``）—— 返回行天然限定为调用者本人，
    无需逐 workspace 校验 WORKSPACE_READ；未加入任何 workspace 的用户返回空列表。
    """
    rows = await list_my_bindings(session, user_id=user.id)
    return [_to_view(r) for r in rows]


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_READ))],
    include_deleted: Annotated[bool, Query(description="Admin-only flag")] = False,
    q: Annotated[str | None, Query(max_length=200)] = None,
    workspace_type: Annotated[str | None, Query(alias="type", max_length=50)] = None,
    status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None,
    user_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkspaceListResponse:
    """List workspaces with server-side filter + pagination (task-05 / FR-01/02/04).

    平台管理员：全量（allowed_workspace_ids=None），可按 user_id 过滤 created_by。
    普通账号：allowed_workspace_ids 限制可见集合，user_id 参数被忽略。
    """
    service = WorkspaceService(session)
    if user.is_platform_admin:
        rows, total = await service.list_with_owner(
            include_deleted=include_deleted,
            limit=limit,
            offset=offset,
            q=q,
            workspace_type=workspace_type,
            status=status_filter,
            user_id=user_id,
            allowed_workspace_ids=None,
        )
    else:
        allowed = await allowed_workspace_ids(
            session, user_id=user.id, permission=Permission.WORKSPACE_READ
        )
        rows, total = await service.list_with_owner(
            include_deleted=include_deleted,
            limit=limit,
            offset=offset,
            q=q,
            workspace_type=workspace_type,
            status=status_filter,
            user_id=None,
            allowed_workspace_ids=allowed,
        )

    return WorkspaceListResponse(
        items=[_workspace_read_with_owner(ws, owner) for ws, owner in rows],
        total=total,
    )


@router.get("/{workspace_id}", response_model=WorkspaceRead)
async def get_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.get(workspace_id))


@router.post("/{workspace_id}/init")
async def init_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> dict:
    """Initialize the workspace for the current user (D-002/D-009).

    Ensures the spec workspace container exists, then dispatches an init-mode
    interactive lease to the member's daemon.  The daemon writes
    ``.sillyspec-platform.json`` to the member's local project directory and
    pulls the latest spec bundle.

    Returns the ``lease_id``, ``runtime_id``, and ``claim_token``.
    """
    from app.modules.agent.service import AgentService

    agent_service = AgentService(session)
    return await agent_service.start_init_dispatch(
        workspace_id=workspace_id,
        actor_user_id=user.id,
    )


@router.get("/{workspace_id}/components", response_model=ComponentListResponse)
async def list_components(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ComponentListResponse:
    """列出项目组的只读组件（一级子项目，D-001@V1，变更 2026-07-06-component-readonly-split）。

    组件不再是 workspaces 表的行——内部组件元数据从 ``projects/*.yaml`` 只读派生，
    无 workspace 身份，写端点天然无法作用其上。
    """
    service = ComponentCatalogService(session)
    components = await service.list_components(workspace_id)
    return ComponentCatalogService.to_response(components)


@router.get("/{workspace_id}/skills", response_model=SkillsViewResponse)
async def list_workspace_skills(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> SkillsViewResponse:
    """列出 workspace specDir/skills/ 下的自定义 skill 名 + 文件清单（只读）。

    task-06 / FR-07 / D-006：经 SpecPathResolver 定位 specDir，只读列目录。
    NFR-05：daemon-client 经 HostFsDelegate RPC 读；server-local 直接 Path 读。
    membership 校验由 ``require_permission(WORKSPACE_READ)`` + ``{workspace_id}`` 路径参数
    自动完成（非成员 403）。无 skills/ 子目录返回空列表不报错。
    """
    service = SkillsViewService(session)
    return await service.list_skills(workspace_id)


@router.get("/{workspace_id}/mcp-config", response_model=McpConfigViewResponse)
async def get_workspace_mcp_config(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> McpConfigViewResponse:
    """读 workspace specDir/.mcp.json（只读，env secret 脱敏）。

    task-06 / FR-08 / D-006：经 SpecPathResolver 定位 specDir，只读 ``.mcp.json``。
    NFR-05：daemon-client 经 HostFsDelegate RPC 读；server-local 直接 Path 读。
    env 中 token/key/secret/password 类字段遮蔽（D-008，复用 settings/router 的
    ``_redact_mcp_env``）。无文件返回空 ``{mcpServers: {}}`` 不报错。
    """
    service = SkillsViewService(session)
    return await service.get_mcp_config(workspace_id)


@router.post("/{workspace_id}/rescan", response_model=ScanResponse)
async def rescan_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ScanResponse:
    service = WorkspaceService(session)
    _, scan = await service.rescan(workspace_id)
    return _build_scan_response(scan)


@router.post("/{workspace_id}/generate-projects")
async def generate_projects(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> dict:
    """Generate projects/*.yaml from _module-map.yaml (一级粒度，只产 yaml)."""
    service = WorkspaceService(session)
    return await service.generate_projects(workspace_id)


@router.delete(
    "/{workspace_id}",
    response_model=WorkspaceRead,
    status_code=status.HTTP_200_OK,
)
async def delete_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.soft_delete(workspace_id, deleted_by=user.id))


@router.patch(
    "/{workspace_id}",
    response_model=WorkspaceRead,
    status_code=status.HTTP_200_OK,
)
async def update_workspace(
    workspace_id: uuid.UUID,
    payload: WorkspaceUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    ws = await service.update(workspace_id, payload)
    return WorkspaceRead.model_validate(ws)
