"""Lease subdomain service — daemon task lease lifecycle.

LeaseService：daemon lease 正向生命周期管理（create/claim/start/heartbeat/
complete/get/list/expire）+ expiry/rollback（handle_lease_expiry /
handle_expired_leases_batch）+ 私有辅助 _get_lease_and_verify_token。

由 ``DaemonService`` lease_* / handle_* 方法迁入（2026-06-22-daemon-service-split
task-06，Wave 6）。与 ``lease_service.py`` 的 ``DaemonLeaseService`` 并存——分管
不同操作（本类管正向生命周期 + expiry 回滚；``DaemonLeaseService`` 管 cancel 能力，
被 agent 跨模块 import），见 D-003@v1。

跨子域调用（D-006@v1）：``complete_lease`` 调 patch / run_sync 子域方法
（``_apply_patch_to_worktree`` / ``_run_post_scan_validation`` /
``_trigger_stage_completion_callback``），``handle_lease_expiry`` 调 run_sync 子域
``_publish_run_event``。通过持有 facade 引用 ``self._facade`` 反向委托，facade
保留同名委托（D-002），Wave 顺序无关。
"""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# task-07：异常类按归属子域定义。lease 域 6 个本包定义；runtime 域/patch 域
# 子包直引（B6，避免反向 import facade 造成循环）。
from app.modules.daemon.patch.service import PatchApplyError, PatchConflictError
from app.modules.daemon.runtime.service import DaemonRuntimeNotFound
from app.modules.git_gateway.service import redact_output

if TYPE_CHECKING:
    from app.modules.daemon.service import DaemonService

log = get_logger(__name__)


# ── Domain errors (task-07 迁入；原 facade service.py:48/53/58/63/68/73 字符级搬入) ─


class DaemonLeaseNotFound(AppError):
    code = "HTTP_404_DAEMON_LEASE_NOT_FOUND"
    http_status = 404


class DaemonLeaseNotPending(AppError):
    code = "HTTP_409_DAEMON_LEASE_NOT_PENDING"
    http_status = 409


class DaemonLeaseNotClaimed(AppError):
    code = "HTTP_409_DAEMON_LEASE_NOT_CLAIMED"
    http_status = 409


class DaemonInvalidClaimToken(AppError):
    code = "HTTP_403_DAEMON_INVALID_CLAIM_TOKEN"
    http_status = 403


class DaemonAgentRunNotFound(AppError):
    code = "HTTP_404_DAEMON_AGENT_RUN_NOT_FOUND"
    http_status = 404


class DaemonLeaseNoAgentRun(AppError):
    """Batch lease has no agent_run_id (dispatch always sets it; NULL is a bug).

    Fail-fast instead of silently returning an agent_run_id=None claim payload,
    which would make the daemon send empty agent_run_id submitMessages → backend
    422 storm → connection pool exhaustion (ql-004).
    """

    code = "HTTP_422_DAEMON_LEASE_NO_AGENT_RUN"
    http_status = 422


class LeaseService:
    """Daemon lease 正向生命周期 + expiry 回滚管理。

    由 ``DaemonService.lease_*`` / ``handle_lease_expiry`` /
    ``handle_expired_leases_batch`` 迁入（task-06）。与 ``lease_service.py`` 的
    ``DaemonLeaseService`` 并存（分管不同操作，见 D-003@v1）。

    跨子域调用通过 ``self._facade`` 反向委托（D-006@v1）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # facade 引用由 DaemonService.__init__ 注入（D-006@v1）。W6 阶段 complete_lease
        # 调 patch/run_sync 子域、handle_lease_expiry 调 run_sync 子域，均经 facade 委托。
        self._facade: DaemonService | None = None

    async def create_lease(
        self,
        runtime_id: uuid.UUID,
        *,
        agent_run_id: uuid.UUID | None = None,
        ttl_seconds: int = 3600,
    ) -> DaemonTaskLease:
        """Create a new task lease for a daemon runtime."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )

        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=runtime_id,
            agent_run_id=agent_run_id,
            status="pending",
            metadata_={},
        )
        self._session.add(lease)
        await self._session.commit()
        await self._session.refresh(lease)
        log.info(
            "daemon_lease_created",
            lease_id=str(lease.id),
            runtime_id=str(runtime_id),
            agent_run_id=str(agent_run_id) if agent_run_id else None,
        )
        return lease

    async def claim_lease(
        self,
        lease_id: uuid.UUID,
        runtime_id: uuid.UUID,
    ) -> tuple[DaemonTaskLease, dict]:
        """Claim a pending task lease.

        Returns a tuple of (lease, payload) where payload contains the
        execution context built from the associated AgentRun.
        """
        lease = await self._session.get(DaemonTaskLease, lease_id)
        if lease is None:
            raise DaemonLeaseNotFound(
                f"Daemon task lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )

        if lease.status != "pending":
            raise DaemonLeaseNotPending(
                f"Lease '{lease_id}' is not pending (status={lease.status}).",
                details={"lease_id": str(lease_id), "status": lease.status},
            )

        now = datetime.now(UTC)
        metadata = dict(lease.metadata_ or {})
        # gap-2（D-002@v3 补丁 design §3）：interactive lease 在
        # prepare_interactive_dispatch 时已生成 claim_token 写入 metadata，这里
        # 复用同一 token（不重新生成），保证 SESSION_INJECT 下发的 claim_token 与
        # lease metadata 一致，daemon claim 后持有的 token 对后续 start/heartbeat/
        # submit_messages/close_interactive_run 验证都有效。batch lease 无预生成
        # claim_token，走原逻辑生成新 token。
        existing_token = metadata.get("claim_token")
        if existing_token:
            claim_token = existing_token
        else:
            claim_token = secrets.token_hex(32)
            metadata["claim_token"] = claim_token

        # Update lease — keep original runtime_id if already set
        lease.status = "claimed"
        lease.claimed_at = now
        # interactive lease 永不过期（生命周期由 end_session 管，design §D-005）；
        # batch lease 用 60s claim 窗口（claim→start 间隔超时回收）。
        # **修复 Bug**：原无条件设 60s 覆盖了 prepare_*_interactive_dispatch 写的 NULL，
        # 导致 scan 长任务中途 lease 过期。
        if lease.kind != "interactive":
            lease.lease_expires_at = now + timedelta(seconds=60)
        if not lease.runtime_id:
            lease.runtime_id = runtime_id
        lease.metadata_ = metadata
        flag_modified(lease, "metadata_")
        lease.updated_at = now
        self._session.add(lease)

        # Build payload from associated AgentRun（task-06：从 lease.context 模块级函数调用）
        payload = await build_claim_payload(self._session, lease)

        await self._session.commit()
        await self._session.refresh(lease)

        log.info(
            "daemon_lease_claimed",
            lease_id=str(lease_id),
            runtime_id=str(runtime_id),
        )
        return lease, payload

    async def start_lease(self, lease_id: uuid.UUID, claim_token: str) -> DaemonTaskLease:
        """Mark a claimed lease as started."""
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        if lease.status != "claimed":
            raise DaemonLeaseNotClaimed(
                f"Lease '{lease_id}' is not claimed (status={lease.status}).",
                details={"lease_id": str(lease_id), "status": lease.status},
            )

        # Lease status stays "claimed" — running status is tracked in AgentRun
        now = datetime.now(UTC)
        lease.updated_at = now
        # interactive lease 保持 NULL（永不过期）；batch lease 续 60s（running 期间
        # 心跳续期，超时回收）。
        if lease.kind != "interactive":
            lease.lease_expires_at = now + timedelta(seconds=60)
        self._session.add(lease)

        # Also update AgentRun to running if it exists
        if lease.agent_run_id is not None:
            agent_run = await self._session.get(AgentRun, lease.agent_run_id)
            if agent_run is not None:
                agent_run.status = "running"
                agent_run.started_at = now
                self._session.add(agent_run)

        await self._session.commit()
        await self._session.refresh(lease)

        # Publish AgentRun start event via Redis
        if lease.agent_run_id is not None:
            try:
                redis = get_redis()
                await redis.publish(
                    f"agent_run:{lease.agent_run_id}",
                    json.dumps(
                        {
                            "event": "status_changed",
                            "status": "running",
                            "lease_id": str(lease_id),
                        }
                    ),
                )
            except Exception:
                log.warning(
                    "daemon_start_redis_publish_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                )

        log.info(
            "daemon_lease_started",
            lease_id=str(lease_id),
            agent_run_id=str(lease.agent_run_id) if lease.agent_run_id else None,
        )
        return lease

    async def lease_heartbeat(self, lease_id: uuid.UUID, claim_token: str) -> DaemonTaskLease:
        """Renew a lease's heartbeat to prevent expiry."""
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        lease.lease_expires_at = now + timedelta(seconds=60)
        lease.updated_at = now
        self._session.add(lease)
        await self._session.commit()
        await self._session.refresh(lease)
        return lease

    async def complete_lease(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        result: dict,
    ) -> DaemonTaskLease:
        """Mark a lease as completed with results.

        跨子域调用（D-006@v1）：``_apply_patch_to_worktree``（patch 子域，task-03）、
        ``_run_post_scan_validation`` / ``_trigger_stage_completion_callback``
        （run_sync 子域，task-04）经 ``self._facade`` 反向委托。
        """
        lease = await self._get_lease_and_verify_token(lease_id, claim_token)

        now = datetime.now(UTC)
        lease.status = "completed"
        lease.updated_at = now
        self._session.add(lease)

        # Update associated AgentRun
        if lease.agent_run_id is not None:
            agent_run = await self._session.get(AgentRun, lease.agent_run_id)
            if agent_run is not None:
                result_status = result.get("status", "completed")
                # ql-20260616-006：终态优先级护栏——killed > failed > cancelled > completed
                # daemon 在 cancel 链路里先调 syncStatus("killed") 把 AgentRun 标 killed，
                # 再 complete_lease 收尾时上报 status="cancelled"。若直接覆写会让 UI 显示
                # "cancelled"（用户取消语义弱）而不是 "killed"（实际被 SIGTERM）。
                # 这里按优先级合并：当前 status 优先级 >= 待写 status 时不动。
                priority = {"completed": 0, "cancelled": 1, "failed": 2, "killed": 3}
                current_priority = priority.get(agent_run.status, 0)
                new_priority = priority.get(
                    result_status if result_status in priority else "completed",
                    0,
                )
                if new_priority >= current_priority:
                    agent_run.status = (
                        result_status
                        if result_status in ("completed", "failed", "cancelled", "killed")
                        else "completed"
                    )
                # finished_at 已被 syncStatus("killed") 写入则保留，否则补 now
                if agent_run.finished_at is None:
                    agent_run.finished_at = now

                # Store agent output and error（task-07：redact_output 二次脱敏，
                # 单一真相源 git_gateway.redact_output，daemon 不移植正则规则）
                if result.get("output"):
                    agent_run.output_redacted = redact_output(result["output"])
                if result.get("error"):
                    existing = agent_run.output_redacted or ""
                    agent_run.output_redacted = (
                        existing + ("\n" if existing else "") + redact_output(result["error"])
                    )
                if result.get("duration_ms"):
                    agent_run.duration_ms = result["duration_ms"]
                if result.get("session_id"):
                    agent_run.session_id = result["session_id"]

                # Apply usage stats from result if present
                stats = result.get("stats")
                if stats and isinstance(stats, dict):
                    if "total_cost_usd" in stats:
                        agent_run.total_cost_usd = stats["total_cost_usd"]
                    if "duration_ms" in stats:
                        agent_run.duration_ms = stats["duration_ms"]
                    if "input_tokens" in stats:
                        agent_run.input_tokens = stats["input_tokens"]
                    if "output_tokens" in stats:
                        agent_run.output_tokens = stats["output_tokens"]
                    if "num_turns" in stats:
                        agent_run.num_turns = stats["num_turns"]
                    if "session_id" in stats:
                        agent_run.session_id = stats["session_id"]
                    if "exit_code" in stats:
                        agent_run.exit_code = stats["exit_code"]

                # ql-20260706-009：兜底——run failed 时把 output_redacted 写一条
                # stderr AgentRunLog + SSE 推送，让前端日志流可见失败原因（防 daemon
                # stderr 没实时 forward 的兜底；daemon 侧 task-runner.ts stderr forward
                # 是主路径，这里是双保险）。前端收 done event 后刷新也能看到 DB 这条。
                if agent_run.status == "failed" and agent_run.output_redacted:
                    try:
                        import json as _json

                        from app.core.redis import get_redis
                        from app.modules.agent.model import AgentRunLog

                        _failure_content = agent_run.output_redacted[:50000]
                        _failure_log = AgentRunLog(
                            run_id=agent_run.id,
                            channel="stderr",
                            content_redacted=_failure_content,
                            timestamp=now,
                        )
                        self._session.add(_failure_log)
                        await self._session.flush()
                        await get_redis().publish(
                            f"agent_run:{agent_run.id}",
                            _json.dumps(
                                {
                                    "log_id": str(_failure_log.id),
                                    "channel": "stderr",
                                    "content": _failure_content,
                                    "timestamp": now.isoformat().replace("+00:00", "Z"),
                                    "parent_tool_use_id": None,
                                    "subagent_type": None,
                                    "depth": None,
                                    "tool_kind": None,
                                }
                            ),
                        )
                    except Exception:
                        log.warning(
                            "complete_lease_failure_log_failed",
                            agent_run_id=str(agent_run.id),
                        )

                self._session.add(agent_run)

        # task-07（workspace-config-flow D-010）：init lease complete 时回写 member
        # binding 的 init_synced_*。upsert_my_binding 注释明说这两个字段只由此路径写，
        # 但本路径之前漏实现 → 前端"接入初始化状态"永远显示未初始化。
        # try/except 兜底：meta 损坏 / 无 binding 只 warn，不阻塞 lease 完成。
        _init_meta = lease.metadata_ if isinstance(lease.metadata_, dict) else {}
        if _init_meta.get("mode") == "init":
            try:
                _init_ws_id = uuid.UUID(str(_init_meta.get("workspace_id")))
                _init_user_id = uuid.UUID(str(_init_meta.get("actor_user_id")))
                _init_spec_ver = int(_init_meta.get("latest_spec_version") or 0)
            except (TypeError, ValueError):
                log.warning(
                    "init_lease_complete_bad_meta",
                    lease_id=str(lease.id),
                )
            else:
                from app.modules.workspace.member_runtimes.model import (
                    WorkspaceMemberRuntime,
                )

                _init_binding = await self._session.get(
                    WorkspaceMemberRuntime, (_init_ws_id, _init_user_id)
                )
                if _init_binding is not None:
                    _init_binding.init_synced_at = now
                    _init_binding.init_synced_spec_version = _init_spec_ver
                    self._session.add(_init_binding)
                    log.info(
                        "init_lease_complete_synced",
                        lease_id=str(lease.id),
                        workspace_id=str(_init_ws_id),
                        user_id=str(_init_user_id),
                        spec_version=_init_spec_ver,
                    )
                else:
                    log.warning(
                        "init_lease_complete_no_binding",
                        lease_id=str(lease.id),
                        workspace_id=str(_init_ws_id),
                        user_id=str(_init_user_id),
                    )

        await self._session.commit()
        await self._session.refresh(lease)

        # Publish completion event via Redis
        if lease.agent_run_id is not None:
            try:
                redis = get_redis()
                await redis.publish(
                    f"agent_run:{lease.agent_run_id}",
                    json.dumps(
                        {
                            "event": "done",
                            "status": "completed",
                            "lease_id": str(lease_id),
                        }
                    ),
                )
            except Exception:
                log.warning(
                    "daemon_complete_redis_publish_failed",
                    lease_id=str(lease_id),
                )

        # Patch application（task-07：入库前 redact_output 二次脱敏 patch，
        # 对齐 diff_collector.py:174，确保 daemon 上报的密钥不入库）
        patch = result.get("patch")
        if patch and lease.agent_run_id is not None:
            if isinstance(patch, str):
                patch = redact_output(patch)
            patch_data = json.dumps(patch) if isinstance(patch, dict) else str(patch)
            try:
                # D-006@v1：跨子域（patch，task-03）经 facade 反向委托。
                await self._facade._apply_patch_to_worktree(
                    agent_run_id=lease.agent_run_id,
                    patch_data=patch_data,
                    use_3way=True,
                )
                log.info(
                    "daemon_patch_applied",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    patch_size=len(patch_data),
                )
            except PatchConflictError as exc:
                log.warning(
                    "daemon_patch_conflict",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    conflict_detail=exc.message,
                )
                metadata = dict(lease.metadata_ or {})
                metadata["patch_conflict"] = {
                    "error": exc.message,
                    "details": exc.details,
                }
                lease.metadata_ = metadata
                flag_modified(lease, "metadata_")
                self._session.add(lease)
                await self._session.commit()
                await self._session.refresh(lease)
            except PatchApplyError:
                raise

        # A2: stage 完成回调 —— stage dispatch（AgentRun.change_id 非空）的 run
        # 完成后，同步 sillyspec.db 状态并 auto-dispatch 下一阶段。spec sync 已在
        # daemon _finish 之前完成（task-runner.ts:477），server spec_root 的
        # sillyspec.db 此时为最新。失败不阻塞 lease 完成（与 reconcile_stale_runs
        # 容错一致）。scan（change_id=None）不走此路径。
        if lease.agent_run_id is not None:
            try:
                # D-006@v1：跨子域（run_sync，task-04）经 facade 反向委托。
                await self._facade._trigger_stage_completion_callback(lease.agent_run_id)
            except Exception as exc:
                log.warning(
                    "complete_lease_stage_callback_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    error=str(exc),
                )

        # C: scan 完成后跑平台侧结构化校验（PostScanValidator）—— 消费 sillyspec
        # 平台模式产出的 manifest.json / postcheck-result / 源码污染检测 / 7 文档
        # 齐全等结构化回执。仅 scan run（change_id=None + platform-managed）触发；
        # 结果写入 lease.metadata['post_scan_validation']，不翻转 scan 成功语义。
        if lease.agent_run_id is not None:
            try:
                # D-006@v1：跨子域（run_sync，task-04）经 facade 反向委托。
                await self._facade._run_post_scan_validation(lease)
            except Exception as exc:
                log.warning(
                    "complete_lease_post_scan_validation_failed",
                    lease_id=str(lease_id),
                    error=str(exc),
                )

        # D-002@v1（2026-06-25-interactive-idle-timeout-fix）：完成驱动 end。
        # scan run（change_id=None + platform-managed）与 stage run（change_id 非空）
        # 完成后主动 end 关联 daemon interactive session，让 claude 进程及时退出，
        # 不再依赖 idle 回收（D-001@v1 已默认禁用）。多轮对话（非 platform-managed
        # 的 interactive lease）不自动 end，留给用户手动。复用现有 facade.end_session
        # 的 runtime 归属校验路径，零重复收口代码。失败 try/except 不阻塞 lease 完成。
        if lease.agent_run_id is not None and self._facade is not None:
            try:
                agent_run = await self._session.get(AgentRun, lease.agent_run_id)
                should_end = agent_run is not None and (
                    agent_run.change_id is not None  # stage run
                    or getattr(agent_run, "spec_strategy", None) == "platform-managed"  # scan run
                )
                if should_end and agent_run is not None and agent_run.agent_session_id is not None:
                    # end_session 需要 runtime owner（actor_runtime_owner_id 路径按
                    # runtime 归属定位 session，不查 AgentSession.user_id）。lease.runtime_id
                    # → DaemonRuntime.user_id。
                    runtime = await self._session.get(DaemonRuntime, lease.runtime_id)
                    if runtime is not None:
                        await self._facade.end_session(
                            agent_run.agent_session_id,
                            runtime.user_id,
                            reason="task_completed",
                            actor_runtime_owner_id=runtime.user_id,
                        )
                        log.info(
                            "complete_lease_end_session_sent",
                            lease_id=str(lease_id),
                            agent_run_id=str(lease.agent_run_id),
                            agent_session_id=str(agent_run.agent_session_id),
                        )
            except Exception as exc:
                log.warning(
                    "complete_lease_end_session_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    error=str(exc),
                )

        # Mission 收敛（D-007@v1，2026-06-28-team-mainline-integration）：lease 完成
        # 是 Worker Run 收口的唯一锚点（batch + interactive 都走 complete_lease）。
        # run 属于 mission 时：collect_completed_artifacts 回灌（C2，与 session end
        # 解耦）+ 全 worker 终态（derive_status=done/degraded）触发 Finalizer 合并。
        # 非 mission run（绝大多数）→ converge 直接 return None，零影响（SC-5 兼容）。
        # 失败 try/except 不阻塞 lease 完成（与上方 stage_callback/post_scan/end_session
        # 容错一致）。derive_status 是纯函数无 watcher，不能作触发器 — 锚点必须在此。
        if lease.agent_run_id is not None:
            try:
                from app.modules.agent.delegation import GLMConfig
                from app.modules.agent.finalizer import (
                    converge_mission_for_completed_run,
                )

                await converge_mission_for_completed_run(
                    self._session, lease.agent_run_id, GLMConfig.from_env()
                )
            except Exception as exc:
                log.warning(
                    "complete_lease_mission_converge_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(lease.agent_run_id),
                    error=str(exc),
                )

        log.info(
            "daemon_lease_completed",
            lease_id=str(lease_id),
            result_status=result.get("status"),
        )
        return lease

    async def get_lease(self, lease_id: uuid.UUID) -> DaemonTaskLease | None:
        """Get a task lease by ID."""
        return await self._session.get(DaemonTaskLease, lease_id)

    async def list_leases(self, runtime_id: uuid.UUID) -> list[DaemonTaskLease]:
        """List all leases for a given daemon runtime."""
        stmt = (
            select(DaemonTaskLease)
            .where(col(DaemonTaskLease.runtime_id) == runtime_id)
            .order_by(col(DaemonTaskLease.created_at).desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def expire_leases(self) -> list[DaemonTaskLease]:
        """Mark expired leases based on lease_expires_at.

        Returns the list of leases that were marked as expired, so callers
        can inspect them for follow-up actions (e.g. lease expiry handling).
        """
        now = datetime.now(UTC)
        stmt = select(DaemonTaskLease).where(
            col(DaemonTaskLease.status).in_(["claimed", "pending"]),
            col(DaemonTaskLease.lease_expires_at) < now,
        )
        expired = list((await self._session.execute(stmt)).scalars().all())
        for lease in expired:
            lease.status = "expired"
            lease.updated_at = now
            self._session.add(lease)
        if expired:
            await self._session.commit()
        return expired

    # ── Lease expiry / rollback ────────────────────────────────────────────

    async def handle_lease_expiry(self, agent_run_id: UUID) -> None:
        """Handle a single lease expiry: rollback or fail the associated AgentRun.

        Decision logic:
        1. Skip if AgentRun is already in a terminal state (completed/failed/killed).
        2. If attempt_number >= 3 -> mark AgentRun as failed.
        3. Otherwise -> reset AgentRun to pending and dispatch back to server.
        4. Create a new pending lease with attempt_number = old + 1.
        5. Publish Redis event for the status change.

        跨子域调用（D-006@v1）：``_publish_run_event``（run_sync 子域，task-04）经
        ``self._facade`` 反向委托。
        """
        # -- Look up the most recent expired lease for this agent_run_id -----
        lease_stmt = (
            select(DaemonTaskLease)
            .where(
                col(DaemonTaskLease.agent_run_id) == agent_run_id,
                col(DaemonTaskLease.status) == "expired",
            )
            .order_by(col(DaemonTaskLease.updated_at).desc())
        )
        lease = (await self._session.execute(lease_stmt)).scalars().first()

        if lease is None:
            log.warning(
                "handle_lease_expiry_no_expired_lease",
                agent_run_id=str(agent_run_id),
            )
            return

        # -- Check AgentRun status -------------------------------------------
        agent_run = await self._session.get(AgentRun, agent_run_id)
        if agent_run is None:
            log.warning(
                "handle_lease_expiry_agent_run_missing",
                agent_run_id=str(agent_run_id),
            )
            return

        if agent_run.status in ("completed", "failed", "killed"):
            log.info(
                "handle_lease_expiry_skip_terminal",
                agent_run_id=str(agent_run_id),
                agent_run_status=agent_run.status,
            )
            return

        # -- Determine next action based on attempt_number -------------------
        attempt = lease.attempt_number or 1

        if attempt >= 3:
            # Max retries exceeded -- mark as failed
            now = datetime.now(UTC)
            agent_run.status = "failed"
            agent_run.finished_at = now
            agent_run.exit_code = -1
            agent_run.output_redacted = (
                f"Daemon lease expired after {attempt} attempt(s). Maximum retry count reached."
            )
            self._session.add(agent_run)
            await self._session.commit()

            log.warning(
                "handle_lease_expiry_max_retries",
                agent_run_id=str(agent_run_id),
                attempt_number=attempt,
            )

            # Publish failure event via Redis（D-006@v1：跨子域 run_sync 经 facade）
            await self._facade._publish_run_event(
                agent_run_id,
                event="done",
                status="failed",
                reason="lease_expired_max_retries",
                attempt_number=attempt,
            )
            return

        # -- Rollback: reset AgentRun to pending and re-queue the lease ------
        next_attempt = attempt + 1

        # Reset the run so the daemon re-claims it via the new lease.  The
        # SERVER re-dispatch path was removed in task-01; the daemon picks up
        # the new pending lease on WebSocket wake-up.
        agent_run.status = "pending"
        agent_run.started_at = None
        self._session.add(agent_run)

        # Create a new pending lease with incremented attempt_number
        new_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=lease.runtime_id,
            agent_run_id=agent_run_id,
            status="pending",
            attempt_number=next_attempt,
            metadata_={},
        )
        self._session.add(new_lease)
        await self._session.commit()

        log.info(
            "handle_lease_expiry_rollback",
            agent_run_id=str(agent_run_id),
            old_lease_id=str(lease.id),
            new_lease_id=str(new_lease.id),
            attempt_number=next_attempt,
        )

        # Publish rollback event via Redis（D-006@v1：跨子域 run_sync 经 facade）
        await self._facade._publish_run_event(
            agent_run_id,
            event="lease_expired_rollback",
            status="pending",
            attempt_number=next_attempt,
            new_lease_id=str(new_lease.id),
        )

        # Notify the daemon about the new pending lease via WebSocket wake-up
        # (daemon-only since task-01 — the SERVER re-dispatch path is gone).
        # The new lease was created above; the daemon claims it on wake-up.
        from app.modules.agent.placement import RunPlacementService

        placement = RunPlacementService(self._session)
        await placement._send_ws_wakeup(lease.runtime_id, new_lease.id, agent_run_id)

    async def handle_expired_leases_batch(self) -> int:
        """Process all expired leases and handle their rollback logic.

        Returns the number of expired leases processed.
        Individual lease failures are logged but do not prevent
        processing of other leases.
        """
        expired_leases = await self.expire_leases()
        if not expired_leases:
            return 0

        processed = 0
        for lease in expired_leases:
            if lease.agent_run_id is None:
                log.info(
                    "handle_expired_leases_skip_no_agent_run",
                    lease_id=str(lease.id),
                )
                processed += 1
                continue

            try:
                await self.handle_lease_expiry(lease.agent_run_id)
            except Exception:
                log.exception(
                    "handle_expired_leases_single_failed",
                    lease_id=str(lease.id),
                    agent_run_id=str(lease.agent_run_id),
                )
            processed += 1

        log.info(
            "handle_expired_leases_batch_done",
            total=len(expired_leases),
            processed=processed,
        )
        return processed

    # ── Private helpers ───────────────────────────────────────────────────

    async def _get_lease_and_verify_token(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
    ) -> DaemonTaskLease:
        """Load a lease and verify the claim_token matches.

        被 run_sync 子域（submit_messages / sync_agent_run_status /
        close_interactive_run）经 facade 同名委托跨域调用（task-04）。
        """
        lease = await self._session.get(DaemonTaskLease, lease_id)
        if lease is None:
            raise DaemonLeaseNotFound(
                f"Daemon task lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )

        metadata = lease.metadata_ or {}
        stored_token = metadata.get("claim_token")
        if not stored_token or stored_token != claim_token:
            raise DaemonInvalidClaimToken(
                "Invalid or missing claim_token.",
                details={"lease_id": str(lease_id)},
            )
        return lease
