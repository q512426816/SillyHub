"""关联仓 HTTP 路由（task-02，FR-01/FR-02）。

``/workspaces/{workspace_id}/linked-repos``：
- GET    ``""``           列表（WORKSPACE_READ——工作区成员可读，含 my_path）
- POST   ``""``           登记（WORKSPACE_MEMBER_MANAGE=owner/admin）
- PATCH  ``/{repo_id}``   编辑共享字段（WORKSPACE_MEMBER_MANAGE）
- DELETE ``/{repo_id}``   删除（WORKSPACE_MEMBER_MANAGE；级联清理）
- PUT    ``/{repo_id}/my-path`` 成员级本机路径 upsert（WORKSPACE_READ，仅作用本人行）

挂载：main.py sibling include（仿 members_router 先例）——嵌套 include 会抛
``ValueError: Duplicated param name 'workspace_id'``（main.py 挂载区注释）。
sync 触发端点（task-03）并入本 router。
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
from app.modules.workspace.linked_repos import service
from app.modules.workspace.linked_repos.schema import (
    ImportRequest,
    ImportResponse,
    LinkedRepoCreate,
    LinkedRepoOut,
    LinkedRepoUpdate,
    LocalSnapshotResponse,
    MyPathUpdate,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/linked-repos",
    tags=["workspace-linked-repos"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _viewer_is_elevated(session: AsyncSession, workspace_id: uuid.UUID, user: User) -> bool:
    """提权视角判定：platform admin 或 workspace owner（建者）。"""
    if user.is_platform_admin:
        return True
    from app.modules.workspace.model import Workspace as _Workspace

    ws = await session.get(_Workspace, workspace_id)
    return ws is not None and ws.created_by == user.id


async def _push_best_effort(session: AsyncSession, workspace_id: uuid.UUID) -> None:
    """CRUD 成功后向绑定机器 best-effort 推同步（FR-05；失败静默不阻塞响应）。"""
    from app.modules.daemon.linked_repos_sync import push_sync_best_effort

    try:
        await push_sync_best_effort(session, workspace_id)
    except Exception:  # best-effort：任何失败不阻塞 CRUD 响应
        pass


@router.get("", response_model=list[LinkedRepoOut])
async def list_linked_repos(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[LinkedRepoOut]:
    """列出工作区关联仓（成员视角含 my_path；状态摘要由 task-03 接管填充）。"""
    return await service.list_repos(
        session,
        workspace_id,
        user.id,
        viewer_is_elevated=await _viewer_is_elevated(session, workspace_id, user),
    )


@router.post(
    "",
    response_model=LinkedRepoOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_linked_repo(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: LinkedRepoCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> LinkedRepoOut:
    """登记关联仓（owner/admin）。重名 409。"""
    try:
        row = await service.create_repo(
            session,
            workspace_id,
            name=payload.name,
            repo_url=payload.repo_url,
            description=payload.description,
            rel_path=payload.rel_path,
            created_by=user.id,
        )
    except service.LinkedRepoNameConflict as exc:
        raise AppError(
            f"关联仓重名: {exc}", code="HTTP_409_LINKED_REPO_NAME_CONFLICT", http_status=409
        ) from exc
    await _push_best_effort(session, workspace_id)
    return LinkedRepoOut(
        id=row.id,
        name=row.name,
        repo_url=row.repo_url,
        description=row.description,
        rel_path=row.rel_path,
        my_path=None,
        sync_status_summary=[],
    )


@router.patch("/{repo_id}", response_model=LinkedRepoOut)
async def update_linked_repo(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    repo_id: Annotated[uuid.UUID, Path(...)],
    payload: LinkedRepoUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> LinkedRepoOut:
    """编辑共享字段（owner/admin；name 不可改，见 schema 注）。

    显式提交键即更新（JSON null=显式清除，缺省=不动——exclude_unset 语义）；
    repo 必须归属路径工作区（跨工作区 404）。
    """
    del user  # 仅权限门
    try:
        row = await service.update_repo(
            session,
            repo_id,
            workspace_id,
            fields=payload.model_dump(exclude_unset=True),
        )
    except service.LinkedRepoNotFound as exc:
        raise AppError(
            "关联仓不存在", code="HTTP_404_LINKED_REPO_NOT_FOUND", http_status=404
        ) from exc
    await _push_best_effort(session, workspace_id)
    return LinkedRepoOut(
        id=row.id,
        name=row.name,
        repo_url=row.repo_url,
        description=row.description,
        rel_path=row.rel_path,
        my_path=None,
        sync_status_summary=[],
    )


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_linked_repo(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    repo_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> None:
    """删除关联仓（owner/admin；成员路径与落盘状态级联清理；归属校验 404）。"""
    del user
    try:
        await service.delete_repo(session, repo_id, workspace_id)
    except service.LinkedRepoNotFound as exc:
        raise AppError(
            "关联仓不存在", code="HTTP_404_LINKED_REPO_NOT_FOUND", http_status=404
        ) from exc
    await _push_best_effort(session, workspace_id)


@router.put("/{repo_id}/my-path", response_model=LinkedRepoOut)
async def save_my_path(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    repo_id: Annotated[uuid.UUID, Path(...)],
    payload: MyPathUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> LinkedRepoOut:
    """成员级本机路径 upsert（成员本人；path=null 清除；归属校验 404）。"""
    try:
        await service.upsert_my_path(session, repo_id, workspace_id, user.id, payload.path)
        await _push_best_effort(session, workspace_id)
        items = await service.list_repos(
            session,
            workspace_id,
            user.id,
            viewer_is_elevated=await _viewer_is_elevated(session, workspace_id, user),
        )
    except service.LinkedRepoNotFound as exc:
        raise AppError(
            "关联仓不存在", code="HTTP_404_LINKED_REPO_NOT_FOUND", http_status=404
        ) from exc
    for item in items:
        if item.id == repo_id:
            return item
    raise AppError("关联仓不存在", code="HTTP_404_LINKED_REPO_NOT_FOUND", http_status=404)


@router.post("/sync")
async def trigger_linked_repos_sync(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> dict:
    """「立即同步」：向当前成员绑定 daemon 发请求-响应 RPC（受理即返，FR-05）。

    无入参（幂等触发，POST 空 body）；结果经 daemon REST 回报端点落库
    （唯一通道），GET 轮询可见；老 daemon method_not_found → 状态层
    skipped(需升级) 且本端点不报错（FR-07）。
    """
    from app.modules.daemon.linked_repos_sync import trigger_sync

    return await trigger_sync(session, workspace_id, user.id)


# ── 2026-10-10-linked-repos-local-echo task-02/03：本机现状快照与导入（FR-01~04）──


@router.get("/local-snapshot", response_model=LocalSnapshotResponse)
async def get_local_snapshot(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> LocalSnapshotResponse:
    """本机现状快照（手动现拉即弃，D-003）：RPC 拉 daemon 侧只读快照 + 双源合并 +
    与平台登记三态对照；四态降级（ok/offline/unsupported/binding_missing，Gap B）。"""
    from app.modules.daemon import linked_repos_sync as sync_mod

    try:
        payload = await sync_mod.fetch_local_snapshot(session, workspace_id, user.id)
    except sync_mod.SnapshotBindingMissing:
        payload = {"status": "binding_missing", "entries": [], "platform_only_names": []}
    except Exception:
        # offline/timeout（既有 504 家族）→ 结构化 daemon_offline 降级（不 5xx，FR-02）
        payload = {"status": "daemon_offline", "entries": [], "platform_only_names": []}
    return LocalSnapshotResponse.model_validate(payload)


@router.post("/import", response_model=ImportResponse)
async def import_from_local(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: ImportRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> ImportResponse:
    """从本机快照条目导入为平台登记（owner/admin；合并条目一次落 rel_path+my_path，
    Grill Gap A；重名 skipped 幂等；逐条独立成败）。"""
    results = await service.import_repos(session, workspace_id, user.id, payload.entries)
    await _push_best_effort(session, workspace_id)
    return ImportResponse(results=results)
