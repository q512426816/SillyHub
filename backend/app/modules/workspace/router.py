"""HTTP routes for the workspace module.

Authentication / authorization (task-04a auth slice).\n
All workspace endpoints are protected via ``get_current_user`` and RBAC\n
permissions from ``references/16-rbac.md``.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission, require_permission_any
from app.core.db import get_session
from app.core.errors import AppError
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import allowed_workspace_ids
from app.modules.workspace.component_catalog_service import (
    ComponentCatalogService,
    ComponentListResponse,
)
from app.modules.workspace.constants import WorkspaceTypeLiteral
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
    WorkspaceProbeItem,
    WorkspaceProbeRequest,
    WorkspaceRead,
    WorkspaceStructureDTO,
    WorkspaceUpdate,
)
from app.modules.workspace.service import WorkspaceService
from app.modules.workspace.skills_view_service import (
    McpConfigUpdateRequest,
    McpConfigViewResponse,
    SkillCreateRequest,
    SkillFileContentResponse,
    SkillFileWriteRequest,
    SkillFileWriteResponse,
    SkillMutationResponse,
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
    return _build_scan_response(await asyncio.to_thread(service.scan, payload.root_path))


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
    workspace_id, agent_run_id, session_id = await service.scan_generate(
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
        session_id=session_id,
    )


# 创建端点「复用/激活/复活」标记 → 用户可读提示（quick ql-20260803-003-cb34）。
_CREATION_NOTICE_TEXT: dict[str, str] = {
    "reused_active": (
        "该路径已存在活跃工作区，本次直接复用了它（未新建；传入的 daemon 绑定不会写入，"
        "如需绑定请进入工作区后在概览页配置）。"
    ),
    "activated_pending": "该路径已存在待激活工作区，本次已将其激活。",
    "resurrected": "该路径曾存在已删除的工作区，本次已复活原记录（含 daemon 绑定）。",
}


def _creation_notice(notice: dict[str, str]) -> str:
    return _CREATION_NOTICE_TEXT.get(notice.get("kind", ""), "")


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
    notice: dict[str, str] = {}
    workspace = await service.create(payload, created_by=user.id, notice=notice)
    ws_read = WorkspaceRead.model_validate(workspace)
    if notice:
        ws_read.creation_notice = _creation_notice(notice)
    return ws_read


@router.post("/probe", response_model=list[WorkspaceProbeItem])
async def probe_workspaces(
    payload: WorkspaceProbeRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> list[WorkspaceProbeItem]:
    """批量探测工作区 git 模式 + 绑定机器状态（task-10 / FR-03 / D-008@v2 / design §5.C）。

    弹层机器状态统一后端口径（任一成员 binding，含他人绑定，消除本人/他人
    binding 展示不一致 UB-2）：``git_mode/daemon_name/daemon_online`` 三字段与
    mission_status 的 scope_workspaces 完全同源——经
    ``orchestrator.collect_many_workspace_statuses``（ql-20260826-012 批量收集，
    3 条固定查询替代原逐 ws 4 条；条目组装与单 ws 路径共享函数，口径单一来源）
    + ``probe_workspace_git_mode``（task-02 三态探测）组装。

    只读无状态变化（design §7.5）；每次调用实时探测不缓存（R-02）；探测 RPC
    失败/未绑 daemon 归 ``unknown`` 不抛 5xx（fail-safe）。查无行的 workspace_id
    跳过不报错（与 collect_scope 无效 id 跳过同语义）。
    """
    from sqlalchemy import select

    from app.modules.agent.orchestrator import collect_many_workspace_statuses
    from app.modules.daemon.host_fs import new_host_fs_delegate

    # delegate per-request 构造 + 探测回调注入——与 mission_status 路由
    # （mcp_tools._mission_status_core）同款接线，三字段口径完全同源。
    delegate = new_host_fs_delegate(session)
    # ql-20260826-012：workspaces IN 一次取齐 + 批量状态收集（N ws 4N 条查询 →
    # 3 条固定查询）；空列表 in_([]) 恒空结果，天然短路。
    workspaces = (
        (await session.execute(select(Workspace).where(Workspace.id.in_(payload.workspace_ids))))
        .scalars()
        .all()
    )
    entries = await collect_many_workspace_statuses(
        session, list(workspaces), git_probe=delegate.probe_workspace_git_mode
    )
    entry_by_id = {uuid.UUID(entry["id"]): entry for entry in entries}
    items: list[WorkspaceProbeItem] = []
    for ws_id in payload.workspace_ids:
        entry = entry_by_id.get(ws_id)
        if entry is None:
            continue
        items.append(
            WorkspaceProbeItem(
                workspace_id=ws_id,
                git_mode=entry["git_mode"],
                daemon_name=entry["daemon_name"],
                daemon_online=entry["daemon_online"],
            )
        )
    return items


@router.post("/{workspace_id}/activate", response_model=WorkspaceRead)
async def activate_workspace(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
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
    workspace_type: Annotated[
        WorkspaceTypeLiteral | None,
        Query(alias="type", description="工作区类型（8 值受控词表，非法值/旧值 422）"),
    ] = None,
    unclassified: Annotated[
        bool, Query(description="只列 type 为空（未分类）的工作区；与 type 互斥")
    ] = False,
    status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None,
    user_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> WorkspaceListResponse:
    """List workspaces with server-side filter + pagination (task-05 / FR-01/02/04).

    平台管理员：全量（allowed_workspace_ids=None），可按 user_id 过滤 created_by。
    普通账号：allowed_workspace_ids 限制可见集合，user_id 参数被忽略。

    change 2026-08-18-workspace-role-type：``?type=`` 枚举化（D-002@v1），新增
    ``?unclassified=true``（type IS NULL 谓词，D-005@v1）；两者同传 422——
    ``?type=`` 等值匹配表达不了 NULL，语义互斥。
    """
    if unclassified and workspace_type is not None:
        raise AppError(
            "「未分类」筛选与具体类型筛选不能同时使用，请只保留其一。",
            code="HTTP_422_WORKSPACE_TYPE_UNCLASSIFIED_CONFLICT",
            http_status=422,
        )
    service = WorkspaceService(session)
    if user.is_platform_admin:
        rows, total = await service.list_with_owner(
            include_deleted=include_deleted,
            limit=limit,
            offset=offset,
            q=q,
            workspace_type=workspace_type,
            unclassified=unclassified,
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
            unclassified=unclassified,
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
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> dict:
    """Initialize the workspace for the current user (D-002/D-009).

    Ensures the spec workspace container exists, then dispatches an init-mode
    interactive lease to the member's daemon.  The daemon writes
    ``.sillyspec-platform.json`` to the member's local project directory and
    pulls the latest spec bundle.

    Returns the ``lease_id``, ``runtime_id``, and ``claim_token``.

    鉴权收紧为 workspace-scoped（security-audit-remediation task-09）：非本
    workspace 成员（即便在其它 workspace 有 workspace:write）403，不触达
    ``start_init_dispatch`` 的 actor binding 解析。
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


@router.post(
    "/{workspace_id}/skills",
    response_model=SkillsViewResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace_skill(
    workspace_id: uuid.UUID,
    payload: SkillCreateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SkillsViewResponse:
    """新建 workspace 自定义 skill（2026-08-26-workspace-skill-edit task-02）。

    生成 ``skills/<name>/SKILL.md``（frontmatter name/description）；skill 名白名单
    校验（D-003@v1）；重名 409。鉴权 WorkspaceWriter（同 MCP PUT 模式）。
    """
    service = SkillsViewService(session)
    return await service.create_skill(workspace_id, payload, actor=user)


@router.delete("/{workspace_id}/skills/{skill_name}", response_model=SkillMutationResponse)
async def delete_workspace_skill(
    workspace_id: uuid.UUID,
    skill_name: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SkillMutationResponse:
    """删除整个 skill 目录（symlink 防护 + 审计，D-003@v1/R-02）。"""
    service = SkillsViewService(session)
    return await service.delete_skill(workspace_id, skill_name, actor=user)


@router.get(
    "/{workspace_id}/skills/{skill_name}/files/{file_path:path}",
    response_model=SkillFileContentResponse,
)
async def read_workspace_skill_file(
    workspace_id: uuid.UUID,
    skill_name: str,
    file_path: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> SkillFileContentResponse:
    """读 skill 内文本文件（UTF-8 探测 + 512KB 上限 + 路径穿越 fail-closed）。"""
    service = SkillsViewService(session)
    return await service.read_skill_file(workspace_id, skill_name, file_path)


@router.put(
    "/{workspace_id}/skills/{skill_name}/files/{file_path:path}",
    response_model=SkillFileWriteResponse,
)
async def write_workspace_skill_file(
    workspace_id: uuid.UUID,
    skill_name: str,
    file_path: str,
    payload: SkillFileWriteRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SkillFileWriteResponse:
    """写 skill 内文本文件（新建/覆盖，原子写 + 父目录自动创建限一层 + 审计）。"""
    service = SkillsViewService(session)
    return await service.write_skill_file(workspace_id, skill_name, file_path, payload, actor=user)


@router.delete(
    "/{workspace_id}/skills/{skill_name}/files/{file_path:path}",
    response_model=SkillMutationResponse,
)
async def delete_workspace_skill_file(
    workspace_id: uuid.UUID,
    skill_name: str,
    file_path: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> SkillMutationResponse:
    """删 skill 内文件（SKILL.md 入口保护 409 + 审计）。"""
    service = SkillsViewService(session)
    return await service.delete_skill_file(workspace_id, skill_name, file_path, actor=user)


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


@router.put("/{workspace_id}/mcp-config", response_model=McpConfigViewResponse)
async def update_workspace_mcp_config(
    workspace_id: uuid.UUID,
    payload: McpConfigUpdateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> McpConfigViewResponse:
    """写 workspace specDir/.mcp.json（2026-08-26-workspace-mcp-edit task-01）。

    鉴权 WorkspaceWriter（``require_permission(WORKSPACE_WRITE)`` 自动取路径
    ``{workspace_id}`` 做成员校验，非成员 403，同 mcp_gateway/router.py:114 模式）。
    service 层完成：仅 stdio 校验（D-005@v2）+ ``<set>`` 服务端还原（D-003@v2）+
    原子写（R-01）+ 审计上下文注入；错误经 AppError 全局 handler 序列化，router
    不手写 HTTPException。成功返回写后脱敏视图（与 GET 同构）。
    """
    service = SkillsViewService(session)
    return await service.update_mcp_config(workspace_id, payload, actor=user)


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
