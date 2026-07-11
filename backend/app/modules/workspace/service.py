"""Workspace use cases.

This module is the single place that talks to both the filesystem (via
:class:`WorkspaceScanner`) and the DB. Routers stay thin and only translate
HTTP <-> service calls.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.agent.service import AgentService

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.errors import (
    AppError,
    WorkspaceNotFound,
    WorkspaceNotSillyspec,
    WorkspacePathDuplicate,
    WorkspacePathNotDir,
    WorkspacePathNotFound,
    WorkspacePermissionDenied,
    WorkspaceSlugDuplicate,
)
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.workspace.model import (
    AgentRunWorkspace,
    Workspace,
)
from app.modules.workspace.scanner import ScanResult, WorkspaceScanner
from app.modules.workspace.schema import WorkspaceCreate, WorkspaceUpdate, slugify

log = get_logger(__name__)


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
    ) -> Workspace:
        slug = payload.slug or slugify(payload.name)
        now = datetime.now(UTC)

        # If an active/pending workspace already exists for this root_path,
        # activate it instead of creating a new one.
        existing = await self._find_active_by_root_path(payload.root_path)
        if existing:
            if existing.status == "active":
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
            log.info("workspace.activated_from_create", workspace_id=str(existing.id))
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
            log.info("workspace.resurrected", workspace_id=str(resurrected.id))
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
        workspace_type: str | None = None,
        status: str | None = None,
        user_id: uuid.UUID | None = None,
        allowed_workspace_ids: list[uuid.UUID] | None = None,
    ) -> tuple[list[tuple[Workspace, User | None]], int]:
        """Filtered + paginated workspace list with owner JOIN (task-05 / FR-01/02/04).

        - ``allowed_workspace_ids is None``: 平台管理员全量。
        - ``allowed_workspace_ids == []``: 普通账号无可读 workspace，直接返回空。
        - ``user_id``: 精确匹配 created_by（仅平台管理员传入；普通账号不传）。
        - ``q``: 大小写不敏感匹配 display_alias/name/slug/root_path/component_key。
        - ``workspace_type``: 精确匹配 type（server-local/daemon-client 等 path_source
          值已不再分流，传入时静默忽略——前端选项已删，R-06）。
        - ``status``: 精确匹配 status。
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
            # path_source 分流已删（2026-07-10-remove-server-local-workspace-mode），
            # 一律按 type 列过滤；前端旧值（server-local/daemon-client）静默忽略无命中。
            filters.append(col(Workspace.type) == workspace_type)
        if status:
            filters.append(col(Workspace.status) == status)

        total_stmt = select(func.count()).select_from(Workspace)
        if filters:
            total_stmt = total_stmt.where(*filters)
        total = int((await self._session.scalar(total_stmt)) or 0)

        rows_stmt = (
            select(Workspace, User)
            .outerjoin(User, Workspace.created_by == User.id)
            .order_by(col(Workspace.created_at).desc())
            .limit(limit)
            .offset(offset)
        )
        if filters:
            rows_stmt = rows_stmt.where(*filters)
        rows = list((await self._session.execute(rows_stmt)).all())
        return [(ws, owner) for ws, owner in rows], total

    async def get(self, workspace_id: uuid.UUID) -> Workspace:
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None or workspace.deleted_at is not None:
            raise WorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace

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
                "workspace has no platform spec to rescan.",
                details={"workspace_id": str(workspace.id)},
            ) from None

        scan = self.scan(scan_path)
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
            raise WorkspacePermissionDenied("Only the workspace owner can delete this workspace.")
        now = datetime.now(UTC)
        workspace.deleted_at = now
        workspace.updated_at = now
        workspace.status = "deleted"
        await self._session.commit()
        await self._session.refresh(workspace)
        log.info("workspace.soft_deleted", workspace_id=str(workspace.id))
        return workspace

    async def update(
        self,
        workspace_id: uuid.UUID,
        payload: WorkspaceUpdate,
    ) -> Workspace:
        """Update an existing workspace with only the fields provided by the caller.

        Uses ``exclude_unset=True`` so omitted fields are left untouched.
        """
        ws = await self.get(workspace_id)
        changes = payload.model_dump(exclude_unset=True)
        if changes:
            # Pre-check slug uniqueness before mutating to avoid rollback issues
            # with SQLite sessions.
            new_slug = changes.get("slug")
            if new_slug is not None and new_slug != ws.slug:
                slug_stmt = (
                    select(Workspace)
                    .where(col(Workspace.slug) == new_slug)
                    .where(col(Workspace.deleted_at).is_(None))
                )
                existing = (await self._session.execute(slug_stmt)).scalars().first()
                if existing is not None:
                    raise WorkspaceSlugDuplicate(
                        "Another workspace already uses this slug.",
                        details={"slug": new_slug},
                    )

            for field, value in changes.items():
                setattr(ws, field, value)
            ws.updated_at = datetime.now(UTC)
            await self._session.commit()
            await self._session.refresh(ws)
            log.info(
                "workspace.updated",
                workspace_id=str(ws.id),
                updated_fields=list(changes.keys()),
            )
        return ws

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
            raise WorkspaceNotSillyspec(f"No _module-map.yaml found at {module_map_path}")

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
    ) -> tuple[uuid.UUID, uuid.UUID]:
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
            return (workspace.id, existing_run.id)

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
        return (workspace.id, agent_run.id)

    async def _guard_daemon_owned_by_user(self, daemon_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """守护进程归属校验（task-10/11 补遗，D-004 / FR）。

        daemon_id 必须属于 user_id，否则抛 AppError(code=daemon_not_owned, 403)。
        与 member_runtimes.service.upsert_my_binding 的守护一致——防跨用户劫持。
        """
        from app.modules.daemon.model import DaemonInstance

        daemon = await self._session.get(DaemonInstance, daemon_id)
        if daemon is None or daemon.user_id != user_id:
            raise AppError(
                "Daemon instance does not belong to you.",
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
                if platform_sillyspec.exists():
                    shutil.rmtree(platform_sillyspec)
                shutil.copytree(
                    str(source),
                    str(platform_sillyspec),
                    ignore=shutil.ignore_patterns(".runtime"),
                    ignore_dangling_symlinks=True,
                )
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
                    "The given root_path does not exist.",
                    details={"root_path": str(path)},
                )
            if not path.is_dir():
                raise WorkspacePathNotDir(
                    "The given root_path is not a directory.",
                    details={"root_path": str(path)},
                )
        except PermissionError as exc:
            raise WorkspacePermissionDenied(
                "Permission denied while inspecting root_path.",
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
                "Another workspace is already registered for this root_path.",
                details={"root_path": root_path},
            ) from exc
        if "uq_workspaces_slug" in msg or "slug" in msg:
            raise WorkspaceSlugDuplicate(
                "Another workspace already uses this slug.",
                details={"slug": slug},
            ) from exc
        # Fallback: re-raise as duplicate path which is the most common case.
        raise WorkspacePathDuplicate(
            "Workspace uniqueness constraint violated.",
            details={"root_path": root_path, "slug": slug},
        ) from exc
