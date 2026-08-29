"""Runtime subdomain service — registration / heartbeat / lifecycle."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from sqlalchemy import case, exists, func, or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.grants.queries import SharedMachineRow, list_machines_shared_to_me
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

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
    """Daemon runtime 仍有进行中的任务/写回引用（D-003@v1 RESTRICT）。

    2026-07-05-daemon-client-change-binding-fix task-05：RESTRICT 检查表从
    ``workspaces.daemon_runtime_id``（新链路恒 NULL，失效）改为
    ``daemon_task_leases.runtime_id`` + ``daemon_change_writes.runtime_id``
    （D-003 保留 FK 处，派发+写回现算后有真实值）。只挡 in-flight
    （lease/change_write status pending/claimed），让调用方等待完成或取消后再删，
    而非让 in-flight 工作 CASCADE 静默丢失。
    """

    code = "HTTP_409_DAEMON_RUNTIME_IN_USE"
    http_status = 409


class DaemonMachineInUse(AppError):
    """机器级删除守卫命中：daemon 在跑 / 被工作区绑定 / 有共享授权 / 借用审计红线 / in-flight。

    ql-20260829-006-6a9e：DELETE /machines/{id} 的应用层前置检查族（心跳新鲜度 +
    三张 RESTRICT FK 表 + in-flight lease/change_write）。命中任一 → 409 中文可操作
    文案，避免 FK IntegrityError 500 与「删在线机器产生僵尸心跳」（daemon 仅对
    401/403 心跳失败重注册，404 只会无限重试）。
    """

    code = "HTTP_409_DAEMON_MACHINE_IN_USE"
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
    allowed_roots: list[str]


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
        started_at: datetime | None = None,
    ) -> DaemonRegisterResult:
        """Per-daemon 注册（design §5.2 / D-006 / D-001）。

        2026-08-05-daemon-start-time D-002@v1：started_at（daemon 进程启动时间）
        透传并写入 instance.started_at（new + else 两分支均写，register 直接落值）。
        可空兼容旧 daemon（不上报 → None，保持 NULL）。

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
                started_at=started_at,
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
            instance.started_at = started_at
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
                    allowed_roots=list(roots),
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
            result_runtimes.append(
                RegisteredRuntime(
                    provider=provider_name,
                    runtime_id=rt.id,
                    allowed_roots=list(rt.allowed_roots or []),
                )
            )

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

    async def heartbeat_daemon(
        self,
        daemon_local_id: uuid.UUID,
        providers: list[dict] | None = None,
        daemon_version: str | None = None,
        daemon_build_id: str | None = None,
        started_at: datetime | None = None,
        pending_update: dict | None = None,
        *,
        actor_user_id: uuid.UUID | None = None,
    ) -> DaemonInstance:
        """Per-daemon 心跳（design §5.4 / §9.1 / D-006）。

        2026-08-05-daemon-start-time D-002@v1：started_at 仿 daemon_version
        非空判断幂等覆盖（daemon 进程不重启 started_at 恒定，覆盖同值无副作用；
        daemon 重启后会先 register 重置，再 heartbeat 维持）。

        2026-08-29-daemon-selfupdate-safety task-06（FR-04 / D-004@v1）：
        ``pending_update``（``{reason, current_version, target_version}`` 三键 dict，
        router 层 DTO 已校验）upsert ``daemon_instances.pending_update``——首次落库
        或三元组内容变化 → 整对象重写并盖 ``since=now`` ISO；同内容重放心跳保留
        原 dict（含 since，防退化成最后心跳时间，design S4 / Grill M11）。
        ⚠ ``pending_update is None`` 即**清除置 NULL**（升级执行/取消路径收敛）——
        刻意与本方法兄弟字段 daemon_version/daemon_build_id/started_at 的「非 None
        才覆盖」语义相反：pydantic 请求模型中「缺省不携带」与「显式 null」不可
        区分，且单机单 daemon 无新旧进程交错，靠「无字段」显式清除才收敛
        （D-004@v1 锚定，勿被「对齐兄弟字段」误改回非空才覆盖）。

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

        task-03（security-audit-remediation / FR-12）：``actor_user_id`` 传入时
        校验 ``instance.user_id == actor_user_id``，不匹配抛 DaemonRuntimeNotFound
        （404，D-001@v1 owner-only——跨用户与不存在同语义，防止用本人有效凭据
        刷新他人 daemon 心跳保活）。可选参数兼容既有服务层直调测试；HTTP router
        恒传 user.id。
        """
        instance = await self._session.get(DaemonInstance, daemon_local_id)
        if instance is None:
            raise DaemonRuntimeNotFound(
                f"Daemon instance '{daemon_local_id}' not found.",
                details={"daemon_local_id": str(daemon_local_id)},
            )

        if actor_user_id is not None and instance.user_id != actor_user_id:
            log.warning(
                "daemon_heartbeat_ownership_mismatch",
                daemon_local_id=str(daemon_local_id),
                actor_user_id=str(actor_user_id),
            )
            raise DaemonRuntimeNotFound(
                f"Daemon instance '{daemon_local_id}' not found.",
                details={"daemon_local_id": str(daemon_local_id)},
            )
        if actor_user_id is None:
            # 服务层直调（内部路径/既有测试）：warn 便于审计遗漏面，行为不变。
            log.warning(
                "daemon_heartbeat_no_actor_check",
                daemon_local_id=str(daemon_local_id),
            )

        now = datetime.now(UTC)
        instance.last_heartbeat_at = now
        instance.updated_at = now
        # 仅在上报非 None 时刷新版本（旧 daemon 不上报保持原值，D-008 兼容）。
        if daemon_version is not None:
            instance.version = daemon_version
        if daemon_build_id is not None:
            instance.build_id = daemon_build_id
        if started_at is not None:
            instance.started_at = started_at
        # ── pending_update upsert（FR-04 / D-004@v1 / design S4）───────────────
        # ⚠ None 即清除置 NULL——与上方兄弟字段「非 None 才覆盖」刻意反向：pydantic
        # 请求模型缺省与显式 null 不可区分，单机单 daemon 无新旧进程交错，升级
        # 执行/取消路径靠「无字段」显式清除才收敛（D-004@v1，勿对齐兄弟字段）。
        if pending_update is None:
            instance.pending_update = None
        else:
            current = instance.pending_update
            same_pending = (
                current is not None
                and current.get("reason") == pending_update.get("reason")
                and current.get("current_version") == pending_update.get("current_version")
                and current.get("target_version") == pending_update.get("target_version")
            )
            # 同内容（reason+两版本三元组相等）保留原 dict（含 since）——since 是
            # pending 首次出现时刻，防退化成最后心跳时间（design S4 / Grill M11）；
            # 首落库或内容变化才整对象重写并盖 since=now。
            if not same_pending:
                instance.pending_update = {
                    "reason": pending_update.get("reason", ""),
                    "current_version": pending_update.get("current_version", ""),
                    "target_version": pending_update.get("target_version", ""),
                    "since": now.isoformat(),
                }
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

    async def count_pending_control_commands(self, daemon_instance_id: uuid.UUID) -> int:
        """该 daemon 全部 runtime 名下 pending 控制指令计数（task-04 / design A2）。

        心跳响应 ``pending_controls`` 字段的数据源（一次聚合查询，JOIN
        daemon_runtimes 按 ``daemon_instance_id`` 汇总；daemon 心跳循环据此
        触发控制指令补拉对账——A1/A2 约定字段名）。迁移期
        ``daemon_instance_id IS NULL`` 的旧 runtime 行不归属任何实体，天然
        不计入。纯读无副作用。
        """
        # lazy import：control_commands 属投递层新模块，保持 runtime 子包顶层
        # 依赖面不变（对齐本文件 host_fs RPC 等函数级 import 先例）。
        from app.modules.daemon.control_commands import STATUS_PENDING
        from app.modules.daemon.model import DaemonControlCommand

        stmt = (
            select(func.count())
            .select_from(DaemonControlCommand)
            .join(DaemonRuntime, DaemonControlCommand.runtime_id == DaemonRuntime.id)
            .where(
                DaemonRuntime.daemon_instance_id == daemon_instance_id,
                DaemonControlCommand.status == STATUS_PENDING,
            )
        )
        return int((await self._session.execute(stmt)).scalar() or 0)

    async def get_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
        *,
        is_platform_admin: bool = False,
    ) -> tuple[DaemonRuntime, DaemonInstance | None] | None:
        """Get a daemon runtime by ID, JOIN 其所属 daemon_instance。

        task-07（2026-08-04-daemon-version / FR-01 / D-004@v1）：照搬
        ``list_runtimes_page``（service.py:522-536）的 JOIN 先例，
        ``select(DaemonRuntime, DaemonInstance).outerjoin(DaemonInstance,
        DaemonRuntime.daemon_instance_id == DaemonInstance.id)``，使上层
        （task-08 序列化层）一次查询拿到 ``version`` / ``build_id`` 而无需二次查询。

        task-04 / D-001@v1 归属语义保留：``user_id`` 非空且非 admin 时按 owner
        过滤，非归属者得 ``None``（router 转 404，无存在性泄漏）；admin 看任意
        runtime；省略 ``user_id`` 保持 lease/WS 路径无条件查（无 owner 约束）。

        返回签名由 ``DaemonRuntime | None`` 改为
        ``tuple[DaemonRuntime, DaemonInstance | None] | None``：找不到仍 ``None``；
        找到则返回 ``(runtime, instance)``，迁移期 ``daemon_instance_id IS NULL``
        的旧行 ``instance=None``（outerjoin 保留，不漏行）。调用方解构点
        （router / WS / lease）由 task-08 同步——本任务仅改 service 层签名。
        """
        stmt = (
            select(DaemonRuntime, DaemonInstance)
            .outerjoin(
                DaemonInstance,
                DaemonRuntime.daemon_instance_id == DaemonInstance.id,
            )
            .where(col(DaemonRuntime.id) == runtime_id)
        )
        row = (await self._session.execute(stmt)).first()
        if row is None:
            return None
        runtime, instance = row
        if user_id is not None and not is_platform_admin and runtime.user_id != user_id:
            return None
        return runtime, instance

    async def list_runtimes(
        self, user_id: uuid.UUID
    ) -> list[tuple[DaemonRuntime, DaemonInstance | None]]:
        """List all runtimes for a given user, JOIN 各自所属 daemon_instance。

        task-07：照搬 ``list_runtimes_page`` 的 JOIN 模式，每行返回
        ``(runtime, instance)``；迁移期 ``daemon_instance_id IS NULL`` 的旧行
        ``instance=None``（outerjoin 保留）。task-08 router 解构时直接取
        ``instance.version`` / ``build_id``。
        """
        stmt = (
            select(DaemonRuntime, DaemonInstance)
            .outerjoin(
                DaemonInstance,
                DaemonRuntime.daemon_instance_id == DaemonInstance.id,
            )
            .where(col(DaemonRuntime.user_id) == user_id)
            .order_by(col(DaemonRuntime.created_at).desc())
        )
        rows = list((await self._session.execute(stmt)).all())
        return [(runtime, instance) for runtime, instance in rows]

    async def _get_runtimes_by_instance(
        self, instance_id: uuid.UUID
    ) -> list[tuple[DaemonRuntime, DaemonInstance | None]]:
        """Get all DaemonRuntime rows belonging to a daemon instance, JOIN instance。

        task-07：虽然按 instance_id 反查、instance 在该次查询里恒等于此 id 对应的行，
        仍 JOIN 返回 tuple 以对齐其它 5 处签名一致（上层复用通用解构逻辑，不特判）。
        """
        stmt = (
            select(DaemonRuntime, DaemonInstance)
            .outerjoin(
                DaemonInstance,
                DaemonRuntime.daemon_instance_id == DaemonInstance.id,
            )
            .where(col(DaemonRuntime.daemon_instance_id) == instance_id)
            .order_by(col(DaemonRuntime.provider))
        )
        rows = list((await self._session.execute(stmt)).all())
        return [(runtime, instance) for runtime, instance in rows]

    async def _get_runtimes_by_instances(
        self, instance_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[tuple[DaemonRuntime, DaemonInstance | None]]]:
        """Batch variant of :meth:`_get_runtimes_by_instance` (N+1 规避).

        task-07：分组值改 ``list[tuple[runtime, instance]]``，对齐其它 5 处签名。
        JOIN 一次性带回 instance（同一 batch 内的 runtime 可能属于不同 instance，
        outerjoin 各自匹配），上层解构统一。

        B2（性能，2026-07-24 代码健壮性优化）：一次 IN 查询取多个 instance 的 runtimes
        并按 ``daemon_instance_id`` 分组，供 list_daemon_instances 等"列表 + 每行 join
        runtimes"场景取代循环内逐实例查询。对齐 list_machines 的 runtimes_by_instance 模式。
        """
        if not instance_ids:
            return {}
        stmt = (
            select(DaemonRuntime, DaemonInstance)
            .outerjoin(
                DaemonInstance,
                DaemonRuntime.daemon_instance_id == DaemonInstance.id,
            )
            .where(col(DaemonRuntime.daemon_instance_id).in_(instance_ids))
            .order_by(col(DaemonRuntime.provider))
        )
        rows = list((await self._session.execute(stmt)).all())
        grouped: dict[uuid.UUID, list[tuple[DaemonRuntime, DaemonInstance | None]]] = {}
        for runtime, instance in rows:
            if runtime.daemon_instance_id is not None:
                grouped.setdefault(runtime.daemon_instance_id, []).append((runtime, instance))
        return grouped

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
    ) -> tuple[
        list[tuple[DaemonRuntime, User | None, DaemonInstance | None]],
        int,
        list[SharedMachineRow],
    ]:
        """Paginated filtered runtime list with owner JOIN (task-04 / FR-01/02/04).

        - 普通账号固定追加 ``user_id == actor_user_id``；请求的 ``user_id`` 被忽略。
        - 平台管理员不限制 owner；传入 ``user_id`` 时按 owner 精确过滤。
        - ``q`` 大小写不敏感匹配 name/provider/version（display_alias 已上提到
          daemon_instances，本接口 runtime 维度暂不 JOIN instance 别名，按
          name/provider/version 过滤即可，前端机器级视图另走 daemon_instance 列表）。
        - ``type`` 精确匹配 provider；``status`` 精确匹配 status。
        - total 为过滤后总数；items 按 created_at DESC + limit/offset。
        - 2026-08-28-daemon-agent-share task-07：末位附加 ``shared_to_me`` 行
          （grants.queries.list_machines_shared_to_me，design §5 Phase 2.2）——
          共享机器独立成块不混入 items；无授权数据时空列表，items 过滤零变化。
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
        # task-07：附加「共享给我的」机器块（不参与上面的过滤/分页语义）。
        shared = await list_machines_shared_to_me(self._session, actor_user_id=actor_user_id)
        return (
            [(runtime, owner, instance) for runtime, owner, instance in rows],
            total,
            shared,
        )

    async def update_runtime(
        self,
        runtime_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        display_alias: str | None,
        display_alias_set: bool,
        is_platform_admin: bool = False,
    ) -> tuple[DaemonRuntime, DaemonInstance | None]:
        """Update editable daemon fields (task-04 / D-002@v1).

        2026-07-03-daemon-entity-binding：display_alias 已上提到 daemon_instances
        （design §4.1/§4.2）。本方法经 runtime.daemon_instance_id 写到所属
        daemon_instance.display_alias。``display_alias_set`` 区分「字段省略 = 不变」
        与显式 ``null`` = 清空；空/空白串归一为 ``None``。

        task-07（2026-08-04-daemon-version）：写后回读一并 JOIN instance，返回签名
        由 ``DaemonRuntime`` 改为 ``tuple[DaemonRuntime, DaemonInstance | None]``。
        调用方（task-08 router）可直接取 ``instance.version`` / ``build_id`` 序列化，
        避免 PATCH 后再发一次查询。迁移期 ``daemon_instance_id IS NULL`` 的旧行
        ``instance=None``（outerjoin 保留，不漏行）。
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
        # 回读 instance（task-07）：写后回读一并带出 instance，使调用方（task-08
        # router）可直接取 ``instance.version`` / ``build_id`` 序列化，避免 PATCH 后
        # 再发一次查询。迁移期 ``daemon_instance_id IS NULL`` 的旧行返回 None。
        read_stmt = select(DaemonInstance).where(
            col(DaemonInstance.id) == runtime.daemon_instance_id
        )
        instance_row = (await self._session.execute(read_stmt)).scalars().first()
        return runtime, instance_row

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
        # 2026-07-06-allowed-roots-per-runtime：写 runtime 级（per-runtime 隔离），
        # 不写 instance（instance.allowed_roots 仅 daemon 上报刷新作机器级 default）。
        runtime.allowed_roots = normalized
        runtime.updated_at = datetime.now(UTC)
        self._session.add(runtime)
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

        D-003@v1（2026-07-05-daemon-client-change-binding-fix task-05）：删前
        RESTRICT 检查改查 ``daemon_task_leases.runtime_id`` + ``daemon_change_writes.runtime_id``
        （in-flight：status pending/claimed）。旧查 ``workspaces.daemon_runtime_id``
        在新链路恒 NULL（binding 不再写该列）→ 保护失效；新链路 lease/change_write
        的 runtime_id 由派发/写回现算填入有真实值，RESTRICT 保护恢复有效。任一命中 →
        抛 ``DaemonRuntimeInUse`` (409)，避免 in-flight 工作 CASCADE 静默丢失。

        2026-07-10-remove-server-local-workspace-mode task-09：legacy
        ``workspaces.daemon_runtime_id`` 列已 DROP（D-007 P0-4），原应用层 SET NULL
        解绑段整段删除。in-flight RESTRICT 检查保留（daemon-entity-binding 正交逻辑）。
        """
        runtime = await self._get_owned_runtime(
            runtime_id, user_id, is_platform_admin=is_platform_admin
        )
        # 删前检查：有 in-flight 任务/写回引用本 runtime 时禁止物理删除（D-003@v1，
        # 2026-07-05-daemon-client-change-binding-fix task-05）。
        #
        # 旧逻辑查 ``workspaces.daemon_runtime_id``（RESTRICT），但 daemon-entity-binding
        # 后该列退化为 NULL（新链路不再写）→ 查不到引用 → 误删 in-flight runtime。
        # 改查 ``daemon_task_leases.runtime_id`` + ``daemon_change_writes.runtime_id``
        # （D-003 保留 FK 处）：派发 placement 现算填 lease.runtime_id、写回
        # resolve_runtime_for_writeback 现算填 change_write.runtime_id，二者有真实值。
        # 只挡 in-flight（pending/claimed）；终态行（completed/expired/cancelled/done/failed）
        # 已不在工作流内，CASCADE 自动清理，不阻止删除。
        from app.modules.daemon.model import DaemonChangeWrite, DaemonTaskLease

        inflight_leases = (
            await self._session.execute(
                select(DaemonTaskLease.id).where(
                    col(DaemonTaskLease.runtime_id) == runtime_id,
                    col(DaemonTaskLease.status).in_(["pending", "claimed"]),
                )
            )
        ).all()
        inflight_writes = (
            await self._session.execute(
                select(DaemonChangeWrite.id).where(
                    col(DaemonChangeWrite.runtime_id) == runtime_id,
                    col(DaemonChangeWrite.status).in_(["pending", "claimed"]),
                )
            )
        ).all()
        if inflight_leases or inflight_writes:
            total = len(inflight_leases) + len(inflight_writes)
            raise DaemonRuntimeInUse(
                f"该 daemon runtime 仍有 {total} 个进行中的任务/写回"
                f"（lease {len(inflight_leases)} + change_write {len(inflight_writes)}），"
                "请等待完成或取消后再删除",
                details={
                    "inflight_leases": len(inflight_leases),
                    "inflight_change_writes": len(inflight_writes),
                },
            )
        # 2026-07-10-remove-server-local-workspace-mode task-09：legacy
        # ``workspaces.daemon_runtime_id`` 列已 DROP（D-007 P0-4），原应用层 SET NULL
        # UPDATE 在列 DROP 后必触发 ``UndefinedColumn``（PG）/ ``OperationalError``
        # （SQLite）→ 所有 daemon runtime 删除请求 500。整段删除，仅保留下面
        # ``session.delete(runtime)`` + ``commit()``（CASCADE 自动清理 bound 行）。
        await self._session.delete(runtime)
        await self._session.commit()

    async def delete_machine(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> None:
        """物理删除归属机器（daemon_instance 级，ql-20260829-006-6a9e）。

        守卫链（对齐 delete_runtime 并上提机器级，逐条 409 DaemonMachineInUse）：

        1. 归属校验：``_get_owned_instance``（越权/不存在合并 404）。
        2. 心跳守卫：``last_heartbeat_at`` 在 stale 窗口（默认 45s）内 → 拒绝。
           daemon 心跳 404 不触发重注册（仅 401/403 会，daemon.ts
           _sendHeartbeatOnce），删在跑机器 = 僵尸心跳循环；须先停止 daemon。
        3. RESTRICT 引用守卫（应用层前置，否则 FK IntegrityError 500）：
           - workspace_member_runtimes（daemon_id 直绑或旧 runtime_id 列遗留）
             → 提示先在工作区解绑；
           - daemon_runtime_grants（含 enabled=False 行——行即共享事实，RESTRICT
             不区分）→ 提示先撤销/删除共享授权；
           - daemon_borrow_audit（审计红线，无解绑路径）→ 如实告知不可删。
        4. in-flight 守卫：本机 runtimes 名下 pending/claimed 的
           daemon_task_leases / daemon_change_writes → 拒绝（避免 in-flight
           工作 CASCADE 静默丢失，同 delete_runtime D-003@v1）。
        5. 物理 DELETE：CASCADE 收敛 runtimes → sessions / leases /
           change_writes / control_commands / audit_log，scan_docs.runtime_id
           SET NULL；commit 包 IntegrityError 兜底转 409（未来新增 RESTRICT
           FK 不退化成 500）。
        """
        from sqlalchemy.exc import IntegrityError

        from app.modules.agent.model import DaemonBorrowAudit
        from app.modules.daemon.grants.model import DaemonRuntimeGrant
        from app.modules.daemon.model import DaemonChangeWrite, DaemonTaskLease
        from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

        instance = await self._get_owned_instance(
            instance_id, user_id, is_platform_admin=is_platform_admin
        )
        if self._is_recent_heartbeat(instance.last_heartbeat_at, max_age_seconds):
            raise DaemonMachineInUse(
                "该机器守护进程仍在心跳上报，请先停止该机器上的 daemon，待其离线后再删除。",
                details={
                    "daemon_instance_id": str(instance_id),
                    "guard": "heartbeat_fresh",
                },
            )

        # 本机 runtime id 集：工作区旧列 runtime_id 与 in-flight 检查共用。
        runtime_ids = list(
            (
                await self._session.execute(
                    select(DaemonRuntime.id).where(
                        col(DaemonRuntime.daemon_instance_id) == instance_id
                    )
                )
            )
            .scalars()
            .all()
        )

        bound_workspaces = (
            await self._session.execute(
                select(func.count())
                .select_from(WorkspaceMemberRuntime)
                .where(
                    or_(
                        col(WorkspaceMemberRuntime.daemon_id) == instance_id,
                        col(WorkspaceMemberRuntime.runtime_id).in_(runtime_ids),
                    )
                )
            )
        ).scalar_one()
        if bound_workspaces:
            raise DaemonMachineInUse(
                f"该机器仍绑定在 {bound_workspaces} 个工作区，请先在工作区成员守护进程设置中解绑后再删除。",
                details={
                    "daemon_instance_id": str(instance_id),
                    "workspace_bindings": bound_workspaces,
                },
            )

        grant_rows = (
            await self._session.execute(
                select(func.count())
                .select_from(DaemonRuntimeGrant)
                .where(col(DaemonRuntimeGrant.daemon_instance_id) == instance_id)
            )
        ).scalar_one()
        if grant_rows:
            raise DaemonMachineInUse(
                f"该机器存在 {grant_rows} 条共享授权记录，请先在共享管理中撤销后再删除。",
                details={
                    "daemon_instance_id": str(instance_id),
                    "grant_rows": grant_rows,
                },
            )

        borrow_audit_rows = (
            await self._session.execute(
                select(func.count())
                .select_from(DaemonBorrowAudit)
                .where(col(DaemonBorrowAudit.daemon_instance_id) == instance_id)
            )
        ).scalar_one()
        if borrow_audit_rows:
            raise DaemonMachineInUse(
                f"该机器存在 {borrow_audit_rows} 条借用审计记录（审计红线，须保留完整审计链），不可删除。",
                details={
                    "daemon_instance_id": str(instance_id),
                    "borrow_audit_rows": borrow_audit_rows,
                },
            )

        inflight_leases = (
            await self._session.execute(
                select(func.count())
                .select_from(DaemonTaskLease)
                .where(
                    col(DaemonTaskLease.runtime_id).in_(runtime_ids),
                    col(DaemonTaskLease.status).in_(["pending", "claimed"]),
                )
            )
        ).scalar_one()
        inflight_writes = (
            await self._session.execute(
                select(func.count())
                .select_from(DaemonChangeWrite)
                .where(
                    col(DaemonChangeWrite.runtime_id).in_(runtime_ids),
                    col(DaemonChangeWrite.status).in_(["pending", "claimed"]),
                )
            )
        ).scalar_one()
        if inflight_leases or inflight_writes:
            raise DaemonMachineInUse(
                f"该机器仍有 {inflight_leases + inflight_writes} 个进行中的任务/写回"
                f"（lease {inflight_leases} + change_write {inflight_writes}），"
                "请等待完成或取消后再删除",
                details={
                    "daemon_instance_id": str(instance_id),
                    "inflight_leases": inflight_leases,
                    "inflight_change_writes": inflight_writes,
                },
            )

        try:
            await self._session.delete(instance)
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise DaemonMachineInUse(
                "该机器仍被其他数据引用，无法删除，请检查是否有未解除的绑定关系。",
                details={"daemon_instance_id": str(instance_id)},
            ) from exc

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

    async def mark_instance_offline_delayed(self, daemon_instance_id: uuid.UUID) -> int:
        """WS 断开 10s 延迟降级落库（task-02 / D-007@v1）。

        由 ws_hub 断开延迟任务到期后经默认回调调用（取消判定在 ws_hub 侧：
        任务执行时复查 ``is_connected(daemon_instance_id)``，重连即跳过，本方法
        不再重复复查）。语义与 ``cleanup_stale_runtimes`` 的联动一致，但触发源
        是 WS 实连接断开而非心跳过期：

            daemon_instances.status: online → offline
            + 其下所有非 disabled daemon_runtimes.status → offline

        - 实体不存在 / 状态非 online（disabled 保留管理员意图、已 offline 幂等）
          → 返回 0 不写库。
        - 心跳恢复由既有 ``heartbeat_daemon`` 覆盖（instance + 上报 provider 的
          runtime 均拉回 online）；HTTP 心跳周期 15s 与 10s 延迟的相位差会留下
          最长一个心跳周期的 offline→online 抖动窗口——design A4 已声明可接受。
        """
        instance = await self._session.get(DaemonInstance, daemon_instance_id)
        if instance is None or instance.status != "online":
            return 0
        now = datetime.now(UTC)
        instance.status = "offline"
        instance.updated_at = now
        self._session.add(instance)
        # 联动：该 daemon 下所有非 disabled runtime 标 offline（同 stale 清理语义）。
        runtimes = (
            (
                await self._session.execute(
                    select(DaemonRuntime).where(
                        col(DaemonRuntime.daemon_instance_id) == daemon_instance_id,
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
        return 1

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

    # ── Machine-level aggregation（2026-07-07-daemon-machine-runtime-hierarchy）──
    # entity-binding 已把机器级字段上提到 daemon_instances（design §4），以下三个
    # 方法面向 **机器（DaemonInstance）** 一级资源做聚合 / 归属校验 / 别名 mutation。
    # service 层返 ORM 行 + runtimes dict（router/task-03 负责 _runtime_read 组装 DTO，
    # 对齐 list_runtimes_page「service 返 ORM 行、router 转 DTO」模式，零重复拼装）。

    async def list_machines(
        self,
        *,
        actor_user_id: uuid.UUID,
        is_platform_admin: bool,
        q: str | None,
        status: str | None,
        provider: str | None,
        user_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> tuple[
        list[tuple[DaemonInstance, User | None]],
        dict[uuid.UUID, list[DaemonRuntime]],
        int,
        list[SharedMachineRow],
    ]:
        """机器级分页/筛选聚合查询（design §5.1 / FR-1 / D-002 / D-003 / D-004）。

        - 先调 ``cleanup_stale_runtimes``（与 ``/runtimes/page`` 一致，保证 stale 已
          收敛——机器在线态权威来源是 ``daemon_instance.status``，D-002）。
        - 权限：admin 看全部（admin 传 ``user_id`` 则按 owner 精确过滤）；普通用户
          固定 ``instance.user_id == actor_user_id``（请求 ``user_id`` 忽略），对齐
          ``list_runtimes_page`` 的 ``is_platform_admin`` 分支（service.py:498-502）。
        - WHERE：``q``（max 200）ILIKE ``%q%`` 命中 hostname/display_alias + EXISTS
          子查询（该机器任一 runtime 的 provider ILIKE）；``status`` 精确匹配
          ``instance.status``；``provider`` EXISTS 子查询（含该 provider 的机器）。
        - ORDER BY：online 优先（case status=='online' → 0）→ last_heartbeat_at DESC。
        - 二次查询（N+1 规避，constraints）：本页 instance_ids → 一次性
          ``select(DaemonRuntime).where(daemon_instance_id IN ids).order_by(provider)``，
          Python 按 instance_id 分组成 dict；0-runtime 机器该键缺失，router 用
          ``.get(id, [])`` 兜底（D-003）。
        - 不内联用量（D-004：用量走 ``/runtimes/usage``，前端按 instance 分组聚合）。
        - 2026-08-28-daemon-agent-share task-07：末位附加 ``shared_to_me`` 行
          （design §5 Phase 2.2）——共享机器独立成块不混入 items，items 的
          owner 收窄逻辑保持（FR-03 修改类端点零变化）；无授权数据时空列表。

        返回 ``(rows, runtimes_by_instance, total, shared_to_me)``：``rows`` 为本页
        ``(instance, owner)`` 列表；``runtimes_by_instance`` 为
        ``{instance_id: [DaemonRuntime,...]}``；``total`` 为过滤后机器总数；
        ``shared_to_me`` 为共享给 actor 的机器行（grants.queries 契约五字段）。
        """
        # 与 /runtimes/page 一致：进入先收敛 stale（design §5.1 step 4 / D-002）。
        await self.cleanup_stale_runtimes()

        # ── WHERE 构造（权限 + q + status + provider）─────────────────────────
        filters: list = []
        if is_platform_admin:
            if user_id is not None:
                filters.append(col(DaemonInstance.user_id) == user_id)
        else:
            filters.append(col(DaemonInstance.user_id) == actor_user_id)

        q_norm = (q or "").strip()
        if q_norm:
            pattern = f"%{q_norm}%"
            # q 命中该机器任一 runtime 的 provider（EXISTS 子查询，命中
            # idx_daemon_runtimes_instance 索引，design §10）。
            provider_q = exists().where(
                col(DaemonRuntime.daemon_instance_id) == DaemonInstance.id,
                col(DaemonRuntime.provider).ilike(pattern),
            )
            filters.append(
                or_(
                    col(DaemonInstance.hostname).ilike(pattern),
                    col(DaemonInstance.display_alias).ilike(pattern),
                    provider_q,
                )
            )
        if status:
            filters.append(col(DaemonInstance.status) == status)
        if provider:
            # 含某 provider 的机器（EXISTS 子查询）。
            filters.append(
                exists().where(
                    col(DaemonRuntime.daemon_instance_id) == DaemonInstance.id,
                    col(DaemonRuntime.provider) == provider,
                )
            )

        # ── total（同样 WHERE，独立 count 查询）────────────────────────────────
        total_stmt = select(func.count()).select_from(DaemonInstance)
        if filters:
            total_stmt = total_stmt.where(*filters)
        total = int((await self._session.scalar(total_stmt)) or 0)

        # ── 主查询：JOIN users + WHERE/ORDER/LIMIT/OFFSET ─────────────────────
        # online 优先（case 0）→ last_heartbeat_at DESC（design §5.1 排序上提到 SQL）。
        order_expr = case(
            (col(DaemonInstance.status) == "online", 0),
            else_=1,
        )
        rows_stmt = (
            select(DaemonInstance, User)
            .outerjoin(User, DaemonInstance.user_id == User.id)
            .order_by(order_expr, col(DaemonInstance.last_heartbeat_at).desc())
            .limit(limit)
            .offset(offset)
        )
        if filters:
            rows_stmt = rows_stmt.where(*filters)
        raw_rows = list((await self._session.execute(rows_stmt)).all())
        # 解包 Row → tuple（与 list_runtimes_page:534 同款，对齐返回类型注解）。
        rows = [(instance, owner) for instance, owner in raw_rows]

        # ── 二次查询（N+1 规避）：本页 runtimes 一次性 IN 查询 ─────────────────
        instance_ids = [inst.id for inst, _owner in rows]
        runtimes_by_instance: dict[uuid.UUID, list[DaemonRuntime]] = {}
        if instance_ids:
            rt_rows = (
                (
                    await self._session.execute(
                        select(DaemonRuntime)
                        .where(col(DaemonRuntime.daemon_instance_id).in_(instance_ids))
                        .order_by(col(DaemonRuntime.provider))
                    )
                )
                .scalars()
                .all()
            )
            for rt in rt_rows:
                if rt.daemon_instance_id is not None:
                    runtimes_by_instance.setdefault(rt.daemon_instance_id, []).append(rt)

        # task-07：附加「共享给我的」机器块（独立查询，不影响上面的过滤/分页）。
        shared = await list_machines_shared_to_me(self._session, actor_user_id=actor_user_id)
        return rows, runtimes_by_instance, total, shared

    async def _get_owned_instance(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        is_platform_admin: bool = False,
    ) -> DaemonInstance:
        """取归属 daemon_instance（复刻 ``_get_owned_runtime`` 模式，design §5.2）。

        - 不存在 → ``DaemonRuntimeNotFound`` (404，资源不泄漏)；
        - 普通用户且 ``instance.user_id != user_id`` → 同样 404（对齐 runtime 侧：
          越权一律以 404 形态拒绝，不区分「不存在」与「无权」，避免存在性泄漏）；
        - admin 全局通过。
        """
        instance = await self._session.get(DaemonInstance, instance_id)
        if instance is None or (not is_platform_admin and instance.user_id != user_id):
            raise DaemonRuntimeNotFound(
                f"Daemon instance '{instance_id}' not found.",
                details={"daemon_instance_id": str(instance_id)},
            )
        return instance

    async def update_machine_alias(
        self,
        instance_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        display_alias: str | None,
        display_alias_set: bool,
        is_platform_admin: bool = False,
    ) -> DaemonInstance:
        """直写 ``daemon_instance.display_alias``（design §5.2 / D-001 / FR-2）。

        - 经 ``_get_owned_instance`` 取归属实例（越权 403 / 不存在 404）；
        - ``display_alias_set=False`` 不变；显式 ``null``/空白归一 ``None``
          （``strip()`` 后为空 → None，对齐 ``update_runtime`` 语义，service.py:560）；
        - 直写 instance（0-runtime 机器亦可改，不借道 runtime）；bump ``updated_at``；
        - 不写 runtime（调用方再聚合为 ``DaemonMachineRead``，task-03 router 负责）。
        """
        instance = await self._get_owned_instance(
            instance_id, actor_user_id, is_platform_admin=is_platform_admin
        )
        if display_alias_set:
            normalized = display_alias.strip() if display_alias else None
            instance.display_alias = normalized or None
            instance.updated_at = datetime.now(UTC)
            self._session.add(instance)
            await self._session.commit()
            await self._session.refresh(instance)
        return instance

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

        by_provider(FR-04-1,2026-08-29-usage-by-provider-model):``agent_run_model_usage``
        明细按 供应商×模型 聚合,同窗同 COALESCE 去重(见 ``_build_by_provider_sql``);
        无明细(老 daemon/老数据)→ 空列表。

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

        # ── by_provider(供应商×模型分组,明细表 agent_run_model_usage;FR-04-1)──
        by_provider_sql = sa_text(self._build_by_provider_sql(dialect))
        by_provider_rows = (
            (await self._session.execute(by_provider_sql, {"since": since_param})).mappings().all()
        )

        # ── 聚合成 RuntimeUsageRead(延迟 import 避免循环依赖)──
        from app.modules.daemon.schema import (
            ProviderModelUsageRead,
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

        # by_provider 按 rid 分组(注意 pid 是 provider uuid 不是 runtime;runtime
        # 归属由 SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid 单独给出)。
        by_provider_map: dict[str, list[ProviderModelUsageRead]] = {}
        for row in by_provider_rows:
            rid = str(row["rid"])
            # SUM(u.api_requests) 理论可 NULL(明细行缺 api_requests 时)→ None 透传
            api_requests_raw = row["api_requests"]
            by_provider_map.setdefault(rid, []).append(
                ProviderModelUsageRead(
                    provider_id=row["pid"],
                    provider_name=row["pname"] if row["pname"] is not None else "未记录",
                    model=str(row["model"]),
                    input_tokens=int(row["input_tokens"] or 0),
                    output_tokens=int(row["output_tokens"] or 0),
                    cache_read_tokens=int(row["cache_read_tokens"] or 0),
                    cache_creation_tokens=int(row["cache_creation_tokens"] or 0),
                    api_requests=(int(api_requests_raw) if api_requests_raw is not None else None),
                )
            )

        result = [
            RuntimeUsageRead(
                runtime_id=rid,
                summary=summary_map[rid],
                daily=daily_map.get(rid, []),
                by_provider=by_provider_map.get(rid, []),
            )
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
    def _build_by_provider_sql(dialect: str) -> str:
        """by_provider SQL(供应商×模型分组,FR-04-1 / design §4.3)。

        明细表 ``agent_run_model_usage`` JOIN ``agent_runs`` → LEFT JOIN
        ``llm_providers``(老 run 未记录供应商时 pid/pname 为 NULL,装配层归
        「未记录」);runtime 归属沿用 summary 的 COALESCE 双 JOIN 去重——SELECT
        额外投影 ``rid`` 并一并 GROUP BY,让分组按 (runtime, provider, model)
        落桶。纯 GROUP BY 无时间桶,不需要 date_trunc/strftime;仅 ``created_at``
        比较照 ``_build_summary_sql`` 的方言分支(见 ``cmp`` 变量)。
        """
        cmp = "r.created_at" if dialect == "postgresql" else "datetime(r.created_at)"
        return f"""
            SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                   p.id                                     AS pid,
                   p.name                                   AS pname,
                   u.model                                  AS model,
                   SUM(COALESCE(u.input_tokens, 0))          AS input_tokens,
                   SUM(COALESCE(u.output_tokens, 0))         AS output_tokens,
                   SUM(COALESCE(u.cache_read_tokens, 0))     AS cache_read_tokens,
                   SUM(COALESCE(u.cache_creation_tokens, 0)) AS cache_creation_tokens,
                   SUM(u.api_requests)                       AS api_requests
            FROM agent_run_model_usage u
            JOIN agent_runs r ON u.run_id = r.id
            LEFT JOIN llm_providers p ON p.id = r.llm_provider_id
            LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
            LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
            WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
              AND {cmp} >= :since
            GROUP BY COALESCE(s.runtime_id, l.runtime_id),
                     p.id,
                     p.name,
                     u.model
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
