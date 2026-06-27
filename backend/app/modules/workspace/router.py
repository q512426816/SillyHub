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

from app.core.auth_deps import require_permission, require_permission_any
from app.core.db import get_session
from app.core.errors import PermissionDenied
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import allowed_workspace_ids, has_permission
from app.modules.workspace.model import Workspace
from app.modules.workspace.relation_schema import (
    RelationCreate,
    RelationListResponse,
    RelationRead,
    TopologyResponse,
)
from app.modules.workspace.relation_service import RelationService
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
from app.modules.workspace.topology import TopologyBuilder

router = APIRouter(prefix="/workspaces", tags=["workspace"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _require_server_local_workspace_admin(
    session: AsyncSession,
    user: User,
) -> None:
    """server-local 路径会读 backend 宿主机文件系统，需 workspace:admin。"""
    if user.is_platform_admin:
        return
    ok = await has_permission(
        session,
        user=user,
        permission=Permission.WORKSPACE_ADMIN,
        workspace_id=None,
    )
    if not ok:
        raise PermissionDenied(
            "server-local workspace path requires workspace:admin permission.",
            details={"required_permission": Permission.WORKSPACE_ADMIN.value},
        )


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
    await _require_server_local_workspace_admin(session, user)
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
    # FR-06 / D-003@v1：daemon-client 分支（跳过本地 _guard_path，派 scan 给绑定 daemon）
    if service._is_daemon_client_payload(payload):
        assert payload.daemon_runtime_id is not None  # task-01 validator 保证
        workspace_id, agent_run_id = await service.scan_generate_daemon_client(
            root_path=payload.root_path,
            user_id=user.id,
            daemon_runtime_id=payload.daemon_runtime_id,
            agent_service=agent_service,
            provider=payload.provider,
            model=payload.model,
            spec_strategy=payload.spec_strategy,
        )
        return ScanGenerateResponse(
            workspace_id=workspace_id,
            agent_run_id=agent_run_id,
        )
    await _require_server_local_workspace_admin(session, user)
    workspace_id, agent_run_id = await service.scan_generate(
        root_path=payload.root_path,
        user_id=user.id,
        agent_service=agent_service,
        provider=payload.provider,
        model=payload.model,
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
    if payload.path_source != "daemon-client":
        await _require_server_local_workspace_admin(session, user)
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


@router.get("/{workspace_id}/relations", response_model=RelationListResponse)
async def list_relations(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_READ))],
) -> RelationListResponse:
    """List all outgoing + incoming relations for a workspace."""
    service = RelationService(session)
    return await service.list_for_workspace(workspace_id)


@router.post(
    "/{workspace_id}/relations",
    response_model=RelationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_relation(
    workspace_id: uuid.UUID,
    payload: RelationCreate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> RelationRead:
    """Create a relation. source_id = workspace_id from path."""
    service = RelationService(session)
    relation = await service.create(workspace_id, payload)
    return RelationRead.model_validate(relation)


@router.delete(
    "/relations/{relation_id}",
    response_model=RelationRead,
    status_code=status.HTTP_200_OK,
)
async def delete_relation(
    relation_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_ADMIN))],
) -> RelationRead:
    """Delete a relation by id."""
    service = RelationService(session)
    relation = await service.delete(relation_id)
    return RelationRead.model_validate(relation)


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
    """Generate projects/*.yaml from _module-map.yaml and reparse into child workspaces."""
    service = WorkspaceService(session)
    return await service.generate_projects(workspace_id)


@router.post("/{workspace_id}/reparse")
async def reparse_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> dict:
    """Parse projects/*.yaml under a parent Workspace and sync children + relations."""
    service = WorkspaceService(session)
    _parse_result, stats, children, relations = await service.reparse(workspace_id)
    return {
        **stats,
        "children": [
            {
                "id": str(c.id),
                "name": c.name,
                "component_key": c.component_key,
                "slug": c.slug,
            }
            for c in children
        ],
        "relations": [
            {
                "id": str(r.id),
                "source_id": str(r.source_id),
                "target_id": str(r.target_id),
                "relation_type": r.relation_type,
            }
            for r in relations
        ],
    }


@router.delete(
    "/{workspace_id}",
    response_model=WorkspaceRead,
    status_code=status.HTTP_200_OK,
)
async def delete_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> WorkspaceRead:
    service = WorkspaceService(session)
    return WorkspaceRead.model_validate(await service.soft_delete(workspace_id))


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
