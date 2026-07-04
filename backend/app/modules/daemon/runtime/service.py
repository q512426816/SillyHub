"""Runtime subdomain service — registration / heartbeat / lifecycle."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from sqlalchemy import func, or_, select, update
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.workspace.model import Workspace

if TYPE_CHECKING:
    from app.modules.daemon.schema import RuntimeUsageRead

log = get_logger(__name__)

DEFAULT_RUNTIME_STALE_SECONDS = 45

# 时间窗选项(service 层用 Literal 类型注解,router 层用 Pydantic Enum 校验)。
RuntimeUsageWindow = Literal["1d", "7d", "30d"]


# ── Domain errors / RPC errors (runtime 主对象 + WS 通道层；task-07 迁入) ──────
# 原 facade service.py:43/100/107/114/121/128/135/142 字符级搬入。code/http_status/
# docstring/__init__ 零变化（B4）。RPC 错误族统一归 runtime 子包：根因是 runtime
# 的 WS 连接态/通道问题，runtime 子域已持有 WS 连接管理（B2）。


class DaemonRuntimeNotFound(AppError):
    code = "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    http_status = 404


class DaemonInstanceOwnershipMismatch(AppError):
    """daemon_local_id 归属另一用户（design §5.2 step 1 防劫持）。

    daemon_instances.id 是 daemon 上报的本地 uuid。若同一 id 已被另一个 user 注册，
    本次注册的 user 与现存行 user_id 不一致 → 拒绝（403），防 daemon_local_id 伪造
    劫持他人 daemon 实体及其绑定。
    """

    code = "HTTP_403_DAEMON_INSTANCE_OWNERSHIP_MISMATCH"
    http_status = 403


class DaemonRuntimeInUse(AppError):
    """Daemon runtime 仍被一个或多个 workspace 绑定（R-06 RESTRICT）。

    ``workspaces.daemon_runtime_id`` 外键按设计是 RESTRICT（workspace/model.py
    + migration 202607030900 注释）：删除一个仍在为 workspace 服务的 daemon 应被
    阻止。这里把它翻译成 409 + 绑定 workspace 列表，让调用方先去解绑，而不是让 DB
    的 IntegrityError 冒泡成 500。
    """

    code = "HTTP_409_DAEMON_RUNTIME_IN_USE"
    http_status = 409


class DaemonRuntimeOffline(AppError):
    """Target daemon runtime has no active WS connection (R-01)."""

    code = "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    http_status = 504


# ── RPC errors (WS 通道层；root cause 是 runtime 连接态/通道问题) ────────────


class DaemonRpcTimeout(AppError):
    """RPC round-trip exceeded the per-call timeout (R-01)."""

    code = "HTTP_504_DAEMON_RPC_TIMEOUT"
    http_status = 504


class DaemonRpcConflict(AppError):
    """rpc_id collision in the pending map (UUID4 practical impossibility)."""

    code = "HTTP_409_DAEMON_RPC_ID_CONFLICT"
    http_status = 409


class DaemonRpcGatewayError(AppError):
    """WS channel-layer failure (offline / timeout / send failure) → 504."""

    code = "HTTP_504_DAEMON_RPC_GATEWAY"
    http_status = 504


class DaemonRpcForbiddenError(AppError):
    """daemon returned error.code=forbidden (allowed_roots violation, FR-04)."""

    code = "HTTP_403_DAEMON_RPC_FORBIDDEN"
    http_status = 403


class DaemonRpcRemoteGatewayError(AppError):
    """daemon returned a non-forbidden business error → 502."""

    code = "HTTP_502_DAEMON_RPC_REMOTE"
    http_status = 502


class DaemonRpcRemoteError(Exception):
    """Internal signal carrying a daemon error dict up the send_rpc call chain.

    Deliberately NOT an AppError: the HTTP endpoint re-maps it to
    DaemonRpcForbiddenError (403) or DaemonRpcRemoteGatewayError (502), so the
    raw daemon code/message never leaks directly to HTTP status mapping.
    """

    def __init__(self, error: dict) -> None:
        self.code = error.get("code", "unknown")
        self.message = error.get("message", "")
        super().__init__(f"daemon rpc error: {self.code}: {self.message}")


@dataclass
class RegisteredRuntime:
    """register_daemon 返回的单个 provider 运行时映射。"""

    provider: str
    runtime_id: uuid.UUID


@dataclass
class DaemonRegisterResult:
    """register_daemon 返回值（design §5.2 step 5）。

    daemon 侧缓存 ``runtimes`` 的 runtime_id，用于后续 WS payload 标识具体
    provider 会话（连接路由按 daemon_instance_id，WS payload 内仍带 runtime_id）。
    """

    daemon_instance_id: uuid.UUID
    runtimes: list[RegisteredRuntime]


class RuntimeService:
    """Runtime lifecycle: register / heartbeat / enable / disable / cleanup."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def register_daemon(
        self,
        user_id: uuid.UUID,
        *,
        daemon_local_id: uuid.UUID,
        server_url: str,
        hostname: str,
        os: str | None = None,
        arch: str | None = None,
        allowed_roots: list[str] | None = None,
        providers: list[dict] | None = None,
        daemon_version: str | None = None,
        daemon_build_id: str | None = None,
    ) -> DaemonRegisterResult:
        """Per-daemon 注册（design §5.2 / D-006 / D-001）。

        1. upsert daemon_instances by ``id=daemon_local_id``：复用身份，更新机器级
           字段（hostname/os/arch/allowed_roots/status=online/last_heartbeat_at）。
           归属校验：现有行 user_id 不匹配 → DaemonInstanceOwnershipMismatch (403)。
        2. 对每个 provider upsert daemon_runtimes by (daemon_instance_id, provider)：
           更新 version/status/last_heartbeat_at；新建时落 user_id/daemon_instance_id。
        3. stale 清理（design §9.2）：删除该 daemon_instance_id 下、本次未上报的
           runtime（provider 被卸载）。
        4. 返回 daemon_instance_id + 各 provider 的 runtime_id。
        """
        now = datetime.now(UTC)
        roots = allowed_roots if allowed_roots is not None else ["~/.sillyhub"]
        reported_providers: list[dict] = list(providers or [])

        # ── step 1: upsert daemon_instances ────────────────────────────────────
        instance = await self._session.get(DaemonInstance, daemon_local_id)
        if instance is None:
            instance = DaemonInstance(
                id=daemon_local_id,
                user_id=user_id,
                hostname=hostname,
                server_url=server_url,
                os=os,
                arch=arch,
                version=daemon_version,
                build_id=daemon_build_id,
                allowed_roots=roots,
                status="online",
                last_heartbeat_at=now,
            )
            self._session.add(instance)
            log.info(
                "daemon_instance_registered",
                daemon_instance_id=str(daemon_local_id),
                user_id=str(user_id),
                hostname=hostname,
            )
        else:
            if instance.user_id != user_id:
                raise DaemonInstanceOwnershipMismatch(
                    "daemon_local_id 已被其他用户注册，禁止跨用户复用守护进程身份。",
                    details={
                        "daemon_instance_id": str(daemon_local_id),
                        "owner_user_id": str(instance.user_id),
                    },
                )
            instance.hostname = hostname
            instance.server_url = server_url
            instance.os = os
            instance.arch = arch
            instance.version = daemon_version
            instance.build_id = daemon_build_id
            instance.allowed_roots = roots
            instance.status = "online"
            instance.last_heartbeat_at = now
            instance.updated_at = now
            self._session.add(instance)
            log.info(
                "daemon_instance_reregistered",
                daemon_instance_id=str(daemon_local_id),
                hostname=hostname,
            )

        # ── step 2: per-provider upsert daemon_runtimes ────────────────────────
        reported_provider_names = {
            item.get("provider") for item in reported_providers if item.get("provider")
        }
        existing_runtimes = (
            (
                await self._session.execute(
                    select(DaemonRuntime).where(
                        col(DaemonRuntime.daemon_instance_id) == daemon_local_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        existing_by_provider: dict[str, DaemonRuntime] = {
            (rt.provider or ""): rt for rt in existing_runtimes
        }

        result_runtimes: list[RegisteredRuntime] = []
        for item in reported_providers:
            provider_name = item.get("provider")
            if not provider_name:
                continue
            version = item.get("version")
            rt = existing_by_provider.get(provider_name)
            if rt is None:
                rt = DaemonRuntime(
                    id=uuid.uuid4(),
                    daemon_instance_id=daemon_local_id,
                    user_id=user_id,
                    name=hostname,
                    provider=provider_name,
                    version=version,
                    status="online",
                    last_heartbeat_at=now,
                    metadata_={},
                )
                self._session.add(rt)
                log.info(
                    "daemon_runtime_registered",
                    runtime_id=str(rt.id),
                    daemon_instance_id=str(daemon_local_id),
                    provider=provider_name,
                )
            else:
                rt.version = version
                if rt.status != "disabled":
                    rt.status = "online"
                rt.last_heartbeat_at = now
                rt.updated_at = now
                self._session.add(rt)
            result_runtimes.append(RegisteredRuntime(provider=provider_name, runtime_id=rt.id))

        # ── step 3: stale runtime cleanup（本次未上报的 provider）─────────────
        stale = [
            rt
            for provider, rt in existing_by_provider.items()
            if provider not in reported_provider_names
        ]
        for rt in stale:
            await self._session.delete(rt)
            log.info(
                "daemon_runtime_stale_removed",
                runtime_id=str(rt.id),
                daemon_instance_id=str(daemon_local_id),
                provider=rt.provider,
            )

        await self._session.commit()
        return DaemonRegisterResult(
            daemon_instance_id=daemon_local_id,
            runtimes=result_runtimes,
        )

    async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime:
        """Update heartbeat timestamp for a daemon runtime.

        2026-07-03-daemon-entity-binding task-07：provider 无独立心跳（design §9.2），
        daemon 单条心跳合并上报经 ``heartbeat_daemon``。本方法保留供残留调用方与
        单 runtime 测试使用（不再被 HTTP ``/heartbeat`` 端点调用）。
        """
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )

        now = datetime.now(UTC)
        runtime.last_heartbeat_at = now
        if runtime.status != "disabled":
            runtime.status = "online"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def heartbeat_daemon(
        self,
        daemon_local_id: uuid.UUID,
        providers: list[dict] | None = None,
        daemon_version: str | None = None,
        daemon_build_id: str | None = None,
    ) -> DaemonInstance:
        """Per-daemon 心跳（design §5.4 / §9.1 / D-006）。

        daemon 单条心跳合并上报 ``daemon_local_id`` + 各 provider 状态。backend：

        1. 刷新 ``daemon_instances.last_heartbeat_at=now``；若非 disabled 则
           ``status='online'``（daemon 实体在线）。daemon 实体不存在 → 404（必须先
           register，design §9.1 registered 事件先于 heartbeat）。
        2. 遍历 ``providers`` 更新对应 ``daemon_runtimes.status``（by
           ``daemon_instance_id + provider``）。``disabled`` 的 runtime 不被心跳
           拉回 online（保留管理员禁用意图，与旧 ``heartbeat`` 语义一致）。
        3. runtime 自身的 ``last_heartbeat_at`` 同步刷新（provider 级 status 快照
           列保留，design §9.2，仅 stale 判定不再以它为准）。

        heartbeat_ack 经 WS 下发到该 daemon 连接（task-06 通路），HTTP 响应只回
        ``{daemon_instance_id, status, allowed_roots}``。
        """
        instance = await self._session.get(DaemonInstance, daemon_local_id)
        if instance is None:
            raise DaemonRuntimeNotFound(
                f"Daemon instance '{daemon_local_id}' not found.",
                details={"daemon_local_id": str(daemon_local_id)},
            )

        now = datetime.now(UTC)
        instance.last_heartbeat_at = now
        instance.updated_at = now
        # 仅在上报非 None 时刷新版本（旧 daemon 不上报保持原值，D-008 兼容）。
        if daemon_version is not None:
            instance.version = daemon_version
        if daemon_build_id is not None:
            instance.build_id = daemon_build_id
        if instance.status != "disabled":
            instance.status = "online"
        self._session.add(instance)

        reported = list(providers or [])
        if reported:
            # 一次性取出该 daemon 下所有 runtime，按 provider 索引，避免逐条 get。
            runtimes = (
                (
                    await self._session.execute(
                        select(DaemonRuntime).where(
                            col(DaemonRuntime.daemon_instance_id) == daemon_local_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            by_provider: dict[str, DaemonRuntime] = {(rt.provider or ""): rt for rt in runtimes}
            for item in reported:
                provider_name = item.get("provider")
                if not provider_name:
                    continue
                rt = by_provider.get(provider_name)
                if rt is None:
                    # provider 在 register 后才会上报心跳；理论上不会缺失，缺失即跳过
                    # （register 才负责创建 runtime，design §9.2）。
                    continue
                rt_status = item.get("status") or "online"
                # disabled 保留（管理员禁用不被心跳推翻）；其余跟随上报值。
                if rt.status != "disabled":
                    rt.status = rt_status
                rt.last_heartbeat_at = now
                rt.updated_at = now
                self._session.add(rt)

        await self._session.commit()
        await self._session.refresh(instance)
        return instance

    async def get_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime | None:
        """Get a daemon runtime by ID.

        task-04 / D-001@v1: when ``user_id`` is supplied and the caller is not
        a platform admin, restrict to the owner — non-owners get ``None``
        (router translates to 404, no existence leak). Platform admins see any
        runtime. Omitting ``user_id`` keeps the legacy unconditional lookup
        (lease/WS paths resolve runtimes independently of owner).
        """
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            return None
        if user_id is not None and not is_platform_admin and runtime.user_id != user_id:
            return None
        return runtime

    async def list_runtimes(self, user_id: uuid.UUID) -> list[DaemonRuntime]:
        """List all runtimes for a given user."""
        stmt = (
            select(DaemonRuntime)
            .where(col(DaemonRuntime.user_id) == user_id)
            .order_by(col(DaemonRuntime.created_at).desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _get_runtimes_by_instance(self, instance_id: uuid.UUID) -> list[DaemonRuntime]:
        """Get all DaemonRuntime rows belonging to a daemon instance."""
        stmt = (
            select(DaemonRuntime)
            .where(col(DaemonRuntime.daemon_instance_id) == instance_id)
            .order_by(col(DaemonRuntime.provider))
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_instances(
        self,
        user_id: uuid.UUID,
    ) -> list[DaemonInstance]:
        """List online daemon instances for a user (task-10 / FR-09).

        Used by GET /api/daemon/instances for workspace-daemon-switcher.
        Returns only online instances. The caller joins provider runtimes.
        """
        stmt = (
            select(DaemonInstance)
            .where(col(DaemonInstance.user_id) == user_id)
            .where(col(DaemonInstance.status) == "online")
            .order_by(col(DaemonInstance.hostname))
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_runtimes_page(
        self,
        *,
        actor_user_id: uuid.UUID,
        is_platform_admin: bool,
        q: str | None,
        type_filter: str | None,
        status_filter: str | None,
        user_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> tuple[list[tuple[DaemonRuntime, User | None, DaemonInstance | None]], int]:
        """Paginated filtered runtime list with owner JOIN (task-04 / FR-01/02/04).

        - 普通账号固定追加 ``user_id == actor_user_id``；请求的 ``user_id`` 被忽略。
        - 平台管理员不限制 owner；传入 ``user_id`` 时按 owner 精确过滤。
        - ``q`` 大小写不敏感匹配 name/provider/version（display_alias 已上提到
          daemon_instances，本接口 runtime 维度暂不 JOIN instance 别名，按
          name/provider/version 过滤即可，前端机器级视图另走 daemon_instance 列表）。
        - ``type`` 精确匹配 provider；``status`` 精确匹配 status。
        - total 为过滤后总数；items 按 created_at DESC + limit/offset。
        """
        filters: list = []
        if is_platform_admin:
            if user_id is not None:
                filters.append(col(DaemonRuntime.user_id) == user_id)
        else:
            filters.append(col(DaemonRuntime.user_id) == actor_user_id)

        q_norm = (q or "").strip()
        if q_norm:
            pattern = f"%{q_norm}%"
            filters.append(
                or_(
                    col(DaemonRuntime.name).ilike(pattern),
                    col(DaemonRuntime.provider).ilike(pattern),
                    col(DaemonRuntime.version).ilike(pattern),
                )
            )
        if type_filter:
            filters.append(col(DaemonRuntime.provider) == type_filter)
        if status_filter:
            filters.append(col(DaemonRuntime.status) == status_filter)

        total_stmt = select(func.count()).select_from(DaemonRuntime)
        if filters:
            total_stmt = total_stmt.where(*filters)
        total = int((await self._session.scalar(total_stmt)) or 0)

        rows_stmt = (
            select(DaemonRuntime, User, DaemonInstance)
            .outerjoin(User, DaemonRuntime.user_id == User.id)
            .outerjoin(DaemonInstance, DaemonRuntime.daemon_instance_id == DaemonInstance.id)
            .order_by(col(DaemonRuntime.created_at).desc())
            .limit(limit)
            .offset(offset)
        )
        if filters:
            rows_stmt = rows_stmt.where(*filters)
        rows = list((await self._session.execute(rows_stmt)).all())
        return (
            [(runtime, owner, instance) for runtime, owner, instance in rows],
            total,
        )

    async def update_runtime(
        self,
        runtime_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        display_alias: str | None,
        display_alias_set: bool,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        """Update editable daemon fields (task-04 / D-002@v1).

        2026-07-03-daemon-entity-binding：display_alias 已上提到 daemon_instances
        （design §4.1/§4.2）。本方法经 runtime.daemon_instance_id 写到所属
        daemon_instance.display_alias。``display_alias_set`` 区分「字段省略 = 不变」
        与显式 ``null`` = 清空；空/空白串归一为 ``None``。返回值仍为 runtime（调用方
        读 DaemonRuntimeRead）。
        """
        runtime = await self._get_owned_runtime(
            runtime_id, actor_user_id, is_platform_admin=is_platform_admin
        )
        if display_alias_set and runtime.daemon_instance_id is not None:
            normalized = display_alias.strip() if display_alias else None
            instance = await self._session.get(DaemonInstance, runtime.daemon_instance_id)
            if instance is not None:
                instance.display_alias = normalized or None
                instance.updated_at = datetime.now(UTC)
                self._session.add(instance)
                await self._session.commit()
                await self._session.refresh(runtime)
        return runtime

    async def update_allowed_roots(
        self,
        runtime_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        allowed_roots: list[str],
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        """Update allowed_roots sandbox (2026-06-29-runtime-allowed-roots-config task-02).

        2026-07-03-daemon-entity-binding：allowed_roots 已上提到 daemon_instances
        （design §4.1/§4.2）。本方法经 runtime.daemon_instance_id 写到所属
        daemon_instance.allowed_roots。校验：每条绝对路径或 ``~`` 开头、去重、非空。
        """
        import re

        normalized: list[str] = []
        seen: set[str] = set()
        for path in allowed_roots:
            if not isinstance(path, str) or not path.strip():
                continue
            p = path.strip()
            # 绝对路径（Win 盘符 / POSIX /）或 ~ 开头
            if not (p.startswith("~") or re.match(r"^[A-Za-z]:[\\/]", p) or p.startswith("/")):
                raise ValueError(f"路径必须为绝对路径或 ~ 开头：{p}")
            if p not in seen:
                seen.add(p)
                normalized.append(p)
        if not normalized:
            raise ValueError("allowed_roots 至少一条有效路径")
        runtime = await self._get_owned_runtime(
            runtime_id, actor_user_id, is_platform_admin=is_platform_admin
        )
        if runtime.daemon_instance_id is not None:
            instance = await self._session.get(DaemonInstance, runtime.daemon_instance_id)
            if instance is not None:
                instance.allowed_roots = normalized
                instance.updated_at = datetime.now(UTC)
                self._session.add(instance)
                await self._session.commit()
                await self._session.refresh(runtime)
        return runtime

    async def mark_offline(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> DaemonRuntime:
        """Mark a daemon runtime as offline."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None or (user_id is not None and runtime.user_id != user_id):
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        now = datetime.now(UTC)
        if runtime.status != "disabled":
            runtime.status = "offline"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def disable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        """Disable a runtime for placement without losing heartbeat freshness."""
        runtime = await self._get_owned_runtime(
            runtime_id, user_id, is_platform_admin=is_platform_admin
        )
        now = datetime.now(UTC)
        runtime.status = "disabled"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def delete_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> None:
        """Physically delete an owned runtime (ql-20260621-012).

        DB ondelete=CASCADE removes bound ``daemon_task_leases`` and
        ``agent_sessions`` rows automatically. The daemon re-registers as a
        fresh runtime on its next heartbeat.

        ``workspaces.daemon_runtime_id`` 是 RESTRICT（R-06 cascade 明确 out of
        scope）：若有未软删 workspace 仍绑定本 runtime，抛 ``DaemonRuntimeInUse``
        (409) 并带 workspace 列表，让调用方先解绑，而非让 FK 违约束冒泡成 500。

        软删 workspace（deleted_at IS NOT NULL）的 ``daemon_runtime_id`` 不会被
        软删逻辑清理，但 DB FK RESTRICT 不看 ``deleted_at``，仍会拦截 DELETE。
        故对软删引用在此应用层 SET NULL 解绑（ql-20260625-002-7c3a），未软删绑定
        已在上面 409 拦截，这里只解软删引用，不影响活跃 workspace。
        """
        runtime = await self._get_owned_runtime(
            runtime_id, user_id, is_platform_admin=is_platform_admin
        )
        # 删前检查：被未软删 workspace 绑定的 runtime 不允许物理删除（RESTRICT）。
        # 排除 deleted_at IS NOT NULL 的软删 workspace，否则会永久卡住删除。
        bound = (
            await self._session.execute(
                select(Workspace.id, Workspace.name, Workspace.slug).where(
                    col(Workspace.daemon_runtime_id) == runtime_id,
                    col(Workspace.deleted_at).is_(None),
                )
            )
        ).all()
        if bound:
            names = ", ".join(row.slug or row.name or str(row.id) for row in bound)
            raise DaemonRuntimeInUse(
                f"该 daemon 仍被 {len(bound)} 个 workspace 绑定（{names}），"
                "请先在对应 workspace 中解除绑定后再删除",
                details={
                    "workspaces": [
                        {"id": str(row.id), "name": row.name, "slug": row.slug} for row in bound
                    ],
                },
            )
        # 软删 workspace 仍引用本 runtime 时，应用层 SET NULL 解绑（绕过 FK RESTRICT）。
        # 软删逻辑只置 deleted_at 不清 daemon_runtime_id，PG FK RESTRICT 不看 deleted_at
        # 会拦截 DELETE；SQLite 测试库 FK 不严测不出，PG 生产暴露 500（dialect 差异）。
        await self._session.execute(
            update(Workspace)
            .where(
                col(Workspace.daemon_runtime_id) == runtime_id,
                col(Workspace.deleted_at).is_not(None),
            )
            .values(daemon_runtime_id=None)
        )
        await self._session.delete(runtime)
        await self._session.commit()

    async def enable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> DaemonRuntime:
        """Enable a runtime, restoring online only when its heartbeat is fresh."""
        runtime = await self._get_owned_runtime(
            runtime_id, user_id, is_platform_admin=is_platform_admin
        )
        now = datetime.now(UTC)
        runtime.status = (
            "online"
            if self._is_recent_heartbeat(runtime.last_heartbeat_at, max_age_seconds)
            else "offline"
        )
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def cleanup_stale_runtimes(
        self,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> int:
        """Mark stale daemon entities (and their runtimes) offline.

        2026-07-03-daemon-entity-binding task-07（design §5.4 / §9.1 stale 事件）：
        stale 判定从 per-runtime ``last_heartbeat_at`` 改以
        ``daemon_instances.last_heartbeat_at`` 为准（provider 无独立心跳，§9.2）。
        daemon 实体超 ``max_age_seconds`` 未心跳 →

            daemon_instances.status = 'offline'
            + 其下**所有** daemon_runtimes.status = 'offline'（联动）

        ``disabled`` 的 runtime 保留 disabled（管理员禁用意图不被 stale 覆盖，与旧
        语义一致）。runtime 自身的 ``last_heartbeat_at`` 不再独立判定 stale。

        返回被标 offline 的 **daemon 实体** 数（旧实现返回 runtime 数；调用方仅作
        日志/告警，语义切换无副作用）。
        """
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        # 选出心跳过期（或从未心跳）的在线 daemon 实体。
        stale_instances = list(
            (
                await self._session.execute(
                    select(DaemonInstance).where(
                        col(DaemonInstance.status) == "online",
                        or_(
                            col(DaemonInstance.last_heartbeat_at).is_(None),
                            col(DaemonInstance.last_heartbeat_at) < cutoff,
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        if not stale_instances:
            return 0
        now = datetime.now(UTC)
        instance_ids = [inst.id for inst in stale_instances]
        for inst in stale_instances:
            inst.status = "offline"
            inst.updated_at = now
            self._session.add(inst)
        # 联动：把这些 daemon 下所有非 disabled runtime 标 offline（一次性查 + 改）。
        runtimes = (
            (
                await self._session.execute(
                    select(DaemonRuntime).where(
                        col(DaemonRuntime.daemon_instance_id).in_(instance_ids),
                        col(DaemonRuntime.status) != "disabled",
                    )
                )
            )
            .scalars()
            .all()
        )
        for rt in runtimes:
            rt.status = "offline"
            rt.updated_at = now
            self._session.add(rt)
        await self._session.commit()
        return len(stale_instances)

    async def _get_owned_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonRuntime:
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None or (not is_platform_admin and runtime.user_id != user_id):
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        return runtime

    @staticmethod
    def _is_recent_heartbeat(value: datetime | None, max_age_seconds: int) -> bool:
        if value is None:
            return False
        heartbeat_at = value if value.tzinfo else value.replace(tzinfo=UTC)
        return heartbeat_at >= datetime.now(UTC) - timedelta(seconds=max_age_seconds)

    # ── Usage aggregation (FR-03 / D-002@v1 / D-003@v2 / D-004@v1) ──────────────

    async def get_runtimes_usage(
        self,
        window: RuntimeUsageWindow,
    ) -> list[RuntimeUsageRead]:
        """Batch-aggregate token/cache/cost usage per runtime over a time window.

        单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2):每 run 经 ``agent_session_id`` /
        ``lease_id`` 各 LEFT JOIN 后唯一一行,``COALESCE(s.runtime_id, l.runtime_id)``
        优先 session,interactive run 同时挂 session+lease 也只算一次(R-03 resolved)。

        分组粒度(D-002@v1):1d→hour 桶(≤24 点),7d/30d→day 桶。
        since(D-004@v1):1d=本地自然日 today 00:00 转 UTC;7d/30d=now(UTC)-N 天。

        ⚠️ 方言分支(R-05):生产 PostgreSQL 用 ``date_trunc``;后端单测用 SQLite
        in-memory(conftest.py),SQLite 无 ``date_trunc``,改用 ``strftime``。
        通过 ``self._session.bind.dialect.name`` 分支。

        ⚠️ SQLite 时区比较陷阱(R-05 补充):SQLAlchemy ``DateTime(timezone=True)`` 列
        在 aiosqlite 下走 ORM 写入时**丢弃时区信息**,aware datetime 被存成本地 naive
        时刻(本地 +08:00 的 ``23:59:00`` 存成 naive ``23:59:00``),且 SQLite 字符串
        比较不识别 tz 后缀。故 SQLite 方言下:
        - WHERE 用 ``datetime(r.created_at) >= :since``(归一化,naive 不转 UTC);
        - ``since`` 传**本地 naive**(对齐 ORM 存储的本地 naive),见 ``_since_param``。
        生产 PG 是 timestamptz 原生 UTC 比较,WHERE 用 ``r.created_at >= :since`` 且
        since 传 aware UTC,不受此影响。
        """
        if window not in ("1d", "7d", "30d"):
            raise ValueError(f"invalid window: {window!r} (expected 1d|7d|30d)")

        since = self._compute_since(window)
        unit = self._bucket_unit(window)
        dialect = self._dialect_name()
        since_param = self._since_param(since, dialect)

        # ── summary(无时间桶)──
        summary_sql = sa_text(self._build_summary_sql(dialect))
        summary_rows = (
            (await self._session.execute(summary_sql, {"since": since_param})).mappings().all()
        )

        # ── daily(按时间桶;方言分支:PG date_trunc / SQLite strftime)──
        daily_sql = sa_text(self._build_daily_sql(dialect, unit))
        daily_params: dict[str, object] = {"since": since_param}
        daily_rows = (await self._session.execute(daily_sql, daily_params)).mappings().all()

        # ── 聚合成 RuntimeUsageRead(延迟 import 避免循环依赖)──
        from app.modules.daemon.schema import (
            RuntimeUsagePointRead,
            RuntimeUsageRead,
            RuntimeUsageSummaryRead,
        )

        summary_map: dict[str, RuntimeUsageSummaryRead] = {
            str(row["rid"]): RuntimeUsageSummaryRead(
                input_tokens=int(row["input_tokens"] or 0),
                output_tokens=int(row["output_tokens"] or 0),
                cache_read_tokens=int(row["cache_read_tokens"] or 0),
                cache_creation_tokens=int(row["cache_creation_tokens"] or 0),
                total_cost_usd=float(row["total_cost_usd"] or 0.0),
            )
            for row in summary_rows
        }
        daily_map: dict[str, list[RuntimeUsagePointRead]] = {}
        for row in daily_rows:
            rid = str(row["rid"])
            daily_map.setdefault(rid, []).append(
                RuntimeUsagePointRead(
                    ts=self._normalize_bucket_ts(row["bucket"], dialect),
                    input_tokens=int(row["input_tokens"] or 0),
                    output_tokens=int(row["output_tokens"] or 0),
                    cache_read_tokens=int(row["cache_read_tokens"] or 0),
                    cache_creation_tokens=int(row["cache_creation_tokens"] or 0),
                    total_cost_usd=float(row["total_cost_usd"] or 0.0),
                )
            )

        result = [
            RuntimeUsageRead(runtime_id=rid, summary=summary_map[rid], daily=daily_map.get(rid, []))
            for rid in summary_map
        ]
        log.info("runtime_usage_aggregated", window=window, runtime_count=len(result))
        return result

    def _dialect_name(self) -> str:
        """检测当前 session 绑定的 DB 方言名(postgresql / sqlite / ...)。

        AsyncSession.bind 返回 AsyncEngine,其 .dialect.name 用于分支:
        PG 用 ``date_trunc``,SQLite 用 ``strftime``(SQLite 无 date_trunc)。
        """
        bind = self._session.bind
        # AsyncEngine.dialect 同步暴露;async 绑定是 AsyncEngine(单测+生产均如此)。
        return bind.dialect.name

    @staticmethod
    def _since_param(since: datetime, dialect: str) -> datetime | str:
        """since 参数方言化(R-05 时区陷阱修复)。

        - PostgreSQL: 直接传 aware UTC datetime,timestamptz 列原生比较。
        - SQLite: ⚠️ 关键陷阱 —— SQLAlchemy ``DateTime(timezone=True)`` 列在
          aiosqlite 下走 ORM 写入时**丢弃时区信息**,aware datetime 被存成本地
          naive 时刻(如本地 +08:00 的 ``2026-06-23 23:59:00+08:00`` 存成 naive
          ``2026-06-23 23:59:00``)。``datetime(created_at)`` 对 naive 输入不做
          UTC 转换,原样返回 23:59。故 since 也必须用**本地 naive**与之对齐,
          否则比较错位(UTC 16:00 vs 本地 naive 23:59 → 昨天 run 被错误计入 1d 窗)。
          实现把 aware since 转**本地 tz** 再 strip tzinfo,格式化为
          ``YYYY-MM-DD HH:MM:SS.ffffff``(匹配 ``datetime()`` 输出)。
          生产 PG 是 timestamptz 原生 UTC 比较,不受此影响。
        """
        if dialect == "postgresql":
            return since
        # SQLite:转本地 tz naive(对齐 ORM 存储的本地 naive 时刻)
        since_local_naive = since.astimezone().replace(tzinfo=None)
        return since_local_naive.isoformat(sep=" ")

    @staticmethod
    def _build_summary_sql(dialect: str) -> str:
        """summary SQL(无时间桶),WHERE created_at 比较按方言归一化。

        - PG: ``r.created_at >= :since``(timestamptz 原生比较,since=aware UTC)。
        - SQLite: ``datetime(r.created_at) >= :since``(naive 原样归一化,since=本地 naive,
          对齐 ORM 存储的本地 naive 时刻,见 ``_since_param`` docstring)。
        """
        cmp = "r.created_at" if dialect == "postgresql" else "datetime(r.created_at)"
        return f"""
            SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                   SUM(COALESCE(r.input_tokens, 0))          AS input_tokens,
                   SUM(COALESCE(r.output_tokens, 0))         AS output_tokens,
                   SUM(COALESCE(r.cache_read_tokens, 0))     AS cache_read_tokens,
                   SUM(COALESCE(r.cache_creation_tokens, 0)) AS cache_creation_tokens,
                   SUM(COALESCE(r.total_cost_usd, 0))        AS total_cost_usd
            FROM agent_runs r
            LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
            LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
            WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
              AND {cmp} >= :since
            GROUP BY COALESCE(s.runtime_id, l.runtime_id)
        """

    @staticmethod
    def _build_daily_sql(dialect: str, unit: Literal["20min", "hour", "day"]) -> str:
        """构造 daily 时间桶 SQL,按方言分支(R-05)。

        桶粒度:20min(1d) / hour(7d) / day(30d)。
        - PostgreSQL: date_trunc 支持 hour/day;20min 桶用
          ``date_trunc('hour', ...) + FLOOR(minute/20)*interval '20 min'``。
        - SQLite: strftime;20min 桶用 strftime modifier 对齐到 20 分钟整点。
        """
        if dialect == "postgresql":
            if unit == "20min":
                bucket = (
                    "date_trunc('hour', r.created_at) "
                    "+ FLOOR(date_part('minute', r.created_at) / 20) * INTERVAL '20 minutes'"
                )
            elif unit == "hour":
                bucket = "date_trunc('hour', r.created_at)"
            else:
                bucket = "date_trunc('day', r.created_at)"
            return f"""
                SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                       {bucket}                                  AS bucket,
                       SUM(COALESCE(r.input_tokens, 0))          AS input_tokens,
                       SUM(COALESCE(r.output_tokens, 0))         AS output_tokens,
                       SUM(COALESCE(r.cache_read_tokens, 0))     AS cache_read_tokens,
                       SUM(COALESCE(r.cache_creation_tokens, 0)) AS cache_creation_tokens,
                       SUM(COALESCE(r.total_cost_usd, 0))        AS total_cost_usd
                FROM agent_runs r
                LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
                LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
                WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
                  AND r.created_at >= :since
                GROUP BY COALESCE(s.runtime_id, l.runtime_id),
                         {bucket}
                ORDER BY bucket ASC
            """
        # SQLite(及任何非 PG 方言,fallback 到 strftime)
        if unit == "20min":
            bucket = (
                "strftime('%Y-%m-%d %H:%M', r.created_at, "
                "'-' || (CAST(strftime('%M', r.created_at) AS INTEGER) % 20) || ' minutes')"
            )
        elif unit == "hour":
            bucket = "strftime('%Y-%m-%d %H', r.created_at)"
        else:
            bucket = "strftime('%Y-%m-%d', r.created_at)"
        return f"""
            SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                   {bucket}                               AS bucket,
                   SUM(COALESCE(r.input_tokens, 0))          AS input_tokens,
                   SUM(COALESCE(r.output_tokens, 0))         AS output_tokens,
                   SUM(COALESCE(r.cache_read_tokens, 0))     AS cache_read_tokens,
                   SUM(COALESCE(r.cache_creation_tokens, 0)) AS cache_creation_tokens,
                   SUM(COALESCE(r.total_cost_usd, 0))        AS total_cost_usd
            FROM agent_runs r
            LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
            LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
            WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
              AND datetime(r.created_at) >= :since
            GROUP BY COALESCE(s.runtime_id, l.runtime_id),
                     {bucket}
            ORDER BY bucket ASC
        """

    @staticmethod
    def _normalize_bucket_ts(bucket: object, dialect: str) -> datetime:
        """把 SQL 返回的 bucket 列统一解析成 aware UTC datetime。

        - PostgreSQL: ``date_trunc`` 返回 timestamptz/aware datetime,直接返回。
        - SQLite: ``strftime`` 返回 TEXT(``YYYY-MM-DD HH`` 或 ``YYYY-MM-DD``),
          解析为 naive datetime 后补 UTC tzinfo(桶本就是 UTC 归一化的)。
        """
        if isinstance(bucket, datetime):
            return bucket if bucket.tzinfo is not None else bucket.replace(tzinfo=UTC)
        # SQLite TEXT 桶
        text_bucket = str(bucket)
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H", "%Y-%m-%d"):
            try:
                return datetime.strptime(text_bucket, fmt).replace(tzinfo=UTC)
            except ValueError:
                continue
        # 兜底:fromisoformat(覆盖 ``YYYY-MM-DDTHH:MM:SS`` 等)
        return datetime.fromisoformat(text_bucket).replace(tzinfo=UTC)

    @staticmethod
    def _bucket_unit(window: RuntimeUsageWindow) -> Literal["20min", "hour", "day"]:
        """分组粒度:1d→20min 桶(≤72 点),7d→hour 桶(≤168 点),30d→day 桶(≤30 点)。"""
        if window == "1d":
            return "20min"
        if window == "7d":
            return "hour"
        return "day"

    @staticmethod
    def _compute_since(window: RuntimeUsageWindow) -> datetime:
        """起点(D-004@v1):1d=本地自然日 today 00:00 转 UTC;7d/30d=now(UTC)-N 天。

        created_at 为 timestamptz,返回 aware UTC datetime;SQLite 方言下再由
        ``_since_param`` 转 UTC naive ISO 字符串比较。
        """
        now_utc = datetime.now(UTC)
        if window == "1d":
            # 本地自然日 today 00:00;用本地时间计算再转 UTC
            local_now = now_utc.astimezone()  # 转本地 tz-aware
            local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            return local_midnight.astimezone(UTC)
        delta = {"7d": timedelta(days=7), "30d": timedelta(days=30)}[window]
        return now_utc - delta
