"""DaemonLeaseService — lease management, expiry detection, and idempotency."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonTaskLease

if TYPE_CHECKING:
    pass

log = get_logger(__name__)


# ── Domain errors ─────────────────────────────────────────────────────────────


class LeaseConflict(AppError):
    """An active, unexpired lease already exists for the target agent_run."""

    code = "HTTP_409_LEASE_CONFLICT"
    http_status = 409


class LeaseNotFound(AppError):
    """Requested lease does not exist."""

    code = "HTTP_404_LEASE_NOT_FOUND"
    http_status = 404


class LeaseTokenMismatch(AppError):
    """The supplied claim_token does not match the lease."""

    code = "HTTP_403_LEASE_TOKEN_MISMATCH"
    http_status = 403


class LeaseNotClaimable(AppError):
    """Lease is not in a state that allows the requested operation."""

    code = "HTTP_409_LEASE_NOT_CLAIMABLE"
    http_status = 409


# ── Service ───────────────────────────────────────────────────────────────────


class DaemonLeaseService:
    """守护进程租赁管理。

    负责 claim 幂等性、心跳续期、过期检测和取消。
    不引入 WebSocket Hub 依赖（Wave 2 才实现），
    WS 取消信号用日志桩代替。
    """

    LEASE_DURATION_SECONDS: int = 60  # 每次心跳续期 60 秒

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Claim ──────────────────────────────────────────────────────────────

    async def claim_task(
        self,
        runtime_id: uuid.UUID,
        agent_run_id: uuid.UUID,
    ) -> DaemonTaskLease | None:
        """幂等认领任务。

        1. 检查 agent_run 对应的 lease：
           - 无 active lease → 创建并返回
           - 已有 active lease 且未过期 → 拒绝（409 Conflict）
           - 已有 lease 但已过期 → 更新 attempt_number，重新 claim
        2. 设置 lease_expires_at = now + 60s
        3. 返回 lease（包含 claim_token）

        Args:
            runtime_id: 守护进程运行时 ID。
            agent_run_id: 要认领的 agent run ID。

        Returns:
            新创建或重新认领的 DaemonTaskLease。

        Raises:
            LeaseConflict: 已有未过期的 active lease。
        """
        now = datetime.now(UTC)

        # 查找该 agent_run 对应的最近一条 lease（不限 status）
        stmt = (
            select(DaemonTaskLease)
            .where(col(DaemonTaskLease.agent_run_id) == agent_run_id)
            .order_by(col(DaemonTaskLease.created_at).desc())
            .limit(1)
        )
        existing: DaemonTaskLease | None = (await self._session.execute(stmt)).scalars().first()

        if existing is not None:
            # 已有 lease，检查状态
            # Normalize expires_at to UTC-aware for comparison (SQLite stores naive datetimes)
            _expires = existing.lease_expires_at
            if _expires and _expires.tzinfo is None:
                _expires = _expires.replace(tzinfo=UTC)
            if existing.status == "claimed" and _expires and _expires > now:
                # active 且未过期 → 拒绝
                log.warning(
                    "claim_rejected_active_lease",
                    lease_id=str(existing.id),
                    agent_run_id=str(agent_run_id),
                    runtime_id=str(runtime_id),
                    expires_at=str(existing.lease_expires_at),
                )
                raise LeaseConflict(
                    f"Agent run '{agent_run_id}' already has an active lease.",
                    details={
                        "agent_run_id": str(agent_run_id),
                        "existing_lease_id": str(existing.id),
                        "lease_expires_at": existing.lease_expires_at.isoformat()
                        if existing.lease_expires_at
                        else None,
                    },
                )

            # lease 已过期或非 claimed → 重新 claim
            claim_token = secrets.token_hex(32)
            new_attempt = (existing.attempt_number or 0) + 1
            new_expires = now + DaemonLeaseService._timedelta_seconds(self.LEASE_DURATION_SECONDS)

            existing.runtime_id = runtime_id
            existing.status = "claimed"
            existing.claimed_at = now
            existing.lease_expires_at = new_expires
            existing.attempt_number = new_attempt
            existing.metadata_ = {
                **(existing.metadata_ or {}),
                "claim_token": claim_token,
                "last_heartbeat_at": now.isoformat(),
            }
            existing.updated_at = now
            self._session.add(existing)
            await self._session.commit()
            await self._session.refresh(existing)

            log.info(
                "lease_reclaimed",
                lease_id=str(existing.id),
                agent_run_id=str(agent_run_id),
                runtime_id=str(runtime_id),
                attempt_number=new_attempt,
            )
            return existing

        # 无 lease → 创建新 lease
        claim_token = secrets.token_hex(32)
        new_expires = now + DaemonLeaseService._timedelta_seconds(self.LEASE_DURATION_SECONDS)

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=runtime_id,
            agent_run_id=agent_run_id,
            status="claimed",
            claimed_at=now,
            lease_expires_at=new_expires,
            attempt_number=1,
            metadata_={
                "claim_token": claim_token,
                "last_heartbeat_at": now.isoformat(),
            },
            created_at=now,
            updated_at=now,
        )
        self._session.add(lease)
        await self._session.commit()
        await self._session.refresh(lease)

        log.info(
            "lease_created",
            lease_id=str(lease.id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
            attempt_number=1,
        )
        return lease

    # ── Heartbeat ──────────────────────────────────────────────────────────

    async def heartbeat_lease(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
    ) -> bool:
        """心跳续期。

        1. 验证 claim_token 匹配
        2. 更新 lease_expires_at = now + 60s
        3. 更新 metadata.last_heartbeat_at
        4. 返回是否续期成功

        Args:
            lease_id: Lease 的 ID。
            claim_token: 认领时生成的 token。

        Returns:
            True 表示续期成功。
        """
        now = datetime.now(UTC)
        lease = await self._validate_claim_token(lease_id, claim_token)

        new_expires = now + DaemonLeaseService._timedelta_seconds(self.LEASE_DURATION_SECONDS)
        lease.lease_expires_at = new_expires
        lease.updated_at = now
        metadata = dict(lease.metadata_ or {})
        metadata["last_heartbeat_at"] = now.isoformat()
        lease.metadata_ = metadata

        self._session.add(lease)
        await self._session.commit()

        log.info(
            "lease_heartbeat",
            lease_id=str(lease_id),
            new_expires_at=str(new_expires),
        )
        return True

    # ── Expire ─────────────────────────────────────────────────────────────

    async def expire_overdue_leases(self) -> list[uuid.UUID]:
        """定时任务：每分钟执行。

        1. 查找 lease_expires_at < now 且 status='claimed' 的 leases
        2. 设置 status='expired'
        3. 返回对应的 agent_run_ids，触发回退逻辑

        Returns:
            过期的 agent_run_id 列表。
        """
        now = datetime.now(UTC)

        stmt = select(DaemonTaskLease).where(
            col(DaemonTaskLease.status) == "claimed",
            col(DaemonTaskLease.lease_expires_at) < now,
        )
        overdue = list((await self._session.execute(stmt)).scalars().all())

        if not overdue:
            return []

        expired_agent_run_ids: list[uuid.UUID] = []
        for lease in overdue:
            lease.status = "expired"
            lease.updated_at = now
            self._session.add(lease)

            if lease.agent_run_id is not None:
                expired_agent_run_ids.append(lease.agent_run_id)

            log.info(
                "lease_expired",
                lease_id=str(lease.id),
                agent_run_id=str(lease.agent_run_id),
                runtime_id=str(lease.runtime_id),
            )

        await self._session.commit()
        return expired_agent_run_ids

    # ── Cancel ─────────────────────────────────────────────────────────────

    async def cancel_lease(self, agent_run_id: uuid.UUID) -> None:
        """取消租赁（用户主动取消任务）。

        ql-20260617-004：用户取消时立即把 AgentRun 置为 killed（写 finished_at），
        给用户即时视觉反馈，不再依赖 daemon heartbeat 轮询。daemon 后续通过
        complete_lease(status="cancelled") 收尾时，terminal-priority 守卫保证
        killed 不会被 cancelled 覆盖（priority: killed > cancelled > ...）。

        1. 设置 lease status='cancelled'
        2. agent_run 若非终态 → 立即置 killed + finished_at（用户视角立即生效）
        3. 若 lease 为 claimed（daemon 正在跑）：daemon 心跳感知到 cancelled
           → SIGTERM 子进程；syncStatus 上报也会被 priority 守卫拦下

        Args:
            agent_run_id: 要取消的 agent run ID。
        """
        now = datetime.now(UTC)

        # 查找该 agent_run 的 active lease
        stmt = (
            select(DaemonTaskLease)
            .where(
                col(DaemonTaskLease.agent_run_id) == agent_run_id,
                col(DaemonTaskLease.status).in_(["claimed", "pending"]),
            )
            .order_by(col(DaemonTaskLease.created_at).desc())
            .limit(1)
        )
        lease = (await self._session.execute(stmt)).scalars().first()

        if lease is None:
            log.warning(
                "cancel_lease_no_active_lease",
                agent_run_id=str(agent_run_id),
            )
            # 即使没有 active lease，agent_run 若仍 pending/running 也要收尾
            await self._mark_agent_run_killed_if_pending(agent_run_id, now)
            return

        prior_status = lease.status
        lease.status = "cancelled"
        lease.updated_at = now
        self._session.add(lease)
        await self._session.commit()

        log.info(
            "lease_cancelled",
            lease_id=str(lease.id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(lease.runtime_id),
            prior_status=prior_status,
        )

        # ql-20260617-004：无论 pending 还是 claimed，立即把 AgentRun 标记为
        # killed。pending 场景 daemon 不会触发心跳，必须在此收尾；claimed 场景
        # 立即标记给用户即时反馈，daemon complete_lease(cancelled) 会被 priority 守卫拦下。
        await self._mark_agent_run_killed_if_pending(agent_run_id, now)

        # ql-20260712-001（审计 P0-1）：interactive lease 必须显式 WS 下发
        # SESSION_INTERRUPT，否则 daemon 端 interactive session 不进 lease 心跳
        # 循环（daemon.ts:3234 直接 return），SDK 进程会在 daemon 内存里继续烧
        # token 成僵尸——lease/AgentRun 在 DB 已 killed 但 daemon 侧 query 仍在跑。
        # batch lease 靠 daemon heartbeat 轮询感知 cancelled → SIGTERM，无需 WS。
        # best-effort：WS 失败不阻塞 cancel（DB 已收尾，与 end_session 容错一致）。
        if lease.kind == "interactive":
            await self._send_interactive_cancel(lease)

        # task-04 / D-003 / D-008：interactive lease 取消收口 1:1 绑定的 AgentSession。
        # kill=正常终止（非 failed），辅助函数对 killed run 返 failed 不适用，故
        # 直接 set session.status='ended'。门控 lease.kind=='interactive' 覆盖
        # 对话/stage/scan/quick-chat（placement.py:264 起 lease kind 均为 interactive）。
        # D-005 幂等守卫：仅 pending/active/reconnecting 才收口。
        if lease.kind == "interactive":
            agent_run = await self._session.get(AgentRun, agent_run_id)
            if agent_run is not None and agent_run.agent_session_id is not None:
                session = await self._session.get(AgentSession, agent_run.agent_session_id)
                if session is not None and session.status in (
                    "pending",
                    "active",
                    "reconnecting",
                ):
                    session.status = "ended"
                    session.ended_at = now
                    self._session.add(session)
                    await self._session.commit()

    async def _mark_agent_run_killed_if_pending(
        self,
        agent_run_id: uuid.UUID,
        now: datetime,
    ) -> None:
        """把 agent_run 从 pending/running 置为 killed 并写 finished_at。

        幂等：已是终态（completed/failed/killed/cancelled）则不动。
        """
        ar = await self._session.get(AgentRun, agent_run_id)
        if ar is None:
            log.warning(
                "cancel_lease_agent_run_missing",
                agent_run_id=str(agent_run_id),
            )
            return
        prior_status = ar.status
        if prior_status in ("completed", "failed", "killed", "cancelled"):
            return
        ar.status = "killed"
        ar.finished_at = now
        if ar.exit_code is None:
            ar.exit_code = -1
        self._session.add(ar)
        await self._session.commit()
        log.info(
            "agent_run_killed_by_cancel",
            agent_run_id=str(agent_run_id),
            prior_status=prior_status,
        )

    # ── Validate ───────────────────────────────────────────────────────────

    async def validate_claim_token(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
    ) -> DaemonTaskLease:
        """验证 claim_token。

        1. 获取 lease
        2. 检查 lease 存在且 status='claimed'
        3. 验证 metadata_['claim_token'] == claim_token
        4. 返回 lease 或抛异常

        Args:
            lease_id: Lease 的 ID。
            claim_token: 待验证的 token。

        Returns:
            验证通过的 DaemonTaskLease。

        Raises:
            LeaseNotFound: lease 不存在。
            LeaseNotClaimable: lease 状态不是 claimed。
            LeaseTokenMismatch: token 不匹配。
        """
        return await self._validate_claim_token(lease_id, claim_token)

    # ── Internal helpers ───────────────────────────────────────────────────

    async def _validate_claim_token(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
    ) -> DaemonTaskLease:
        """Internal: load lease and verify claim_token."""
        lease = await self._session.get(DaemonTaskLease, lease_id)
        if lease is None:
            raise LeaseNotFound(
                f"Lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )

        if lease.status != "claimed":
            raise LeaseNotClaimable(
                f"Lease '{lease_id}' is not in 'claimed' state (status={lease.status}).",
                details={"lease_id": str(lease_id), "status": lease.status},
            )

        stored_token = (lease.metadata_ or {}).get("claim_token")
        if stored_token != claim_token:
            log.warning(
                "claim_token_mismatch",
                lease_id=str(lease_id),
            )
            raise LeaseTokenMismatch(
                "Claim token does not match.",
                details={"lease_id": str(lease_id)},
            )

        return lease

    async def _send_interactive_cancel(self, lease: DaemonTaskLease) -> None:
        """向 daemon 下发 SESSION_INTERRUPT 中止 interactive lease 的当前 turn。

        daemon interactive 路径不轮询 lease status（不像 batch 跑心跳循环），cancel
        必须经 WS Hub 显式下发，否则 SDK 进程在 daemon 内存里继续跑成僵尸——
        lease/AgentRun 在 DB 已 killed 但 daemon 侧 query 仍在执行。复用
        ``interrupt_session``（session/service.py:707-784）同款通道：runtime_id →
        daemon_instance_id（``_resolve_daemon_id_for_runtime``）→ ``send_session_control``。

        best-effort：任何失败只告警，不阻塞 ``cancel_lease`` 主流程（DB 收尾已完成，
        daemon 侧靠 idle expire 兜底，与 ``end_session`` 容错策略一致）。
        """
        try:
            if lease.runtime_id is None:
                return
            # lazy import：避免与 session.service / ws_hub 的顶层循环 import
            from app.modules.agent.model import AgentSession
            from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INTERRUPT
            from app.modules.daemon.session.service import _resolve_daemon_id_for_runtime
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            # interactive lease 1:1 AgentSession（session.lease_id 反查）
            agent_session = (
                (
                    await self._session.execute(
                        select(AgentSession).where(AgentSession.lease_id == lease.id)
                    )
                )
                .scalars()
                .first()
            )
            if agent_session is None:
                # session 已 end / 不存在 → 无可中断对象，daemon 侧自然收敛
                return

            daemon_id = await _resolve_daemon_id_for_runtime(self._session, lease.runtime_id)
            if daemon_id is None:
                log.warning(
                    "interactive_cancel_daemon_offline",
                    lease_id=str(lease.id),
                    runtime_id=str(lease.runtime_id),
                )
                return

            hub = get_daemon_ws_hub()
            delivered = await hub.send_session_control(
                daemon_id,
                DAEMON_MSG_SESSION_INTERRUPT,
                {
                    "session_id": str(agent_session.id),
                    "lease_id": str(lease.id),
                    "runtime_id": str(lease.runtime_id),
                },
            )
            log.info(
                "interactive_cancel_signal_sent",
                lease_id=str(lease.id),
                session_id=str(agent_session.id),
                daemon_id=str(daemon_id),
                delivered=delivered,
            )
        except Exception as exc:
            # best-effort：WS 异常不影响 cancel 主流程（DB 已 killed）
            log.warning(
                "interactive_cancel_signal_failed",
                lease_id=str(lease.id),
                error=str(exc),
            )

    @staticmethod
    def _timedelta_seconds(seconds: int):
        """Helper to create a timedelta, avoiding top-level datetime import clash."""
        from datetime import timedelta

        return timedelta(seconds=seconds)
