"""关联仓同步编排（task-03，FR-04/FR-05；design 分层要点 4/5）。

- payload 组装：按 (workspace_id, actor) 查成员绑定行拿 daemon_id + root_path
  （resolve_root_path_for_daemon 容器→宿主改写）；repos[] 含共享字段与 actor 的
  成员级 abs_path。
- RPC：method ``linked_repos_sync``，请求-响应，超时 = 30s + 15s/仓（上限 180s，
  对齐 sillyspec_compare.py 显式 timeout 先例）。
- 落库唯一通道 = daemon REST 回报端点（apply_sync_result）；RPC 响应仅作发起方
  即时反馈，不写 sync_states（design 分层要点 4——避免双写分叉）。
- method_not_found（老 daemon）→ 全仓两层 upsert skipped(detail=daemon 需升级)，
  不报错（FR-07）；离线/超时原样上抛（既有 504 家族）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.runtime.service import DaemonRpcRemoteError
from app.modules.workspace.linked_repos.model import (
    WorkspaceLinkedRepo,
    WorkspaceLinkedRepoPath,
    WorkspaceLinkedRepoSyncState,
)
from app.modules.workspace.linked_repos.schema import SyncStateBrief
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.service import resolve_root_path_for_daemon

log = get_logger(__name__)

SYNC_RPC_METHOD = "linked_repos_sync"
SYNC_TIMEOUT_BASE_SECONDS = 30
SYNC_TIMEOUT_PER_REPO_SECONDS = 15
SYNC_TIMEOUT_CAP_SECONDS = 180

VALID_LAYERS = {"projects_yaml", "repos_registry"}
VALID_STATUSES = {"ok", "skipped", "failed"}


def sync_timeout_seconds(repo_count: int) -> int:
    return min(
        SYNC_TIMEOUT_BASE_SECONDS + SYNC_TIMEOUT_PER_REPO_SECONDS * max(repo_count, 0),
        SYNC_TIMEOUT_CAP_SECONDS,
    )


class SyncBindingMissing(AppError):
    """当前用户在该工作区无 daemon 绑定（无法路由 RPC）。"""

    code = "HTTP_409_LINKED_REPOS_BINDING_MISSING"
    http_status = 409


async def build_sync_payload(
    session: AsyncSession, workspace_id: uuid.UUID, actor_user_id: uuid.UUID
) -> dict[str, Any]:
    """组装 RPC payload；绑定缺失抛 SyncBindingMissing。"""
    binding = (
        (
            await session.execute(
                select(WorkspaceMemberRuntime).where(
                    col(WorkspaceMemberRuntime.workspace_id) == workspace_id,
                    col(WorkspaceMemberRuntime.user_id) == actor_user_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if binding is None or binding.daemon_id is None:
        raise SyncBindingMissing(
            "当前用户在该工作区未绑定守护进程，无法下发同步。",
            details={"workspace_id": str(workspace_id)},
        )
    repos = (
        (
            await session.execute(
                select(WorkspaceLinkedRepo).where(
                    col(WorkspaceLinkedRepo.workspace_id) == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    repo_ids = [r.id for r in repos]
    paths: dict[uuid.UUID, str] = {}
    if repo_ids:
        rows = (
            (
                await session.execute(
                    select(WorkspaceLinkedRepoPath).where(
                        col(WorkspaceLinkedRepoPath.linked_repo_id).in_(repo_ids),
                        col(WorkspaceLinkedRepoPath.user_id) == actor_user_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        paths = {p.linked_repo_id: p.root_path for p in rows}
    return {
        "workspace_id": str(workspace_id),
        "root_path": resolve_root_path_for_daemon(binding.root_path),
        "repos": [
            {
                "name": r.name,
                "rel_path": r.rel_path,
                "repo_url": r.repo_url,
                "abs_path": paths.get(r.id),
            }
            for r in repos
        ],
    }


async def trigger_sync(
    session: AsyncSession, workspace_id: uuid.UUID, actor_user_id: uuid.UUID
) -> dict[str, Any]:
    """「立即同步」：RPC 下发并等待响应（受理即返语义；结果经回报端点落库）。"""
    payload = await build_sync_payload(session, workspace_id, actor_user_id)
    instance_id = await _binding_daemon_id(session, workspace_id, actor_user_id)
    if instance_id is None:  # pragma: no cover - build_sync_payload 已校验
        raise SyncBindingMissing("未绑定守护进程")
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    timeout = sync_timeout_seconds(len(payload["repos"]))
    try:
        response = await hub.send_rpc(instance_id, SYNC_RPC_METHOD, payload, timeout=timeout)
    except DaemonRpcRemoteError as exc:
        if exc.code == "method_not_found":
            # 老 daemon 无 handler（FR-07）：全仓两层 skipped + 状态可见，不报错。
            await _mark_all_unsupported(session, workspace_id, instance_id)
            return {
                "dispatched": False,
                "reason": "daemon 需升级（不支持 linked_repos_sync）",
                "repo_count": len(payload["repos"]),
            }
        raise
    return {
        "dispatched": True,
        "repo_count": len(payload["repos"]),
        "daemon_response": response if isinstance(response, dict) else {"raw": str(response)},
    }


async def _binding_daemon_id(
    session: AsyncSession, workspace_id: uuid.UUID, actor_user_id: uuid.UUID
) -> uuid.UUID | None:
    binding = (
        (
            await session.execute(
                select(WorkspaceMemberRuntime).where(
                    col(WorkspaceMemberRuntime.workspace_id) == workspace_id,
                    col(WorkspaceMemberRuntime.user_id) == actor_user_id,
                )
            )
        )
        .scalars()
        .first()
    )
    return binding.daemon_id if binding else None


async def _mark_all_unsupported(
    session: AsyncSession, workspace_id: uuid.UUID, instance_id: uuid.UUID
) -> None:
    repos = (
        (
            await session.execute(
                select(WorkspaceLinkedRepo).where(
                    col(WorkspaceLinkedRepo.workspace_id) == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for r in repos:
        for layer in sorted(VALID_LAYERS):
            await _upsert_state(session, r.id, instance_id, layer, "skipped", "daemon 需升级", now)


async def _upsert_state(
    session: AsyncSession,
    linked_repo_id: uuid.UUID,
    machine_id: uuid.UUID,
    layer: str,
    status: str,
    detail: str | None,
    synced_at: datetime,
) -> None:
    stmt = select(WorkspaceLinkedRepoSyncState).where(
        col(WorkspaceLinkedRepoSyncState.linked_repo_id) == linked_repo_id,
        col(WorkspaceLinkedRepoSyncState.machine_id) == machine_id,
        col(WorkspaceLinkedRepoSyncState.layer) == layer,
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        session.add(
            WorkspaceLinkedRepoSyncState(
                linked_repo_id=linked_repo_id,
                machine_id=machine_id,
                layer=layer,
                status=status,
                detail=detail,
                synced_at=synced_at,
            )
        )
    else:
        row.status = status
        row.detail = detail
        row.synced_at = synced_at
    await session.commit()


async def apply_sync_result(
    session: AsyncSession,
    instance_id: uuid.UUID,
    workspace_id: uuid.UUID,
    results: list[dict[str, Any]],
) -> int:
    """回报端点落库（唯一通道）：按 repo_name 对账 linked_repo 行并 upsert 状态。

    未知仓/非法 layer-status 静默跳过并 log（daemon 半可信端，宽容收数）。
    返回写入条数。
    """
    repos = (
        (
            await session.execute(
                select(WorkspaceLinkedRepo).where(
                    col(WorkspaceLinkedRepo.workspace_id) == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    repo_by_name = {r.name: r for r in repos}
    now = datetime.now(UTC)
    written = 0
    for item in results:
        name = str(item.get("repo_name") or "")
        layer = str(item.get("layer") or "")
        status_val = str(item.get("status") or "")
        repo = repo_by_name.get(name)
        if repo is None:
            log.warning("linked_repos_sync_result unknown repo_name", repo_name=name)
            continue
        if layer not in VALID_LAYERS or status_val not in VALID_STATUSES:
            log.warning(
                "linked_repos_sync_result invalid layer/status",
                repo_name=name,
                layer=layer,
                status=status_val,
            )
            continue
        detail = item.get("detail")
        await _upsert_state(
            session,
            repo.id,
            instance_id,
            layer,
            status_val,
            str(detail) if detail is not None else None,
            now,
        )
        written += 1
    return written


async def summary_for_repos(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    repo_ids: list[uuid.UUID],
    viewer_user_id: uuid.UUID,
    viewer_is_elevated: bool,
) -> dict[uuid.UUID, list[SyncStateBrief]]:
    """GET 聚合口径（design 接口定义）：普通成员=自己绑定机器的最新逐层状态；
    owner/admin（提权视角，验收审查问题 D 修复——owner=workspace 建者，
    _ensure_creator_as_owner 先例）=全部机器。"""
    if not repo_ids:
        return {}
    viewer_machine = await _binding_daemon_id(session, workspace_id, viewer_user_id)
    stmt = select(WorkspaceLinkedRepoSyncState).where(
        col(WorkspaceLinkedRepoSyncState.linked_repo_id).in_(repo_ids)
    )
    if not viewer_is_elevated:
        if viewer_machine is None:
            return {rid: [] for rid in repo_ids}
        stmt = stmt.where(col(WorkspaceLinkedRepoSyncState.machine_id) == viewer_machine)
    rows = (await session.execute(stmt)).scalars().all()
    out: dict[uuid.UUID, list[SyncStateBrief]] = {rid: [] for rid in repo_ids}
    for row in rows:
        out.setdefault(row.linked_repo_id, []).append(
            SyncStateBrief(
                machine_id=row.machine_id,
                layer=row.layer,
                status=row.status,
                detail=row.detail,
                synced_at=row.synced_at,
            )
        )
    return out


# fire-and-forget 任务引用池（持有防 GC；RUF006 场景的显式管理形态）。
_BACKGROUND_PUSH_TASKS: set["asyncio.Task[None]"] = set()


async def push_sync_best_effort(session: AsyncSession, workspace_id: uuid.UUID) -> None:
    """CRUD 成功后向该工作区全部绑定机器 best-effort 推同步（FR-05，无确认语义）。

    逐机器组装 payload：abs_path 按**该机器绑定成员**（binding.user_id）的
    成员级路径解析——每台成员机器各自落自己的 repos: 层（未配路径的成员
    该层 skipped 由 daemon 侧归一）。异常静默 log 不抛——推送失败不阻塞
    CRUD 响应，用户可走「立即同步」兜底（验收审查问题 C 修复：推送通道
    补 abs_path；任务引用显式持有防 GC/异常黑洞）。
    """
    bindings = (
        (
            await session.execute(
                select(WorkspaceMemberRuntime).where(
                    col(WorkspaceMemberRuntime.workspace_id) == workspace_id,
                    col(WorkspaceMemberRuntime.daemon_id).is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if not bindings:
        return
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    repos = (
        (
            await session.execute(
                select(WorkspaceLinkedRepo).where(
                    col(WorkspaceLinkedRepo.workspace_id) == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    repo_ids = [r.id for r in repos]
    timeout = sync_timeout_seconds(len(repos))
    for binding in bindings:
        paths: dict[uuid.UUID, str] = {}
        if repo_ids:
            rows = (
                (
                    await session.execute(
                        select(WorkspaceLinkedRepoPath).where(
                            col(WorkspaceLinkedRepoPath.linked_repo_id).in_(repo_ids),
                            col(WorkspaceLinkedRepoPath.user_id) == binding.user_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            paths = {p.linked_repo_id: p.root_path for p in rows}
        machine_id = binding.daemon_id
        payload = {
            "workspace_id": str(workspace_id),
            "root_path": resolve_root_path_for_daemon(binding.root_path),
            "repos": [
                {
                    "name": r.name,
                    "rel_path": r.rel_path,
                    "repo_url": r.repo_url,
                    "abs_path": paths.get(r.id),
                }
                for r in repos
            ],
        }

        async def _push(
            machine_id: uuid.UUID = machine_id,
            payload: dict = payload,
        ) -> None:
            try:
                await hub.send_rpc(machine_id, SYNC_RPC_METHOD, payload, timeout=timeout)
            except Exception as exc:  # best-effort：无确认语义，静默降级
                log.info(
                    "linked_repos best-effort push failed",
                    machine_id=str(machine_id),
                    error=str(exc),
                )

        _BACKGROUND_PUSH_TASKS.add(asyncio.create_task(_push()))
    # 引用由模块级集合持有（fire-and-forget 惯例：完成自移除防 GC；异常已在
    # 任务内吞掉；**不等待**——推送不阻塞 CRUD 响应，FR-05）。
    for t in list(_BACKGROUND_PUSH_TASKS):
        if t.done():
            _BACKGROUND_PUSH_TASKS.discard(t)
