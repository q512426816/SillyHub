"""Workspace use cases.

This module is the single place that talks to both the filesystem (via
:class:`WorkspaceScanner`) and the DB. Routers stay thin and only translate
HTTP <-> service calls.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.agent.service import AgentService

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.errors import (
    AppError,
    WorkspaceArchived,
    WorkspaceNotFound,
    WorkspaceNotSillyspec,
    WorkspacePathDuplicate,
    WorkspacePathNotDir,
    WorkspacePathNotFound,
    WorkspacePermissionDenied,
    WorkspaceSlugDuplicate,
    WorkspaceSlugImmutable,
)
from app.core.logging import get_logger
from app.core.permission_cache import invalidate_all_permissions
from app.modules.agent.model import AgentRun
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.workspace.constants import WorkspaceTypeLiteral
from app.modules.workspace.model import (
    AgentRunWorkspace,
    UserWorkspaceOrder,
    Workspace,
)
from app.modules.workspace.scanner import ScanResult, WorkspaceScanner
from app.modules.workspace.schema import WorkspaceCreate, WorkspaceUpdate, slugify

log = get_logger(__name__)

# 拖拽排序浮点中点键的相邻间隔基数（D-011@v1 方案 A；backfill 首次物化 /
# 边界 ±1024 / 精度耗尽整集重排共用同一基数，change 2026-09-14-workspace-drag-sort）。
_MOVE_POSITION_GAP: float = 1024.0


def _rewrite_path(root_path: str) -> str:
    """Rewrite a host-style path to the container mount if configured.

    When running inside Docker the host filesystem is not directly accessible.
    If ``host_path_prefix`` and ``container_path_prefix`` are set (via env vars),
    paths starting with the host prefix are rewritten to the container prefix.
    """
    settings = get_settings()
    host_prefix = settings.host_path_prefix
    container_prefix = settings.container_path_prefix
    if not host_prefix or not container_prefix:
        return root_path
    # Normalize both to forward-slash, ensure prefix ends with /
    normalized = root_path.replace("\\", "/").rstrip("/")
    host_norm = host_prefix.replace("\\", "/").rstrip("/") + "/"
    if normalized.startswith(host_norm) or normalized + "/" == host_norm:
        remainder = normalized[len(host_norm.rstrip("/")) :]
        # Ensure remainder starts with /
        if not remainder.startswith("/"):
            remainder = "/" + remainder
        return container_prefix.rstrip("/") + remainder
    return root_path


def resolve_root_path_for_daemon(root_path: str) -> str:
    """Map root_path to a path the daemon process can access on its host.

    backend 下发 root_path 给 daemon 时（lease claim payload / execution-context /
    scan --dir）做 container→host 改写：若 root_path 以 ``container_path_prefix``
    开头，替换为 ``host_path_prefix``；否则原样返回。未配置前缀（裸机部署，
    容器=宿主机）时原样返回（向后兼容）。

    路径规范化（``\\``→``/``、前缀末尾 ``/``）沿用 ``_rewrite_path`` 的跨平台处理。

    2026-07-10-remove-server-local-workspace-mode：唯一路径恒为 daemon-client
    （workspace 源码物理位于 daemon 宿主），不再按 path_source 分流，函数退化为
    纯 container→host 改写。
    """
    settings = get_settings()
    host_prefix = settings.host_path_prefix
    container_prefix = settings.container_path_prefix
    if not host_prefix or not container_prefix:
        return root_path
    # Normalize both to forward-slash, ensure prefix ends with /
    normalized = root_path.replace("\\", "/").rstrip("/")
    c_norm = container_prefix.replace("\\", "/").rstrip("/") + "/"
    if normalized.startswith(c_norm) or normalized + "/" == c_norm:
        remainder = normalized[len(c_norm.rstrip("/")) :]
        # Ensure remainder starts with /
        if not remainder.startswith("/"):
            remainder = "/" + remainder
        return host_prefix.rstrip("/") + remainder
    return root_path


class WorkspaceService:
    """Coordinates filesystem scans and DB persistence for workspaces."""

    def __init__(self, session: AsyncSession, scanner: WorkspaceScanner | None = None) -> None:
        self._session = session
        self._scanner = scanner or WorkspaceScanner()

    # -- Scanning ---

    def scan(self, root_path: str) -> ScanResult:
        """Run a dry-run scan and translate filesystem problems to AppError."""
        resolved = _rewrite_path(root_path)
        path = Path(resolved)
        self._guard_path(path)
        return self._scanner.scan(path)

    # -- Create / list / get ---

    async def create(
        self,
        payload: WorkspaceCreate,
        *,
        created_by: uuid.UUID | None,
        notice: dict[str, str] | None = None,
    ) -> Workspace:
        slug = payload.slug or slugify(payload.name)
        now = datetime.now(UTC)

        # If an active/pending workspace already exists for this root_path,
        # activate it instead of creating a new one.
        existing = await self._find_active_by_root_path(payload.root_path)
        if existing:
            if existing.status == "active":
                if notice is not None:
                    notice["kind"] = "reused_active"
                return existing
            # Pending workspace (e.g. from a previous scan-generate): activate it.
            existing.name = payload.name
            existing.slug = await self._ensure_unique_slug(slug)
            existing.status = "active"
            existing.default_agent = payload.default_agent
            existing.default_model = payload.default_model
            existing.updated_at = now
            existing.last_scanned_at = now
            await self._session.flush()
            # Check if platform storage already has .sillyspec (scan-generate case)
            await self._ensure_spec_workspace_from_platform(existing)
            # 激活时创建人自动添加为 owner（scan-generate 路径可能还未添加）
            await self._ensure_creator_as_owner(existing.id, user_id=created_by)
            await self.session.commit()
            await self.session.refresh(existing)
            # D-006@v1：commit 后清权限缓存（新增 owner 角色，perm:*/ppm-scope:* 失效）。
            await invalidate_all_permissions()
            log.info("workspace.activated_from_create", workspace_id=str(existing.id))
            if notice is not None:
                notice["kind"] = "activated_pending"
            return existing

        # task-02 AC-04b：同 root_path 的 soft-deleted workspace 存在时复活原行
        # （保主键，避免下游 FK 断链）。slug 冲突时自动加后缀。
        resurrected = await self._resurrect_soft_deleted(
            root_path=payload.root_path,
            payload=payload,
            slug=slug,
            created_by=created_by,
            now=now,
        )
        if resurrected is not None:
            await self._ensure_empty_spec_workspace(resurrected.id, strategy=payload.spec_strategy)
            await self._ensure_creator_as_owner(resurrected.id, user_id=created_by)
            if payload.daemon_id is not None and created_by is not None:
                from app.modules.workspace.member_runtimes.service import (
                    upsert_my_binding,
                )

                await upsert_my_binding(
                    self._session,
                    resurrected.id,
                    created_by,
                    daemon_id=payload.daemon_id,
                    root_path=payload.root_path,
                    path_source="daemon-client",
                )
            await self._session.commit()
            await self._session.refresh(resurrected)
            # D-006@v1：commit 后清权限缓存（新增 owner 角色，perm:*/ppm-scope:* 失效）。
            await invalidate_all_permissions()
            log.info("workspace.resurrected", workspace_id=str(resurrected.id))
            if notice is not None:
                notice["kind"] = "resurrected"
            return resurrected

        # ── FR-06 / D-003@v1：daemon-client 唯一路径（backend 读不到客户端 root_path）──
        # task-10/11 补遗：daemon_id 维度创建——早校验归属（daemon 属 created_by），
        # 避免做了一堆 spec_workspace/owner 副作用后才在 member binding 处失败。
        # 仅 daemon_id 提供 + created_by 非 None 时校验；legacy（仅 runtime_id）跳过。
        if payload.daemon_id is not None and created_by is not None:
            await self._guard_daemon_owned_by_user(payload.daemon_id, created_by)
        workspace = Workspace(
            id=uuid.uuid4(),
            name=payload.name,
            slug=slug,
            root_path=payload.root_path,
            status="active",
            component_key=payload.component_key,
            type=payload.type,
            role=payload.role,
            # description 列由 task-02 migration 落地；SQLModel 构造器对未声明
            # kwarg 静默忽略（列存在前不炸），列落地后自动持久化。
            description=payload.description,
            repo_url=payload.repo_url,
            default_branch=payload.default_branch,
            default_agent=payload.default_agent,
            default_model=payload.default_model,
            tech_stack=payload.tech_stack,
            build_command=payload.build_command,
            test_command=payload.test_command,
            source_yaml_path=payload.source_yaml_path,
            created_by=created_by,
            created_at=now,
            updated_at=now,
            last_scanned_at=now,
        )
        self._session.add(workspace)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            self._translate_integrity_error(exc, slug=slug, root_path=payload.root_path)
            raise  # _translate_integrity_error always raises; this is unreachable
        # 空 SpecWorkspace 占位，strategy 由用户选择（2026-06-28 起支持三值，默认 platform-managed）
        await self._ensure_empty_spec_workspace(workspace.id, strategy=payload.spec_strategy)
        # 创建人自动添加为 owner
        await self._ensure_creator_as_owner(workspace.id, user_id=created_by)
        # task-10/11 补遗：daemon_id 维度下，创建即建成员绑定行（workspace+user+daemon+path）。
        # 复用 upsert_my_binding（含归属校验 + 幂等 upsert + commit）。仅 daemon_id 提供 + created_by
        # 非 None 时；workspace 行已 flush，FK 不会悬空。
        if payload.daemon_id is not None and created_by is not None:
            from app.modules.workspace.member_runtimes.service import (
                upsert_my_binding,
            )

            await upsert_my_binding(
                self._session,
                workspace.id,
                created_by,
                daemon_id=payload.daemon_id,
                root_path=payload.root_path,
                path_source="daemon-client",
            )
        await self._session.commit()
        await self._session.refresh(workspace)
        # D-006@v1：commit 后清权限缓存（新增 owner 角色，perm:*/ppm-scope:* 失效）。
        await invalidate_all_permissions()
        log.info(
            "workspace.created.daemon_client",
            workspace_id=str(workspace.id),
            daemon_id=str(payload.daemon_id) if payload.daemon_id else None,
        )
        return workspace

    async def _resurrect_soft_deleted(
        self,
        *,
        root_path: str,
        payload: WorkspaceCreate,
        slug: str,
        created_by: uuid.UUID | None,
        now: datetime,
    ) -> Workspace | None:
        """Reactivate a soft-deleted workspace that has the same root_path.

        Returns the revived row on success or ``None`` if no tombstone exists.
        Raises :class:`WorkspaceSlugDuplicate` when the desired slug is already
        taken by another active workspace.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.root_path) == root_path)
            .where(col(Workspace.deleted_at).is_not(None))
            .order_by(col(Workspace.deleted_at).desc())
            .limit(1)
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            return None

        result.name = payload.name
        result.slug = await self._ensure_unique_slug(slug)
        result.status = "active"
        result.deleted_at = None
        result.created_by = created_by
        result.last_scanned_at = now
        result.updated_at = now
        # Update component metadata fields if provided
        result.component_key = payload.component_key
        result.type = payload.type
        result.role = payload.role
        result.repo_url = payload.repo_url
        result.default_branch = payload.default_branch
        result.default_agent = payload.default_agent
        result.default_model = payload.default_model
        result.tech_stack = payload.tech_stack
        result.build_command = payload.build_command
        result.test_command = payload.test_command
        result.source_yaml_path = payload.source_yaml_path

        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            self._translate_integrity_error(exc, slug=slug, root_path=root_path)
            raise

        # Ensure SpecWorkspace exists for resurrected workspace.
        # daemon-client 唯一路径：backend 读不到客户端路径，跳过本地 copytree，
        # 只建空 platform-managed 占位（spec_strategy 由调用方 payload 透传）。
        await self._ensure_empty_spec_workspace(result.id, strategy=payload.spec_strategy)

        await self._session.commit()
        await self._session.refresh(result)
        log.info(
            "workspace.resurrected",
            workspace_id=str(result.id),
            slug=result.slug,
            root_path=result.root_path,
        )
        return result

    async def list_(
        self,
        *,
        include_deleted: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[Workspace], int]:
        stmt = select(Workspace)
        if not include_deleted:
            stmt = stmt.where(col(Workspace.deleted_at).is_(None))
        stmt = stmt.order_by(col(Workspace.created_at).desc()).limit(limit).offset(offset)

        items = list((await self._session.execute(stmt)).scalars().all())

        count_stmt = select(Workspace)
        if not include_deleted:
            count_stmt = count_stmt.where(col(Workspace.deleted_at).is_(None))
        total = len((await self._session.execute(count_stmt)).scalars().all())
        return items, total

    async def list_with_owner(
        self,
        *,
        include_deleted: bool = False,
        limit: int = 100,
        offset: int = 0,
        q: str | None = None,
        workspace_type: WorkspaceTypeLiteral | None = None,
        unclassified: bool = False,
        status: str | None = None,
        user_id: uuid.UUID | None = None,
        allowed_workspace_ids: list[uuid.UUID] | None = None,
        order_user_id: uuid.UUID | None = None,
    ) -> tuple[list[tuple[Workspace, User | None]], int]:
        """Filtered + paginated workspace list with owner JOIN (task-05 / FR-01/02/04).

        - ``allowed_workspace_ids is None``: 平台管理员全量。
        - ``allowed_workspace_ids == []``: 普通账号无可读 workspace，直接返回空。
        - ``user_id``: 精确匹配 created_by（仅平台管理员传入；普通账号不传）。
        - ``q``: 大小写不敏感匹配 display_alias/name/slug/root_path/component_key。
        - ``workspace_type``: 精确匹配 type（8 值词表，router 层已枚举校验；
          change 2026-08-18-workspace-role-type 起非法值/旧值在 Query 层 422）。
        - ``unclassified``: type IS NULL 谓词（D-005@v1，"未分类"筛选；与
          workspace_type 互斥由 router 层 422 保证）。
        - ``status``: 精确匹配 status。
        - ``order_user_id``: 排序视角用户（task-04 / FR-03，change
          2026-09-14-workspace-drag-sort），与 ``user_id``（created_by 精确筛选）
          语义独立。非 None 时 rows 语句 LEFT JOIN 该用户的 UserWorkspaceOrder
          排序行，默认排序改三元组「无行在前（组内 created_at DESC，D-004@v1
          新建落最前）→ sort_position ASC → created_at DESC」；None=不加 JOIN，
          保持 created_at DESC 现状（router 透传 user.id 归 task-02，接线前
          既有调用全走 None 分支零变化）。total 计数与 limit/offset 分页不受
          排序影响（D-002@v1）。
        """
        if allowed_workspace_ids is not None and len(allowed_workspace_ids) == 0:
            return [], 0

        filters: list = []
        if not include_deleted:
            filters.append(col(Workspace.deleted_at).is_(None))
        if allowed_workspace_ids is not None:
            filters.append(col(Workspace.id).in_(allowed_workspace_ids))
        if user_id is not None:
            filters.append(col(Workspace.created_by) == user_id)
        q_norm = (q or "").strip()
        if q_norm:
            pattern = f"%{q_norm}%"
            filters.append(
                or_(
                    col(Workspace.display_alias).ilike(pattern),
                    col(Workspace.name).ilike(pattern),
                    col(Workspace.slug).ilike(pattern),
                    col(Workspace.root_path).ilike(pattern),
                    col(Workspace.component_key).ilike(pattern),
                )
            )
        if workspace_type:
            filters.append(col(Workspace.type) == workspace_type)
        if unclassified:
            # "未分类" = type IS NULL（D-005@v1）；等值匹配表达不了 NULL。
            filters.append(col(Workspace.type).is_(None))
        if status:
            filters.append(col(Workspace.status) == status)

        total_stmt = select(func.count()).select_from(Workspace)
        if filters:
            total_stmt = total_stmt.where(*filters)
        total = int((await self._session.scalar(total_stmt)) or 0)

        # task-04 / FR-03：order_user_id 非 None 时 LEFT JOIN 该用户排序行，默认排序改
        # 三元组「无行在前 → sort_position ASC → created_at DESC」（D-004@v1 无行的新建
        # 工作区落最前；与 _load_default_view / move 服务的显示序语义一致）。首键跨方言
        # 等价 NULLS FIRST——两方言均 false<true，DESC 把 IS NULL=true 的无行卡排最前，
        # 禁用 PG 专有 NULLS FIRST/LAST 语法；次键在无行组内恒为 NULL 不参与比较，组内
        # 顺序由末键决定（SQLite/PG 的 ASC NULL 排位差异因此不干扰）。无行用户
        # （order_user_id 传入但零排序行）三键全退化，结果与现状 created_at DESC 完全
        # 一致（D-004 回归验收）。None=不加 JOIN 保持现状（兼容策略：ORDER BY 分支由
        # order_user_id 有无决定）。唯一索引 (user_id, workspace_id) 保证 JOIN 不放大
        # 行数；total_stmt 不 JOIN 排序表，计数不受影响。
        rows_stmt = select(Workspace, User).outerjoin(User, Workspace.created_by == User.id)
        if order_user_id is not None:
            rows_stmt = rows_stmt.outerjoin(
                UserWorkspaceOrder,
                and_(
                    col(UserWorkspaceOrder.workspace_id) == col(Workspace.id),
                    col(UserWorkspaceOrder.user_id) == order_user_id,
                ),
            ).order_by(
                col(UserWorkspaceOrder.sort_position).is_(None).desc(),
                col(UserWorkspaceOrder.sort_position).asc(),
                col(Workspace.created_at).desc(),
            )
        else:
            rows_stmt = rows_stmt.order_by(col(Workspace.created_at).desc())
        rows_stmt = rows_stmt.limit(limit).offset(offset)
        if filters:
            rows_stmt = rows_stmt.where(*filters)
        rows = list((await self._session.execute(rows_stmt)).all())
        return [(ws, owner) for ws, owner in rows], total

    async def get(self, workspace_id: uuid.UUID) -> Workspace:
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None or workspace.deleted_at is not None:
            raise WorkspaceNotFound(
                "工作区不存在或已被删除。",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace

    @staticmethod
    def ensure_writable(workspace: Workspace) -> None:
        """归档工作区禁写守卫（ql-20260829-010）。

        创建会话 / 发起变更 / 派发 agent run 等写入口在解析出 Workspace 行后
        调用；归档 → 409 ``WorkspaceArchived``（中文提示 + 恢复路径指向详情页
        状态改回活跃）。pending（未激活过渡态）维持现状不拦——激活引导本身可
        从 PATCH status 触发（ql-20260829-008），此处只封「已归档」。
        """
        if workspace.status == "archived":
            raise WorkspaceArchived(
                "该工作区已归档，无法执行此操作。请先在工作区详情「基本信息 → 编辑」"
                "中将状态改回「活跃」。",
                details={
                    "workspace_id": str(workspace.id),
                    "status": workspace.status,
                },
            )

    # -- Mutate ---

    async def rescan(self, workspace_id: uuid.UUID) -> tuple[Workspace, ScanResult]:
        workspace = await self.get(workspace_id)

        # daemon-client 唯一路径：源码在 daemon 宿主，backend 读不到 root_path；
        # 永远从 platform-managed spec_root 重扫（spec 来自 task-09 sync 回灌）。
        from app.modules.spec_workspace.service import SpecWorkspaceService

        try:
            spec_ws_svc = SpecWorkspaceService(self._session)
            spec_ws = await spec_ws_svc.get(workspace.id)
            scan_path = spec_ws.spec_root
        except Exception:
            raise WorkspaceNotSillyspec(
                "该工作区还没有可重扫的平台 spec，请先完成扫描或同步。",
                details={"workspace_id": str(workspace.id)},
            ) from None

        scan = await asyncio.to_thread(self.scan, scan_path)
        workspace.last_scanned_at = datetime.now(UTC)
        workspace.updated_at = workspace.last_scanned_at

        # 组件不再是 workspaces 表行（D-001@V1，变更 2026-07-06-component-readonly-split），
        # rescan 无需 reparse 落子组件；scan 结果仍用于刷新 last_scanned_at 与 structure。

        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.rescanned",
            workspace_id=str(workspace.id),
            is_sillyspec=scan.is_sillyspec,
        )
        return workspace, scan

    async def soft_delete(
        self,
        workspace_id: uuid.UUID,
        deleted_by: uuid.UUID | None = None,
    ) -> Workspace:
        workspace = await self.get(workspace_id)
        # Only the owner (created_by) may delete a workspace.
        # If created_by is None (legacy data), skip the check.
        if workspace.created_by is not None and deleted_by != workspace.created_by:
            raise WorkspacePermissionDenied("只有工作区所有者才能删除该工作区。")

        # 第五批 code-quality：取消该 workspace 下所有在跑 AgentRun（防软删后 daemon
        # 继续 burn token / 向已删实体回写）。复用 P0-2 链路（cancel_lease 内部含
        # "标记 killed + lease cancelled + 发信号"，对无 lease 的 pending run 也走
        # _mark_agent_run_killed_if_pending 兜底）。best-effort：单 run 失败不中断软删。
        # 注：子表（member binding / lease / AgentRunWorkspace）清理留专项——软删后
        # 残留子表是数据冗余不影响功能，cancel run 是防烧 token 的核心。
        active_runs = (
            (
                await self._session.execute(
                    select(AgentRun)
                    .join(AgentRunWorkspace, AgentRunWorkspace.agent_run_id == AgentRun.id)
                    .where(AgentRunWorkspace.workspace_id == workspace_id)
                    .where(AgentRun.status.in_(("pending", "running")))
                )
            )
            .scalars()
            .all()
        )
        if active_runs:
            from app.modules.daemon.lease_service import DaemonLeaseService

            lease_svc = DaemonLeaseService(self._session)
            for run in active_runs:
                try:
                    await lease_svc.cancel_lease(run.id)
                except Exception as exc:
                    log.warning(
                        "workspace.soft_delete_cancel_failed",
                        workspace_id=str(workspace_id),
                        run_id=str(run.id),
                        error=str(exc),
                    )

        now = datetime.now(UTC)
        workspace.deleted_at = now
        workspace.updated_at = now
        workspace.status = "deleted"
        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.soft_deleted",
            workspace_id=str(workspace.id),
            cancelled_runs=len(active_runs),
        )
        return workspace

    async def update(
        self,
        workspace_id: uuid.UUID,
        payload: WorkspaceUpdate,
    ) -> Workspace:
        """Update an existing workspace with only the fields provided by the caller.

        Uses ``exclude_unset=True`` so omitted fields are left untouched.
        slug 创建后不可变（ql-20260826-007-8666）：显式传同值视为幂等 no-op，
        传不同值抛 :class:`WorkspaceSlugImmutable`（400）。
        """
        ws = await self.get(workspace_id)
        changes = payload.model_dump(exclude_unset=True)
        # ql-20260826-007-8666：slug 是下游 mirror 目录名 / lease 元数据 / 跨模块
        # 引用的稳定键，创建后锁定；同值重传幂等放行。
        new_slug = changes.get("slug")
        if new_slug is not None and new_slug != ws.slug:
            raise WorkspaceSlugImmutable(
                "slug 创建后不可修改。",
                details={"slug": new_slug, "current_slug": ws.slug},
            )
        # ql-20260829-008：状态维护。pending→active 不能裸写列——activate 的引导
        # 语义（_ensure_empty_spec_workspace + last_scanned_at）必须保留，故先委托
        # activate（幂等：status!=pending 时提前返回），再继续应用其余字段。
        new_status = changes.get("status")
        if new_status == "active" and ws.status == "pending":
            await self.activate(workspace_id)
            ws = await self.get(workspace_id)
        if changes:
            _upd_root = changes.get("root_path")
            for field, value in changes.items():
                setattr(ws, field, value)
            ws.updated_at = datetime.now(UTC)
            try:
                await self._session.commit()
            except IntegrityError as exc:
                # R14（并发修复，2026-07-24）：并发 update 撞 root_path 唯一约束时
                # （slug 已不可变，uq_workspaces_slug 不再可能触发）rollback 后复用
                # _translate_integrity_error 转友好 409（对齐 create 路径 :218-223），而非 500。
                await self._session.rollback()
                self._translate_integrity_error(
                    exc,
                    slug=ws.slug,
                    root_path=_upd_root or ws.root_path,
                )
                raise  # 不可达：_translate_integrity_error 必 raise
            await self._session.refresh(ws)
            log.info(
                "workspace.updated",
                workspace_id=str(ws.id),
                updated_fields=list(changes.keys()),
            )
        return ws

    # -- Drag-sort move (change 2026-09-14-workspace-drag-sort, task-03) ---

    async def move_workspace(
        self,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        after_id: uuid.UUID | None,
        before_id: uuid.UUID | None,
        to: str | None,
        page_size: int,
        allowed_ids: list[uuid.UUID] | None,
    ) -> tuple[Workspace, bool, int]:
        """拖拽移动工作区（FR-01 顺序持久化 / FR-02 跨页移动，design 总体方案 Wave 1）。

        事务四步：①幂等 backfill 物化排序行（D-006@v2）→ ②锚点解析（id 锚点直取
        邻居；``to`` 枚举在默认视图序列上做分页数学解析成 id 锚点，D-012@v1）→
        ③锚点邻居浮点中点 / ±1024，精度耗尽时同一事务内整集重排（D-011@v1 /
        R-01）→ ④单行 upsert + 默认视图 0 基 rank（前端 floor(rank/page_size)
        换算页码，R-07）。

        - ``allowed_ids=None`` 表示平台管理员（与 ``list_with_owner`` 可见性语义
          一致）；行级可见校验归 task-02 router 层，此处防御性复验。
        - 锚点三选一互斥校验归 task-02 pydantic 层，service 按已校验输入处理并
          防御性复验。
        - 返回 ``(移动后的 Workspace, 是否触发整集重排, 0 基 rank)``。

        move 是纯重排——只写 user_workspace_orders 排序行，不增删 workspaces 行
        （D-014@v1 分页数量不变量的前提）；同用户并发后写覆盖按 D-008@v1 接受，
        不加乐观锁。
        """
        # 防御性三选一校验（正常由 task-02 schema 层 422 HTTP_422_MOVE_ANCHOR_CONFLICT 拦截）
        if sum(anchor is not None for anchor in (after_id, before_id, to)) != 1:
            raise AppError(
                "移动锚点 after_id / before_id / to 必须恰好提供一个。",
                code="HTTP_422_MOVE_ANCHOR_CONFLICT",
                http_status=422,
            )
        if to is not None and (to not in ("next_page_head", "prev_page_tail") or page_size < 1):
            raise AppError(
                "to 仅支持 next_page_head / prev_page_tail，且 page_size 必须为正整数。",
                code="HTTP_422_MOVE_ANCHOR_CONFLICT",
                http_status=422,
            )

        workspace = await self.get(workspace_id)  # 不存在/软删 → 404
        # 行级可见性防御复验（None=平台管理员全量）
        if allowed_ids is not None and workspace_id not in allowed_ids:
            raise WorkspacePermissionDenied("无权访问该工作区，无法移动排序。")

        # ① 幂等 backfill：可见 ∧ active/archived ∧ 未软删 ∧ 尚无排序行的全集一次性物化
        await self._backfill_order_rows(user_id=user_id, allowed_ids=allowed_ids)

        # ② 锚点解析：统一收敛为 (anchor_after, anchor_before) 相邻 id 锚点
        anchor_after: uuid.UUID | None = None
        anchor_before: uuid.UUID | None = None
        if to is not None:
            anchor_after, anchor_before = await self._resolve_page_target(
                workspace_id=workspace_id,
                user_id=user_id,
                to=to,
                page_size=page_size,
                allowed_ids=allowed_ids,
            )
        elif after_id is not None:
            await self._validate_move_anchor(
                after_id, workspace_id=workspace_id, allowed_ids=allowed_ids
            )
            anchor_after = after_id
        elif before_id is not None:
            await self._validate_move_anchor(
                before_id, workspace_id=workspace_id, allowed_ids=allowed_ids
            )
            anchor_before = before_id
        else:  # 不可达：三选一防御校验已保证恰好一个
            raise AppError(
                "移动锚点 after_id / before_id / to 必须恰好提供一个。",
                code="HTTP_422_MOVE_ANCHOR_CONFLICT",
                http_status=422,
            )

        # ③+④ 中点落位并单行 upsert；默认视图只有被移动卡自身时（to 收敛后无邻居）
        # 为纯 no-op——位置不动，只返回 rank。
        rebalanced = False
        if anchor_after is not None or anchor_before is not None:
            position, rebalanced = await self._compute_anchor_position(
                user_id=user_id, anchor_after=anchor_after, anchor_before=anchor_before
            )
            await self._upsert_order_row(
                user_id=user_id, workspace_id=workspace_id, position=position
            )

        # rank 在提交前按同事务内已 flush 的落位计算（失败可整体回滚）
        rank = await self._default_view_rank(
            workspace_id=workspace_id,
            user_id=user_id,
            allowed_ids=allowed_ids,
            fallback_created_at=workspace.created_at,
        )
        # 单事务提交：backfill / 整集重排 / upsert 全部写路径在此一次落库
        await self._session.commit()
        log.info(
            "workspace.moved",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            to=to,
            rebalanced=rebalanced,
            rank=rank,
        )
        return workspace, rebalanced, rank

    async def _backfill_order_rows(
        self,
        *,
        user_id: uuid.UUID,
        allowed_ids: list[uuid.UUID] | None,
    ) -> None:
        """幂等物化排序行（D-006@v2）：每次 move 事务首步执行。

        INSERT..SELECT WHERE NOT EXISTS 的 Python 等价实现——位置公式需按「首用户
        row_number×1024 / 已有行 min(pos)-1024×n」分派，纯 SQL 双方言表达繁琐；
        量级一两百直接整取（D-002@v1）。一次性物化「该用户可见 ∧ status IN
        (active, archived) ∧ 未软删 ∧ 尚无排序行」的全部 workspace——锚点卡因此
        永远有行，无「锚点无行」输入域（Grill F-04）。

        - 首用户（零存量行）：全集按显示序（created_at DESC）赋 row_number×1024
          递增序列（D-006@v2 勘误——ASC 消费下沿显示序递增，v1「递减」为笔误）。
        - 已有行：新增无行组整体物化在现有最小位置之下（min(pos)-1024×n 区段），
          组内 created_at DESC——物化前后默认视图显示序零变化（D-004@v1 回归约束）。
        - 软删（deleted_at 非空）行不物化；重复执行零新增行。
        """
        conds = [
            col(Workspace.deleted_at).is_(None),
            col(Workspace.status).in_(("active", "archived")),
        ]
        if allowed_ids is not None:
            conds.append(col(Workspace.id).in_(allowed_ids))
        candidates = (
            await self._session.execute(select(Workspace.id, Workspace.created_at).where(*conds))
        ).all()
        if not candidates:
            return
        existing = (
            await self._session.execute(
                select(
                    UserWorkspaceOrder.workspace_id,
                    UserWorkspaceOrder.sort_position,
                ).where(col(UserWorkspaceOrder.user_id) == user_id)
            )
        ).all()
        existing_ids = {row.workspace_id for row in existing}
        missing = [row for row in candidates if row.id not in existing_ids]
        if not missing:
            return  # 幂等：重复执行零新增行
        # 组内显示序：created_at DESC（新建优先；id 仅作稳定并列次序）
        missing.sort(key=lambda row: (row.created_at, row.id), reverse=True)
        if existing:
            base = min(row.sort_position for row in existing)
            positions = [base - _MOVE_POSITION_GAP * (i + 1) for i in range(len(missing))]
        else:
            positions = [_MOVE_POSITION_GAP * (i + 1) for i in range(len(missing))]
        now = datetime.now(UTC)
        self._session.add_all(
            UserWorkspaceOrder(
                user_id=user_id,
                workspace_id=row.id,
                sort_position=position,
                created_at=now,
                updated_at=now,
            )
            for row, position in zip(missing, positions, strict=True)
        )
        await self._session.flush()

    async def _resolve_page_target(
        self,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        to: str,
        page_size: int,
        allowed_ids: list[uuid.UUID] | None,
    ) -> tuple[uuid.UUID | None, uuid.UUID | None]:
        """``to`` 枚举锚点解析（D-012@v1）：默认视图分页数学 → 相邻 id 锚点。

        取该用户默认视图有序 id 列表（可见 ∧ active ∧ 未软删，按显示序），定位被
        移动卡当前 rank r、页 P=floor(r/page_size)；目标插入 rank=(P+1)×page_size
        （next_page_head=下页页首）或 P×page_size-1（prev_page_tail=上页页尾，
        P=0 时 422）；越界收敛到序列尾/首。此路径消除客户端「不知道相邻页边界卡」
        的分页数学问题（Grill F-01：after_id=本页末卡的落位是本页末位而非下页开头）。
        """
        view = await self._load_default_view(user_id=user_id, allowed_ids=allowed_ids)
        ordered_ids = [item[0] for item in view]
        try:
            current_rank = ordered_ids.index(workspace_id)
        except ValueError:
            raise AppError(
                "被移动的工作区不在默认视图中，无法按分页目标移动。",
                code="HTTP_422_MOVE_ANCHOR_NOT_VISIBLE",
                http_status=422,
                details={"workspace_id": str(workspace_id)},
            ) from None
        page = current_rank // page_size
        if to == "next_page_head":
            target_rank = (page + 1) * page_size
        else:
            if page == 0:
                # 第 0 页没有上一页页尾（design 接口定义锚点校验第三分支）
                raise AppError(
                    "被移动的工作区已位于第一页，无法移动到上一页页尾。",
                    code="HTTP_422_MOVE_ANCHOR_NOT_VISIBLE",
                    http_status=422,
                    details={"workspace_id": str(workspace_id)},
                )
            target_rank = page * page_size - 1
        # 越界收敛：target_rank 是「移除被移动卡后」新序列里的插入位，合法域 [0, len-1]
        target_rank = max(0, min(target_rank, len(ordered_ids) - 1))
        others = [wid for wid in ordered_ids if wid != workspace_id]
        if not others:
            return None, None  # 默认视图只有被移动卡自身——无相邻锚点，纯 no-op
        if target_rank >= 1:
            # 插到 others[target_rank] 之前 ⇒ after 锚点取其前一张
            return others[target_rank - 1], None
        return None, others[0]

    async def _validate_move_anchor(
        self,
        anchor_id: uuid.UUID,
        *,
        workspace_id: uuid.UUID,
        allowed_ids: list[uuid.UUID] | None,
    ) -> None:
        """id 锚点判据（D-013@v1）：存在 ∧ 可见 ∧ 未软删 ∧ status ∈ {active, archived}。

        与 backfill 物化范围对齐（Grill F-08）——锚点卡因此永远有排序行。违反 →
        422 ``HTTP_422_MOVE_ANCHOR_NOT_VISIBLE``；自锚（锚点=被移动卡自身）→ 422
        ``HTTP_422_MOVE_ANCHOR_SELF``（前端正常流程不会发，契约兜底，Grill F-09）。
        """
        if anchor_id == workspace_id:
            raise AppError(
                "锚点不能是被移动的工作区自身。",
                code="HTTP_422_MOVE_ANCHOR_SELF",
                http_status=422,
                details={"workspace_id": str(workspace_id)},
            )
        anchor = await self._session.get(Workspace, anchor_id)
        if (
            anchor is None
            or anchor.deleted_at is not None
            or anchor.status not in ("active", "archived")
            or (allowed_ids is not None and anchor_id not in allowed_ids)
        ):
            raise AppError(
                "锚点工作区不存在、不可见或状态不允许，无法作为移动锚点。",
                code="HTTP_422_MOVE_ANCHOR_NOT_VISIBLE",
                http_status=422,
                details={"anchor_id": str(anchor_id)},
            )

    async def _compute_anchor_position(
        self,
        *,
        user_id: uuid.UUID,
        anchor_after: uuid.UUID | None,
        anchor_before: uuid.UUID | None,
    ) -> tuple[float, bool]:
        """锚点邻居浮点中点 / ±1024 落位，精度耗尽时同一事务内整集重排（D-011@v1，R-01）。

        after=A → 新位置=(pos(A)+pos(A 的后继))/2，无后继=pos(A)+1024；before=B
        对称（无前驱=pos(B)-1024）。中点结果与任一邻居相等（浮点精度耗尽）→ 按
        当前顺序重赋 1024 间隔后重算本次位置，返回 rebalanced=True。
        """
        rows = await self._load_order_rows(user_id=user_id)
        index_of = {row.workspace_id: i for i, row in enumerate(rows)}
        if anchor_after is not None:
            anchor_idx = self._anchor_row_index(index_of, anchor_after)
            anchor_pos = rows[anchor_idx].sort_position
            successor = rows[anchor_idx + 1] if anchor_idx + 1 < len(rows) else None
            if successor is None:
                return anchor_pos + _MOVE_POSITION_GAP, False
            neighbor_pos = successor.sort_position
        else:
            # 三选一校验保证 anchor_after / anchor_before 恰有一个
            if anchor_before is None:
                raise AppError(
                    "移动锚点 after_id / before_id / to 必须恰好提供一个。",
                    code="HTTP_422_MOVE_ANCHOR_CONFLICT",
                    http_status=422,
                )
            anchor_idx = self._anchor_row_index(index_of, anchor_before)
            anchor_pos = rows[anchor_idx].sort_position
            predecessor = rows[anchor_idx - 1] if anchor_idx > 0 else None
            if predecessor is None:
                return anchor_pos - _MOVE_POSITION_GAP, False
            neighbor_pos = predecessor.sort_position
        new_pos = (anchor_pos + neighbor_pos) / 2.0
        if new_pos != anchor_pos and new_pos != neighbor_pos:
            return new_pos, False
        # 精度耗尽（两卡位置贴死）→ 同一事务内整集重排：按当前顺序重赋
        # 1024×row_number 后重算。rows 为同一批 ORM 对象，重排已就地更新
        # 位置且不改变相邻关系，无需重查。
        await self._rebalance_order_rows(rows)
        anchor_pos = rows[anchor_idx].sort_position
        neighbor_idx = anchor_idx + 1 if anchor_after is not None else anchor_idx - 1
        return (anchor_pos + rows[neighbor_idx].sort_position) / 2.0, True

    @staticmethod
    def _anchor_row_index(index_of: dict[uuid.UUID, int], anchor_id: uuid.UUID) -> int:
        """锚点卡在按位置 ASC 排序行列表中的下标；无行时防御性 422。

        backfill 后锚点（可见 ∧ active/archived）必有排序行（D-006@v2），
        此分支正常不可达。
        """
        try:
            return index_of[anchor_id]
        except KeyError:
            raise AppError(
                "锚点工作区不存在、不可见或状态不允许，无法作为移动锚点。",
                code="HTTP_422_MOVE_ANCHOR_NOT_VISIBLE",
                http_status=422,
                details={"anchor_id": str(anchor_id)},
            ) from None

    async def _load_order_rows(self, *, user_id: uuid.UUID) -> list[UserWorkspaceOrder]:
        """该用户全部排序行，按 sort_position ASC（含归档/软删 workspace 的保留行）。

        软删卡的排序行参与中点数学无害——它不可见但占位，中点结果仍落在锚点与
        其后继之间，默认视图相对顺序不受影响（D-006@v2：软删行保留、复活回原位）。
        """
        stmt = (
            select(UserWorkspaceOrder)
            .where(col(UserWorkspaceOrder.user_id) == user_id)
            .order_by(col(UserWorkspaceOrder.sort_position).asc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _rebalance_order_rows(self, rows: list[UserWorkspaceOrder]) -> None:
        """整集重排：按当前顺序（入参 ASC 序）重赋 1024×row_number 递增序列（R-01）。"""
        now = datetime.now(UTC)
        for i, row in enumerate(rows):
            row.sort_position = _MOVE_POSITION_GAP * (i + 1)
            row.updated_at = now
        await self._session.flush()

    async def _upsert_order_row(
        self,
        *,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        position: float,
    ) -> None:
        """单行 upsert 被移动卡的排序位置（(user_id, workspace_id) 唯一索引依据）。

        move 是纯重排：只写本表单行，不增删 workspaces 行（D-014@v1 分页数量
        不变量）。SQLite/PG 双方言——不用 ON CONFLICT 方言语法，select 后按
        有无行走 UPDATE / INSERT。
        """
        row = (
            (
                await self._session.execute(
                    select(UserWorkspaceOrder)
                    .where(col(UserWorkspaceOrder.user_id) == user_id)
                    .where(col(UserWorkspaceOrder.workspace_id) == workspace_id)
                )
            )
            .scalars()
            .first()
        )
        now = datetime.now(UTC)
        if row is None:
            self._session.add(
                UserWorkspaceOrder(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    sort_position=position,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            row.sort_position = position
            row.updated_at = now
        await self._session.flush()

    async def _load_default_view(
        self,
        *,
        user_id: uuid.UUID,
        allowed_ids: list[uuid.UUID] | None,
    ) -> list[tuple[uuid.UUID, float | None, datetime]]:
        """该用户默认视图（可见 ∧ active ∧ 未软删）按显示序的 (id, 排序位, created_at)。

        显示序与列表 SQL（task-04 的 LEFT JOIN 排序）一致：无行卡在前（组内
        created_at DESC，D-004@v1 新建落最前）、有行卡按 sort_position ASC。
        量级一两百（D-002@v1），整取后在 Python 排序。
        """
        stmt = (
            select(Workspace.id, Workspace.created_at, UserWorkspaceOrder.sort_position)
            .outerjoin(
                UserWorkspaceOrder,
                and_(
                    col(UserWorkspaceOrder.workspace_id) == col(Workspace.id),
                    col(UserWorkspaceOrder.user_id) == user_id,
                ),
            )
            .where(col(Workspace.deleted_at).is_(None))
            .where(col(Workspace.status) == "active")
        )
        if allowed_ids is not None:
            stmt = stmt.where(col(Workspace.id).in_(allowed_ids))
        rows = (await self._session.execute(stmt)).all()
        no_row = sorted(
            (r for r in rows if r.sort_position is None),
            key=lambda r: (r.created_at, r.id),
            reverse=True,
        )
        with_row = sorted(
            (r for r in rows if r.sort_position is not None),
            key=lambda r: (r.sort_position, r.id),
        )
        return [(r.id, r.sort_position, r.created_at) for r in [*no_row, *with_row]]

    async def _default_view_rank(
        self,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        allowed_ids: list[uuid.UUID] | None,
        fallback_created_at: datetime,
    ) -> int:
        """移动后该卡在默认视图序列中的 0 基序号（R-07：前端 floor(rank/page_size) 换算页码）。

        防御分支：被移动卡不在默认视图（归档/待激活——正常拖拽输入域之外，前端
        仅默认视图可拖）时，按同一显示序键定位其「落点序号」——有行卡与其余有行
        卡比 pos，无行卡与无行组比 created_at DESC。
        """
        view = await self._load_default_view(user_id=user_id, allowed_ids=allowed_ids)
        ordered_ids = [item[0] for item in view]
        if workspace_id in ordered_ids:
            return ordered_ids.index(workspace_id)
        moved_pos = await self._session.scalar(
            select(UserWorkspaceOrder.sort_position).where(
                col(UserWorkspaceOrder.user_id) == user_id,
                col(UserWorkspaceOrder.workspace_id) == workspace_id,
            )
        )
        if moved_pos is None:
            return sum(
                1 for _, pos, created_at in view if pos is None and created_at > fallback_created_at
            )
        return sum(1 for _, pos, _ in view if pos is None or pos < moved_pos)

    # -- Generate projects from module-map ---

    async def generate_projects(
        self,
        workspace_id: uuid.UUID,
    ) -> dict:
        """Read _module-map.yaml, generate projects/*.yaml grouped by prefix, then reparse.

        Returns stats dict from reparse.
        """
        import yaml

        ws = await self.get(workspace_id)
        # 归档区禁写（2026-08-30 审计④-5）：向 spec 根写 projects/*.yaml，
        # 归档工作区 → 409（统一守卫）。
        self.ensure_writable(ws)

        # Determine spec_root
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        spec_root: str | None = None
        try:
            spec_ws = await spec_ws_svc.get(ws.id)
            if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                spec_root = spec_ws.spec_root
        except Exception:
            pass
        if not spec_root:
            spec_root = _rewrite_path(ws.root_path)

        module_map_path = (
            Path(spec_root) / ".sillyspec" / "docs" / ws.name / "modules" / "_module-map.yaml"
        )
        if not module_map_path.is_file():
            raise WorkspaceNotSillyspec(
                "未找到模块清单文件 _module-map.yaml，请先完成扫描。",
                details={"path": str(module_map_path)},
            )

        with module_map_path.open("r", encoding="utf-8") as f:
            module_map = yaml.safe_load(f)

        modules = module_map.get("modules", {})
        if not modules:
            return {"generated_files": 0}

        # 按一级目录分组（D-002@V1，变更 2026-07-06-component-readonly-split）。
        # 改前按 module key 首段（key.split("-")[0]）分组，会产出模块级组件（backend-agent 等
        # 35 个），与用户"应该有好几个"心智不符；改后按 module path 的顶级目录
        # （backend/frontend/daemon/sillyhub-daemon/ppm）分组，模块级归入对应一级组件，
        # 只产 5 个一级子项目 yaml。
        root_path_normalized = _rewrite_path(ws.root_path)
        groups: set[str] = set()
        for _key, info in modules.items():
            if not isinstance(info, dict):
                continue
            for raw_path in info.get("paths", []):
                rel = raw_path
                if raw_path.startswith(root_path_normalized):
                    rel = os.path.relpath(raw_path, root_path_normalized)
                top = rel.replace("\\", "/").split("/")[0]
                if top:
                    groups.add(top)

        # Generate projects/*.yaml（只产一级子项目；不再生成 relations 段——D-004 砍关系层，
        # 避免 446 条垃圾边复活，也避开已修的累积 bug 路径 ql-20260706-007）。
        projects_dir = Path(spec_root) / ".sillyspec" / "projects"
        projects_dir.mkdir(parents=True, exist_ok=True)

        name_map = {
            "backend": "Backend API",
            "frontend": "Frontend App",
            "daemon": "Daemon",
            "sillyhub-daemon": "SillyHub Daemon",
            "ppm": "PPM",
        }
        tech_stack_map = {
            "backend": ["Python", "FastAPI", "SQLAlchemy", "Pydantic"],
            "frontend": ["TypeScript", "Next.js", "React", "Tailwind CSS"],
            "daemon": ["TypeScript", "Node.js"],
            "sillyhub-daemon": ["TypeScript", "Node.js"],
            "ppm": ["Python", "FastAPI"],
        }
        role_service = {"backend", "frontend"}

        generated_files = 0
        for component_key in sorted(groups):
            project_def: dict = {
                "id": component_key,
                "name": name_map.get(component_key, component_key.capitalize()),
                "type": "component",
                "role": "service" if component_key in role_service else "library",
                "path": component_key,
                "tech_stack": tech_stack_map.get(component_key, []),
            }

            out_path = projects_dir / f"{component_key}.yaml"
            with out_path.open("w", encoding="utf-8") as f:
                yaml.dump(
                    project_def, f, default_flow_style=False, allow_unicode=True, sort_keys=False
                )
            generated_files += 1

        return {"generated_files": generated_files}

    # -- Scan-generate ---

    async def scan_generate(
        self,
        *,
        root_path: str,
        user_id: uuid.UUID,
        agent_service: "AgentService",
        provider: str | None = None,
        model: str | None = None,
        spec_strategy: str = "platform-managed",
        daemon_id: uuid.UUID | None = None,
    ) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID | None]:
        """创建 pending workspace + 派 scan lease 给绑定 daemon（daemon-client 唯一入口）。

        FR-06 / D-003@v1：backend 读不到客户端 root_path，跳过 _guard_path 本地校验；
        daemon-entity-binding 后绑定键为 daemon_id（per-member binding 行）。新建 workspace
        时若给 daemon_id，复用 upsert_my_binding 建成员绑定行，使 start_scan_dispatch 的
        MemberBindingResolver 能解析到 daemon。scan 产出由 daemon 端 sillyspec scan 生成 →
        task-09 postSpecSync 回传 → backend spec_root 覆盖（真理源在服务器）。

        2026-07-10-remove-server-local-workspace-mode：原 ``scan_generate``（server-local
        本地扫描版）已删，本方法由 ``scan_generate_daemon_client`` 改名而来作为唯一入口。

        Args:
            root_path: Absolute path to the user's project directory（在 daemon 宿主上）。
            user_id: User who initiated the scan request.
            agent_service: AgentService instance (injected by caller).
            daemon_id: 守护进程实体 id（稳定绑定键，建议必传——为 None 时不建 member
                binding 行，dispatch 解析 daemon 会失败）。
            spec_strategy: spec 同步策略（默认 platform-managed）。

        Returns:
            (workspace_id, agent_run_id) tuple.
        """
        # daemon_id 优先：早校验归属（与 create 流程一致，防跨用户劫持）。
        if daemon_id is not None:
            await self._guard_daemon_owned_by_user(daemon_id, user_id)
        workspace = await self._find_active_by_root_path(root_path)
        workspace_created = False
        if workspace is None:
            name = Path(root_path).name
            slug = slugify(name)
            existing_slug = await self._find_active_by_slug(slug)
            if existing_slug is not None:
                suffix = uuid.uuid4().hex[:8]
                slug = f"{slugify(name)[:90]}-{suffix}"
            now = datetime.now(UTC)
            workspace = Workspace(
                id=uuid.uuid4(),
                name=name,
                slug=slug,
                root_path=root_path,
                status="pending",
                created_by=user_id,
                created_at=now,
                updated_at=now,
                last_scanned_at=now,
            )
            self._session.add(workspace)
            await self._session.flush()
            await self._ensure_empty_spec_workspace(workspace.id, strategy=spec_strategy)
            # scan-generate：创建人自动添加为 owner
            await self._ensure_creator_as_owner(workspace.id, user_id=user_id)
            workspace_created = True
            # daemon_id 维度：建成员绑定行（workspace+user+daemon+path），对齐 create 流程，
            # 使后续 start_scan_dispatch 经 MemberBindingResolver 解析到该 daemon。
            if daemon_id is not None:
                from app.modules.workspace.member_runtimes.service import (
                    upsert_my_binding,
                )

                await upsert_my_binding(
                    self._session,
                    workspace.id,
                    user_id,
                    daemon_id=daemon_id,
                    root_path=root_path,
                    path_source="daemon-client",
                )
            await self._session.flush()  # 确保 member 行写入再提交

        existing_run = await self._find_active_scan_run(workspace.id)
        if existing_run is not None:
            return (workspace.id, existing_run.id, existing_run.agent_session_id)

        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        spec_ws = await spec_ws_svc.get(workspace.id)
        spec_root = spec_ws.spec_root

        agent_run = await agent_service.start_scan_dispatch(
            workspace_id=workspace.id,
            user_id=user_id,
            root_path=root_path,
            spec_root=spec_root,
            provider=provider,
            model=model,
        )
        log.info(
            "workspace.scan_generated.daemon_client",
            workspace_id=str(workspace.id),
            agent_run_id=str(agent_run.id),
            daemon_id=str(daemon_id) if daemon_id else None,
        )
        # D-006@v1：scan_generate 独立建工作区路径（不经 create）。新建 workspace 时
        # _ensure_creator_as_owner 已写 owner 角色；start_scan_dispatch（含其
        # _mark_no_online_daemon 分支）返回前已 commit，故此处为 commit 后失效，
        # 清 perm:*/ppm-scope:*。existing_run 早返回分支未写角色（workspace 已存在），免失效。
        if workspace_created:
            await invalidate_all_permissions()
        return (workspace.id, agent_run.id, agent_run.agent_session_id)

    async def _guard_daemon_owned_by_user(self, daemon_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """守护进程归属校验（task-10/11 补遗，D-004 / FR）。

        daemon_id 必须属于 user_id，否则抛 AppError(code=daemon_not_owned, 403)。
        与 member_runtimes.service.upsert_my_binding 的守护一致——防跨用户劫持。
        """
        from app.modules.daemon.model import DaemonInstance

        daemon = await self._session.get(DaemonInstance, daemon_id)
        if daemon is None or daemon.user_id != user_id:
            raise AppError(
                "该守护进程不属于当前用户，无法使用。",
                code="daemon_not_owned",
                http_status=403,
            )

    async def _ensure_creator_as_owner(
        self, workspace_id: uuid.UUID, *, user_id: uuid.UUID | None = None
    ) -> None:
        """Ensure the creator is a ``workspace_owner`` member of this workspace.

        Idempotent: caller may pass ``user_id`` explicitly for paths where
        ``created_by`` is not set on the workspace row yet. Skips silently when
        ``user_id`` is None (legacy test paths).
        """
        uid = user_id or getattr(
            (await self._session.get(Workspace, workspace_id)), "created_by", None
        )
        if uid is None:
            return
        role = (
            (
                await self._session.execute(
                    select(Role).where(col(Role.key) == "workspace_owner").limit(1)
                )
            )
            .scalars()
            .first()
        )
        if role is None:
            log.warning("workspace.owner_role_missing")
            return
        existing = (
            (
                await self._session.execute(
                    select(UserWorkspaceRole)
                    .where(col(UserWorkspaceRole.user_id) == uid)
                    .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            return  # already a member
        self._session.add(
            UserWorkspaceRole(
                user_id=uid,
                workspace_id=workspace_id,
                role_id=role.id,
                granted_by=uid,
            )
        )

    async def _ensure_empty_spec_workspace(
        self, workspace_id: uuid.UUID, *, strategy: str = "platform-managed"
    ) -> None:
        """为 daemon-client workspace 创建空 SpecWorkspace 占位（无 .sillyspec 内容）。

        与 _ensure_spec_workspace 区别：不 copytree，只建记录（strategy 由调用方传，
        默认 platform-managed；2026-06-28-daemon-client-spec-sync-strategy 起支持
        repo-mirrored/repo-native），spec_root 由 SpecWorkspaceService 内部生成
        {SPEC_DATA_ROOT}/{ws_id}），内容由后续 scan lease 产出经 task-09 sync 回传覆盖。
        """
        from app.modules.spec_workspace.schema import SpecWorkspaceCreate
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        try:
            await spec_ws_svc.get(workspace_id)
        except Exception:
            await spec_ws_svc.create(
                workspace_id=workspace_id,
                payload=SpecWorkspaceCreate(strategy=strategy),
            )

    async def _find_active_by_root_path(self, root_path: str) -> Workspace | None:
        """Find active (non-soft-deleted) workspace by root_path.

        Returns:
            Workspace record or None.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.root_path) == root_path)
            .where(col(Workspace.deleted_at).is_(None))
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _find_active_scan_run(self, workspace_id: uuid.UUID) -> AgentRun | None:
        """Find the most recent in-progress (pending/running) scan run
        associated with the given workspace.

        A scan run is identified by change_id IS NULL (it is not tied to a
        change execution). Returns None if no in-progress scan run exists.
        """
        arw_subq = select(AgentRunWorkspace.agent_run_id).where(
            col(AgentRunWorkspace.workspace_id) == workspace_id,
        )
        stmt = (
            select(AgentRun)
            .where(col(AgentRun.id).in_(arw_subq))
            .where(col(AgentRun.change_id).is_(None))
            .where(col(AgentRun.status).in_(["pending", "running"]))
            .order_by(col(AgentRun.started_at).desc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _find_active_by_slug(self, slug: str) -> Workspace | None:
        """Find active (non-soft-deleted) workspace by slug.

        Returns:
            Workspace record or None.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.slug) == slug)
            .where(col(Workspace.deleted_at).is_(None))
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _ensure_unique_slug(self, slug: str) -> str:
        """Return a unique slug, appending a short suffix if the slug is taken."""
        existing = await self._find_active_by_slug(slug)
        if existing is None:
            return slug
        suffix = uuid.uuid4().hex[:8]
        return f"{slug[:90]}-{suffix}"

    async def activate(self, workspace_id: uuid.UUID) -> Workspace:
        """Activate a pending workspace: copy .sillyspec, set status='active'."""
        workspace = await self.get(workspace_id)
        if workspace.status != "pending":
            return workspace

        workspace.status = "active"
        workspace.updated_at = datetime.now(UTC)
        workspace.last_scanned_at = datetime.now(UTC)

        # daemon-client 唯一路径：backend 读不到客户端 root_path，永远走空 spec 占位
        # （spec 来自 task-09 sync 回灌 / 后续 scan lease 产出）。
        await self._ensure_empty_spec_workspace(workspace.id)

        await self._session.commit()
        await self._session.refresh(workspace)
        log.info("workspace.activated", workspace_id=str(workspace.id))
        return workspace

    # -- Helpers ---

    async def _ensure_spec_workspace_from_platform(
        self,
        workspace: Workspace,
    ) -> None:
        """Ensure spec workspace exists — prefer platform storage if already present."""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        try:
            spec_ws = await spec_ws_svc.get(workspace.id)
            if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                platform_sillyspec = Path(spec_ws.spec_root) / ".sillyspec"
                if platform_sillyspec.is_dir():
                    # 组件不再落库（D-001@V1），仅 reparse changes（变更仍需从文件系统入库）。
                    try:
                        from app.modules.change.service import ChangeService

                        change_svc = ChangeService(self._session)
                        await change_svc.reparse(workspace.id)
                        log.info("spec_workspace.changes_imported", workspace_id=str(workspace.id))
                    except Exception as exc:
                        log.warning(
                            "spec_workspace.changes_import_failed",
                            workspace_id=str(workspace.id),
                            error=str(exc),
                        )
                    return
        except Exception:
            pass
        # daemon-client 唯一路径：无平台 spec / .sillyspec 时不再回退本地扫描
        # （backend 读不到客户端路径，由 task-09 sync 或后续 scan lease 产出）。

    async def _ensure_spec_workspace(
        self,
        workspace_id: uuid.UUID,
        sillyspec_path: str,
    ) -> None:
        """Copy .sillyspec to platform storage and import projects + changes."""
        import shutil

        from app.modules.spec_workspace.schema import SpecWorkspaceCreate
        from app.modules.spec_workspace.service import SpecWorkspaceService

        settings = get_settings()
        platform_root = f"{settings.spec_data_root}/{workspace_id}"
        platform_sillyspec = Path(platform_root) / ".sillyspec"

        # Copy .sillyspec tree from source to platform directory,
        # excluding .runtime/ (worktrees/artifacts — large, not needed on platform)
        source = Path(sillyspec_path)
        if source.is_dir():
            try:

                def _do_copy() -> None:
                    if platform_sillyspec.exists():
                        shutil.rmtree(platform_sillyspec)
                    shutil.copytree(
                        str(source),
                        str(platform_sillyspec),
                        ignore=shutil.ignore_patterns(".runtime"),
                        ignore_dangling_symlinks=True,
                    )

                # Wave C（性能）：rmtree+copytree 整个 .sillyspec 树（文档/变更/技能），
                # 同步 I/O 移到线程避免阻塞事件循环数秒。
                await asyncio.to_thread(_do_copy)
                log.info(
                    "spec_workspace.sillyspec_copied",
                    workspace_id=str(workspace_id),
                    source=str(source),
                    dest=str(platform_sillyspec),
                )
            except Exception as exc:
                log.warning(
                    "spec_workspace.sillyspec_copy_failed",
                    workspace_id=str(workspace_id),
                    source=str(source),
                    error=str(exc),
                )

        spec_ws_svc = SpecWorkspaceService(self._session)
        try:
            await spec_ws_svc.get(workspace_id)
        except Exception:
            await spec_ws_svc.create(
                workspace_id=workspace_id,
                payload=SpecWorkspaceCreate(
                    spec_root=platform_root,
                    strategy="platform-managed",
                    repo_sillyspec_path=sillyspec_path,
                ),
            )

        # 组件不再落库（D-001@V1），仅 reparse changes（变更仍需从文件系统入库）。
        try:
            from app.modules.change.service import ChangeService

            change_svc = ChangeService(self._session)
            await change_svc.reparse(workspace_id)
            log.info("spec_workspace.changes_imported", workspace_id=str(workspace_id))
        except Exception as exc:
            log.warning(
                "spec_workspace.changes_import_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

    @staticmethod
    def _guard_path(path: Path) -> None:
        """Translate filesystem problems into structured AppErrors."""
        try:
            if not path.exists():
                raise WorkspacePathNotFound(
                    "工作区路径不存在，请检查路径是否正确。",
                    details={"root_path": str(path)},
                )
            if not path.is_dir():
                raise WorkspacePathNotDir(
                    "工作区路径不是一个目录，请提供目录路径。",
                    details={"root_path": str(path)},
                )
        except PermissionError as exc:
            raise WorkspacePermissionDenied(
                "无权访问该工作区路径，请检查目录权限。",
                details={"root_path": str(path), "error": str(exc)},
            ) from exc

    @staticmethod
    def _translate_integrity_error(
        exc: IntegrityError,
        *,
        slug: str,
        root_path: str,
    ) -> None:
        """Map Postgres UNIQUE violations onto specific AppError subclasses."""
        msg = str(exc.orig or exc).lower()
        if "uq_workspaces_root_path" in msg or "root_path" in msg:
            raise WorkspacePathDuplicate(
                "该路径已绑定其他工作区，请勿重复添加。",
                details={"root_path": root_path},
            ) from exc
        if "uq_workspaces_slug" in msg or "slug" in msg:
            raise WorkspaceSlugDuplicate(
                "该 slug 已被其他工作区使用，请更换后重试。",
                details={"slug": slug},
            ) from exc
        # Fallback: re-raise as duplicate path which is the most common case.
        raise WorkspacePathDuplicate(
            "工作区唯一性约束冲突，请检查路径或 slug 是否重复。",
            details={"root_path": root_path, "slug": slug},
        ) from exc
