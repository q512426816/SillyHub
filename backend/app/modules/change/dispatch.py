"""Stage-Driven Agent Dispatch.

Automatic agent dispatch after change workflow transitions.
Each stage that supports agent automation has a ``StageAgentConfig``
defining how the agent should be invoked.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.model import AgentRun
from app.modules.change.model import Change, StageEnum

if TYPE_CHECKING:
    from app.modules.workspace.model import Workspace

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Stage agent configuration
# ---------------------------------------------------------------------------

STAGE_ORDER: list[str] = [
    "brainstorm",
    "plan",
    "execute",
    "verify",
    "archive",
]

assert [s.value for s in StageEnum.spec_stages()] == STAGE_ORDER, (
    f"StageEnum.spec_stages() mismatch: "
    f"expected {STAGE_ORDER}, "
    f"got {[s.value for s in StageEnum.spec_stages()]}"
)


@dataclass
class StageAgentConfig:
    """Configuration for automatic agent dispatch at a given stage."""

    enabled: bool = True
    prompt_template: str = ""  # filename under prompts/ directory (e.g. "clarifying.md")
    phase: str = ""  # human-readable phase label
    requires_worktree: bool = False  # True = needs a worktree lease for writes
    description: str = ""
    read_only: bool = True  # True = agent should only read/analyse, not write code


@dataclass
class StageSyncResult:
    """sync_stage_status 的返回值，携带同步结果和步骤状态摘要。"""

    synced: bool  # 同步是否成功
    change_id: uuid.UUID  # 变更 ID
    run_id: uuid.UUID  # 触发同步的 AgentRun ID
    current_stage: str | None = None  # sillyspec.db 中的 current_stage
    current_step: str | None = None  # 第一个 pending step 名称
    stage_completed: bool = False  # 当前 stage 全部 steps 已完成
    has_pending_step: bool = False  # 当前 stage 还有 pending step
    steps_completed: list[str] = field(default_factory=list)
    steps_pending: list[str] = field(default_factory=list)
    error: str | None = None  # synced=False 时的错误描述


STAGE_AGENT_CONFIG: dict[str, StageAgentConfig] = {
    StageEnum.BRAINSTORM.value: StageAgentConfig(
        enabled=True,
        prompt_template="brainstorm.md",
        phase="Brainstorm",
        requires_worktree=True,
        read_only=False,
        description="Write question lists and decision records to change directory.",
    ),
    StageEnum.PLAN.value: StageAgentConfig(
        enabled=True,
        prompt_template="plan.md",
        phase="Plan",
        requires_worktree=True,
        read_only=False,
        description="Write plan.md and task blueprints.",
    ),
    StageEnum.EXECUTE.value: StageAgentConfig(
        enabled=True,
        prompt_template="execute.md",
        phase="Execute",
        requires_worktree=True,
        read_only=False,
        description="Implement tasks; must use worktree.",
    ),
    StageEnum.VERIFY.value: StageAgentConfig(
        enabled=True,
        prompt_template="verify.md",
        phase="Verify",
        requires_worktree=False,  # D-004: daemon-client 不用 worktree，配合 host-fs-delegate 定位 spec_root
        read_only=False,
        description="Write verify-result.md and run verification checks.",
    ),
    StageEnum.ARCHIVE.value: StageAgentConfig(
        enabled=True,
        prompt_template="archive.md",
        phase="Archive",
        requires_worktree=True,
        read_only=False,
        description="Write module-impact analysis and move change directory to archive.",
    ),
}

# ---------------------------------------------------------------------------
# Auto-dispatch chain management (task-10)
# ---------------------------------------------------------------------------

_DISPATCH_CHAIN_LIMIT: int = 10


def _get_chain_count(stages: dict) -> int:
    """从 Change.stages JSON 中读取连续 auto-dispatch 计数。"""
    return stages.get("_dispatch_chain_count", 0)


def _increment_chain_count(stages: dict) -> dict:
    """递增连续 auto-dispatch 计数，返回更新后的 stages dict。"""
    stages["_dispatch_chain_count"] = _get_chain_count(stages) + 1
    return stages


def _reset_chain_count(stages: dict) -> dict:
    """重置连续 auto-dispatch 计数为 0。"""
    stages["_dispatch_chain_count"] = 0
    return stages


async def _read_latest_gate_result(
    session: AsyncSession,
    change_id: uuid.UUID,
) -> tuple[dict | None, uuid.UUID | None]:
    """取本 change 最近一条 completed AgentRun 的 gate_result（task-08）。

    design §5.4：gate 三态决策依据是 stage 完成 agent 的 gate 产物。task-07 的
    ``_run_gate_decision_task`` 已把 gate 结果写入触发 stage 完成的那条 AgentRun
    （``gate_status='decided'`` + ``gate_result={exit_code, errors, raw_envelope}``）。
    本函数取本 change 最近一条 ``status='completed'`` 的 AgentRun（按 created_at
    降序），读其 ``gate_result``。

    Args:
        session: 数据库会话。
        change_id: 变更 ID。

    Returns:
        ``(gate_result, run_id)``。``gate_result is None`` 表示最近完成 run 未跑
        gate / 异常未落 gate_result（brownfield）；``run_id`` 供打回点审计。
    """
    stmt = (
        select(AgentRun)
        .where(
            col(AgentRun.change_id) == change_id,
            col(AgentRun.status) == "completed",
        )
        .order_by(col(AgentRun.created_at).desc())
        .limit(1)
    )
    run = (await session.execute(stmt)).scalars().first()
    if run is None:
        return None, None
    return run.gate_result, run.id


# gate_retry_count 累加上限（design §10 R12 死循环防护）。exit 1 连续打回达此值
# 后升级 exit 2 卡住报警人工，不再 dispatch 同 stage 重跑（避免无限循环）。
_GATE_RETRY_LIMIT: int = 3

# gate_last_errors 截断阈值（防 change.stages JSON 超大）。
_GATE_ERROR_MAX_CHARS: int = 500  # 单条 error 截断长度
_GATE_ERROR_MAX_COUNT: int = 10  # errors 总条数上限


def _truncate_gate_errors(errors: Any) -> list[str]:
    """截断 gate errors 防 change.stages JSON 超大（task-09）。

    每条 error ``str()`` 强转后截断到 :data:`_GATE_ERROR_MAX_CHARS` 字符，总条数
    截到前 :data:`_GATE_ERROR_MAX_COUNT` 条。errors 非 list 时降级为空列表
    （不抛，exit 1 路径 errors 来源是 gate_result JSON，类型异常走兜底）。
    """
    if not isinstance(errors, list):
        return []
    truncated: list[str] = []
    for raw in errors[:_GATE_ERROR_MAX_COUNT]:
        text = str(raw)
        if len(text) > _GATE_ERROR_MAX_CHARS:
            text = text[:_GATE_ERROR_MAX_CHARS]
        truncated.append(text)
    return truncated


async def _record_gate_kickback(
    session: AsyncSession,
    change: Change,
    *,
    stage: str,
    gate_result: dict,
    gate_run_id: uuid.UUID | None,
    user_id: uuid.UUID,
) -> None:
    """记录 gate exit 1 打回点（task-08），供 task-09 接 gate_retry_count。

    design §5.4 exit 1 语义：不 complete_stage，dispatch 同 stage 重跑，feedback
    注入 gate_result.errors。本函数把本次打回结构化落 ``change.stages.last_gate_kickback``
    （stage + errors + gate_run_id + at + user_id），task-09 在此结构上累加
    ``gate_retry_count`` 并在 >=3 时升级 exit 2。**task-08 不实现 retry_count 字段**，
    只留可识别的打回点。
    """
    stages = dict(change.stages or {})
    stages["last_gate_kickback"] = {
        "stage": stage,
        "errors": list(gate_result.get("errors", []) or []),
        "gate_run_id": str(gate_run_id) if gate_run_id else None,
        "at": datetime.now(UTC).isoformat(),
        "user_id": str(user_id),
    }
    change.stages = stages
    session.add(change)
    await session.commit()


async def auto_dispatch_next_step(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    user_id: uuid.UUID,
    sync_result: StageSyncResult,
) -> dict[str, Any]:
    """根据 sync_stage_status 的结果决定是否自动调度下一个 AgentRun。

    在 sync_stage_status 返回后调用。核心调度链路的"决策点"。

    Args:
        session: 数据库会话
        workspace_id: 工作区 ID
        change_id: 变更 ID
        user_id: 触发用户 ID（通常为上一个 AgentRun 的触发者）
        sync_result: sync_stage_status() 的返回结果

    Returns:
        dispatch 结果字典：
        - {"dispatched": True, "agent_run_id": ..., "stage": ..., "reason": "auto_dispatch"}
        - {"dispatched": False, "reason": "no_pending_step"}
        - {"dispatched": False, "reason": "stage_completed"}
        - {"dispatched": False, "reason": "sync_failed"}
        - {"dispatched": False, "reason": "chain_limit_reached"}
    """
    # 1. sync failed
    if not sync_result.synced:
        log.info(
            "auto_dispatch_skip_sync_failed",
            change_id=str(change_id),
            error=sync_result.error,
        )
        return {"dispatched": False, "reason": "sync_failed"}

    change = await session.get(Change, change_id)

    # 1.6 Guard: skip if Hub DB current_stage is a terminal state
    _terminal_stages = frozenset({"archived", "cancelled"})
    if change and change.current_stage in _terminal_stages:
        log.info(
            "auto_dispatch_skip_terminal_stage",
            change_id=str(change_id),
            current_stage=change.current_stage,
        )
        return {
            "dispatched": False,
            "reason": "terminal_stage",
            "current_stage": change.current_stage,
        }

    # 2. stage completed → call complete_stage then optionally dispatch
    if sync_result.stage_completed:
        if not sync_result.current_stage:
            return {"dispatched": False, "reason": "stage_completed"}

        # Sync filesystem documents to DB before advancing stage
        from app.modules.change.service import ChangeService

        cs = ChangeService(session)
        try:
            await cs.reparse(workspace_id)
            log.info(
                "auto_dispatch_reparse_done",
                change_id=str(change_id),
                workspace_id=str(workspace_id),
            )
        except Exception as exc:
            log.warning(
                "auto_dispatch_reparse_failed",
                change_id=str(change_id),
                error=str(exc),
            )

        # ── task-08（P3 driver-gate-pilot）：gate 三态决策（design §5.4）──
        # stage 完成前读本 change 最近一条 completed AgentRun 的 gate_result。
        # verify stage **强制 gate**（无 flag）：gate_result None → 阻断 fail-loud
        # （不 fallback read_verify_result）。非 verify stage + None → fallback
        # 声明态（design §9 brownfield 兼容，零回归）。
        gate_result, gate_run_id = await _read_latest_gate_result(session, change_id)
        current_stage = sync_result.current_stage
        is_verify = current_stage == "verify"

        if gate_result is not None:
            gate_exit_code = gate_result.get("exit_code")
            gate_errors = gate_result.get("errors", []) or []

            # exit 1 → 打回：不 complete_stage，dispatch 同 stage 重跑，
            # feedback=errors 注入（留打回点供 task-09 接 gate_retry_count）。
            if gate_exit_code == 1:
                change = await session.get(Change, change_id)
                if change is None:
                    return {"dispatched": False, "reason": "change_not_found"}
                await _record_gate_kickback(
                    session,
                    change,
                    stage=current_stage,
                    gate_result=gate_result,
                    gate_run_id=gate_run_id,
                    user_id=user_id,
                )
                # task-09：exit 1 打回点接 gate_retry_count（+1，>=3 升级 exit 2
                # 卡住报警人工，R12 死循环防护）+ gate_last_errors（本轮 errors
                # 截断摘要，跨 run 持久供新 run / 前端读）。dict copy 逐字对齐
                # :198/:769 模式防 SQLAlchemy JSON 列原地改不标记 dirty（记忆坑）。
                change = await session.get(Change, change_id)
                if change is None:
                    return {"dispatched": False, "reason": "change_not_found"}
                stages = dict(change.stages or {})
                last_dispatch = dict(stages.get("last_dispatch", {}))
                count = int(last_dispatch.get("gate_retry_count", 0)) + 1
                last_dispatch["gate_retry_count"] = count
                last_dispatch["gate_last_errors"] = _truncate_gate_errors(
                    gate_result.get("errors", [])
                )
                stages["last_dispatch"] = last_dispatch
                change.stages = stages
                session.add(change)
                await session.commit()

                # R12：count >= 3 → 升级 exit 2，不 dispatch 同 stage（卡住报警人工）。
                # retry_count + last_errors 已落库，此处只返回 gate_blocked 终态。
                if count >= _GATE_RETRY_LIMIT:
                    log.warning(
                        "auto_dispatch_gate_retry_exceeded",
                        change_id=str(change_id),
                        stage=current_stage,
                        gate_retry_count=count,
                        limit=_GATE_RETRY_LIMIT,
                        gate_run_id=str(gate_run_id) if gate_run_id else None,
                        errors=gate_errors,
                    )
                    return {
                        "dispatched": False,
                        "reason": "gate_blocked",
                        "stage": current_stage,
                        "errors": list(gate_errors),
                        "gate_retry_exceeded": True,
                    }

                # 同 stage 重跑（feedback 经 last_gate_kickback.errors 流转，
                # task-13 前端注入；这里只 dispatch 同 stage）。
                dispatch_result = await dispatch(
                    session=session,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    target_stage=current_stage,
                    user_id=user_id,
                )
                dispatch_result["reason"] = "gate_kickback"
                log.info(
                    "auto_dispatch_gate_kickback",
                    change_id=str(change_id),
                    stage=current_stage,
                    gate_run_id=str(gate_run_id) if gate_run_id else None,
                    errors=gate_errors,
                )
                return dispatch_result

            # exit 2 → 卡住：不推进、不 dispatch，fail-loud 报警（design §9）。
            if gate_exit_code == 2:
                log.warning(
                    "auto_dispatch_gate_blocked",
                    change_id=str(change_id),
                    stage=current_stage,
                    gate_run_id=str(gate_run_id) if gate_run_id else None,
                    errors=gate_errors,
                )
                return {
                    "dispatched": False,
                    "reason": "gate_blocked",
                    "stage": current_stage,
                    "errors": list(gate_errors),
                }

            # exit 0 → 推进：照常 complete_stage + dispatch 下一 stage（保留现逻辑）。
            # 异常 exit_code（非 0/1/2）按 fail-loud exit 2 处理（防御）。
            if gate_exit_code != 0:
                log.warning(
                    "auto_dispatch_gate_unknown_exit_code",
                    change_id=str(change_id),
                    stage=current_stage,
                    gate_exit_code=gate_exit_code,
                )
                return {
                    "dispatched": False,
                    "reason": "gate_blocked",
                    "stage": current_stage,
                    "errors": [f"gate exit_code 异常: {gate_exit_code!r}"],
                }
            # exit 0 落到下面原推进逻辑（stage_result 据 stage 决定）。
        elif is_verify:
            # verify stage 强制 gate：gate_result None（未跑 / 异常 / sillyspec 未发版）
            # → 阻断 fail-loud（design §9，**不 fallback verify-result.md**）。
            log.warning(
                "auto_dispatch_gate_blocked_no_result",
                change_id=str(change_id),
                stage=current_stage,
            )
            return {
                "dispatched": False,
                "reason": "gate_blocked",
                "stage": current_stage,
                "errors": ["verify stage 缺 gate_result（未跑 gate / 异常 / sillyspec 未发版）"],
            }
        # 非 verify stage + gate_result None → fallback 声明态（零回归），落到下面原逻辑。

        # Resolve verify result: task-08 强制 gate —— verify stage 的 result 由
        # gate_result 决定（exit 0 → "passed"），不再读 verify-result.md。
        # read_verify_result 调用点已替换为 gate 决策（函数体保留供回退）。
        stage_result: str | None = None
        if is_verify and gate_result is not None:
            # exit 0 已在上面判定通过，verify result = passed（落 complete_stage.result）
            stage_result = "passed"

        # AD-01: Use complete_stage to set current_stage + human_gate
        complete_result = await cs.complete_stage(
            workspace_id=workspace_id,
            change_id=change_id,
            stage=sync_result.current_stage,
            result=stage_result,
            summary=None,
        )

        if complete_result.dispatch_target:
            target = complete_result.dispatch_target

            # Chain limit check
            change = await session.get(Change, change_id)
            if change is None:
                return {"dispatched": False, "reason": "change_not_found"}
            stages = change.stages or {}
            chain_count = _get_chain_count(stages)
            if chain_count >= _DISPATCH_CHAIN_LIMIT:
                return {"dispatched": False, "reason": "chain_limit_reached"}

            stages = _increment_chain_count(stages)
            change.stages = stages
            session.add(change)
            await session.commit()

            dispatch_result = await dispatch(
                session=session,
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage=target,
                user_id=user_id,
            )
            dispatch_result["reason"] = "auto_dispatch_after_complete"
            return dispatch_result

        # No dispatch needed — stage completed without auto-advance
        log.info(
            "auto_dispatch_stage_completed_no_dispatch",
            change_id=str(change_id),
            stage=sync_result.current_stage,
        )
        return {
            "dispatched": False,
            "reason": "stage_completed",
        }

    # 3. no pending step
    if not sync_result.has_pending_step:
        log.info(
            "auto_dispatch_skip_no_pending",
            change_id=str(change_id),
            stage=sync_result.current_stage,
        )
        return {"dispatched": False, "reason": "no_pending_step"}

    # 4. Check chain limit
    change = await session.get(Change, change_id)
    if change is None:
        return {"dispatched": False, "reason": "change_not_found"}

    # 4.1 Guard: don't dispatch if Hub DB stage diverges from sillyspec.db
    # (e.g. complete_stage already set "archived" but sillyspec.db still "archive")
    if change.current_stage != sync_result.current_stage:
        log.info(
            "auto_dispatch_skip_stage_diverged",
            change_id=str(change_id),
            hub_stage=change.current_stage,
            sillyspec_stage=sync_result.current_stage,
        )
        return {
            "dispatched": False,
            "reason": "stage_diverged",
            "hub_stage": change.current_stage,
            "sillyspec_stage": sync_result.current_stage,
        }

    stages = change.stages or {}
    chain_count = _get_chain_count(stages)
    if chain_count >= _DISPATCH_CHAIN_LIMIT:
        log.warning(
            "dispatch_chain_limit_reached",
            change_id=str(change_id),
            chain_count=chain_count,
            limit=_DISPATCH_CHAIN_LIMIT,
        )
        return {"dispatched": False, "reason": "chain_limit_reached"}

    # 5. Increment chain count and dispatch
    stages = _increment_chain_count(stages)
    change.stages = stages
    session.add(change)
    await session.commit()

    dispatch_result = await dispatch(
        session=session,
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=sync_result.current_stage or "",
        user_id=user_id,
    )

    if dispatch_result.get("dispatched"):
        dispatch_result["reason"] = "auto_dispatch"
    else:
        # Reset chain count on dispatch failure
        stages = _reset_chain_count(stages)
        change.stages = stages
        session.add(change)
        await session.commit()

    return dispatch_result


# ---------------------------------------------------------------------------
# AgentDispatchService
# ---------------------------------------------------------------------------


def get_config_for_stage(stage: str) -> StageAgentConfig | None:
    """Return the ``StageAgentConfig`` for *stage*, or ``None`` if not configured."""
    return STAGE_AGENT_CONFIG.get(stage)


async def has_active_run(session: AsyncSession, change_id: uuid.UUID) -> bool:
    """Return ``True`` if there is a pending/running AgentRun for this change."""
    stmt = select(AgentRun).where(
        col(AgentRun.change_id) == change_id,
        col(AgentRun.status).in_(["pending", "running"]),
    )
    row = (await session.execute(stmt)).scalars().first()
    return row is not None


async def reconcile_stale_runs(
    session: AsyncSession,
    change_id: uuid.UUID,
    max_age_hours: int = 2,
) -> list[uuid.UUID]:
    """Mark stale ``running`` AgentRuns as killed and attempt recovery.

    Handles cases where the agent process died (container restart, OOM, etc.)
    but the AgentRun record was never updated, blocking all future dispatches.

    For each reconciled run, attempts to re-trigger ``sync_stage_status`` and
    ``auto_dispatch_next_step`` to recover the lost completion callback.

    Returns list of reconciled run IDs.
    """
    from datetime import timedelta

    threshold = timedelta(hours=max_age_hours)
    stmt = select(AgentRun).where(
        col(AgentRun.change_id) == change_id,
        col(AgentRun.status) == "running",
    )
    runs = list((await session.execute(stmt)).scalars().all())

    if not runs:
        return []

    now = datetime.now(UTC)
    reconciled: list[uuid.UUID] = []

    for run in runs:
        started = run.started_at
        if started and started.tzinfo is None:
            started = started.replace(tzinfo=UTC)
        if started and (now - started) > threshold:
            log.warning(
                "reconciling_stale_run",
                run_id=str(run.id),
                change_id=str(change_id),
                started_at=str(run.started_at),
            )
            run.status = "killed"
            run.exit_code = -1
            run.finished_at = now
            session.add(run)
            reconciled.append(run.id)

    if reconciled:
        await session.commit()

        # Attempt recovery: re-sync stage status and auto-dispatch
        change = await session.get(Change, change_id)
        if change:
            for run_id in reconciled:
                try:
                    svc = SillySpecStageDispatchService(session)
                    sync_result = await svc.sync_stage_status(session, change_id, run_id)
                    if sync_result.synced:
                        stages = change.stages or {}
                        last_dispatch = stages.get("last_dispatch", {})
                        user_id_str = last_dispatch.get("user_id")
                        recovery_user_id = (
                            uuid.UUID(user_id_str)
                            if user_id_str
                            else (change.owner_id or uuid.UUID(int=0))
                        )
                        await auto_dispatch_next_step(
                            session=session,
                            workspace_id=change.workspace_id,
                            change_id=change_id,
                            user_id=recovery_user_id,
                            sync_result=sync_result,
                        )
                except Exception as exc:
                    log.warning(
                        "reconcile_recovery_failed",
                        run_id=str(run_id),
                        error=str(exc),
                    )

    return reconciled


async def cleanup_orphan_dispatch_runs(
    session: AsyncSession,
    change_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Mark legacy orphan AgentRuns as killed.

    Orphans were produced by the OLD ``dispatch_next_step`` which pre-created a
    Run A that ``start_stage_dispatch`` never used. They permanently blocked
    future dispatches (``has_active_run`` counts ``pending`` as active while
    ``reconcile_stale_runs`` only cleans ``running``).

    An orphan matches that legacy Run A's precise fingerprint:
      status='pending' AND task_id IS NULL AND lease_id IS NULL AND
      provider IS NULL AND model IS NULL AND spec_strategy='sillyspec'.

    Normal pending Runs are NEVER touched — each violates at least one
    condition: ``start_stage_dispatch`` Runs have ``spec_strategy=NULL``;
    task-level sillyspec Runs carry ``task_id``; leased Runs carry ``lease_id``;
    configured Runs carry ``provider``/``model``. Post-Wave0
    (ql-20260619-001-f6cc) no new orphans are produced because
    ``dispatch_next_step`` no longer pre-creates a Run.

    Returns the list of cleaned run IDs.
    """
    stmt = select(AgentRun).where(
        col(AgentRun.change_id) == change_id,
        col(AgentRun.status) == "pending",
        col(AgentRun.task_id).is_(None),
        col(AgentRun.lease_id).is_(None),
        col(AgentRun.provider).is_(None),
        col(AgentRun.model).is_(None),
        col(AgentRun.spec_strategy) == "sillyspec",
    )
    orphans = list((await session.execute(stmt)).scalars().all())
    if not orphans:
        return []

    now = datetime.now(UTC)
    for run in orphans:
        run.status = "killed"
        run.finished_at = now
        run.exit_code = -1
        run.output_redacted = "Cleaned as legacy orphan dispatch run (Wave0 ql-20260619-001-f6cc)."
        session.add(run)
    await session.commit()
    return [r.id for r in orphans]


async def cleanup_stale_pending_runs(
    session: AsyncSession,
    change_id: uuid.UUID,
    max_age_minutes: int = 10,
) -> list[uuid.UUID]:
    """Mark stale ``pending`` AgentRuns as killed — the generic orphan backstop.

    ``cleanup_orphan_dispatch_runs`` targets one precise legacy fingerprint
    with no time window; this catches ANY pending Run stuck longer than
    ``max_age_minutes`` regardless of origin — e.g. ``start_stage_dispatch``
    committing a Run then raising before ``dispatch_to_daemon`` lands. Such
    Runs match neither ``reconcile_stale_runs`` (running only) nor the legacy
    orphan fingerprint, so without this backstop ``has_active_run`` blocks the
    change forever.

    The time window protects normal in-flight pending Runs (created seconds
    ago, about to be dispatched): pending->running is sub-second once a lease
    is claimed, so anything still pending after minutes is genuinely orphaned.
    Comparison is done in Python (not SQL) to mirror ``reconcile_stale_runs``
    timezone handling and stay portable across DB backends.

    Returns the list of cleaned run IDs.
    """
    from datetime import timedelta

    threshold = datetime.now(UTC) - timedelta(minutes=max_age_minutes)
    stmt = select(AgentRun).where(
        col(AgentRun.change_id) == change_id,
        col(AgentRun.status) == "pending",
    )
    stale: list[AgentRun] = []
    for run in (await session.execute(stmt)).scalars().all():
        created = run.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        if created < threshold:
            stale.append(run)

    if not stale:
        return []

    now = datetime.now(UTC)
    for run in stale:
        run.status = "killed"
        run.finished_at = now
        run.exit_code = -1
        run.output_redacted = f"Cleaned as stale pending orphan (pending > {max_age_minutes}min)."
        session.add(run)
    await session.commit()
    return [r.id for r in stale]


async def _cleanup_before_dispatch(
    session: AsyncSession,
    change_id: uuid.UUID,
) -> None:
    """Pre-dispatch housekeeping shared by ``dispatch`` and ``dispatch_next_step``.

    Reconcile stale running Runs, drop legacy orphan dispatch Runs, and clear
    any stale pending orphan — all before the ``has_active_run`` gate, so a
    stuck/orphan Run never permanently blocks a change. Centralized so the two
    dispatch entry points cannot drift out of sync (``dispatch`` previously
    only reconciled and skipped orphan cleanup entirely).
    """
    await reconcile_stale_runs(session, change_id)
    await cleanup_orphan_dispatch_runs(session, change_id)
    await cleanup_stale_pending_runs(session, change_id)


async def dispatch(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    target_stage: str,
    user_id: uuid.UUID,
    provider: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Dispatch an agent for the given stage transition.

    Returns a dict with dispatch result info (empty dict if no dispatch was triggered).
    Failures are logged but never propagated — dispatch is best-effort.
    """
    config = get_config_for_stage(target_stage)
    if config is None or not config.enabled:
        return {"dispatched": False, "reason": f"no_config_for_stage:{target_stage}"}

    # Execute team 分流（2026-06-28-team-mainline-integration D-006@v1）：opt-in
    # team mode（change.stages.team_mode=True）→ 创建 execute Mission（写类 Worker
    # 并行 + Finalizer 收敛），而非单 AgentRun。默认 single（保护 change workflow，
    # 零行为变化 D-001）。per-Worker worktree 隔离 = D-006 完整实现延后；v1 共享
    # worktree（靠 task 分工避免冲突，标注待完整 worktree 隔离）。
    if target_stage == "execute":
        change_for_mode = await session.get(Change, change_id)
        if change_for_mode is not None:
            stages_mode = dict(change_for_mode.stages or {})
            if stages_mode.get("team_mode") is True:
                return await _dispatch_execute_team(session, workspace_id, change_id, user_id)

    # Reconcile stale/orphan Runs before the active-run gate
    await _cleanup_before_dispatch(session, change_id)

    # Check for concurrent runs
    if await has_active_run(session, change_id):
        return {
            "dispatched": False,
            "reason": "active_run_exists",
            "stage": target_stage,
        }

    # Record last_dispatch in change stages JSON (loaded fresh to avoid stale data)

    change = await session.get(Change, change_id)
    if change is None:
        return {"dispatched": False, "reason": "change_not_found"}

    # dict() copy avoids SQLAlchemy JSON in-place mutation not persisting.
    stages = dict(change.stages or {})
    stages["last_dispatch"] = {
        "stage": target_stage,
        "user_id": str(user_id),
        "at": datetime.now(UTC).isoformat(),
        "config": {
            "prompt_template": config.prompt_template,
            "requires_worktree": config.requires_worktree,
            "read_only": config.read_only,
        },
    }
    change.stages = stages
    session.add(change)
    await session.commit()

    # Defer to AgentService.start_stage_dispatch
    try:
        from app.modules.agent.service import AgentService

        agent_service = AgentService(session)
        run = await agent_service.start_stage_dispatch(
            workspace_id=workspace_id,
            change_id=change_id,
            user_id=user_id,
            stage=target_stage,
            prompt_template=config.prompt_template,
            requires_worktree=config.requires_worktree,
            read_only=config.read_only,
            provider=provider,
            model=model,
        )
        # Update last_dispatch with run_id and status.
        # dict() copy avoids SQLAlchemy JSON in-place mutation not persisting.
        stages = dict(change.stages or {})
        stages["last_dispatch"] = {
            **stages.get("last_dispatch", {}),
            "run_id": str(run.id),
            "status": "running",
        }
        change.stages = stages
        session.add(change)
        await session.commit()

        return {
            "dispatched": True,
            "agent_run_id": str(run.id),
            "stage": target_stage,
            "phase": config.phase,
        }
    except Exception as exc:
        log.warning(
            "stage_dispatch_failed",
            stage=target_stage,
            change_id=str(change_id),
            error=str(exc),
        )
        return {
            "dispatched": False,
            "reason": "dispatch_error",
            "error": str(exc),
            "stage": target_stage,
        }


# ---------------------------------------------------------------------------
# SillySpecStageDispatchService — unified dispatch entry (task-07)
# ---------------------------------------------------------------------------


async def _dispatch_execute_team(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Execute team 分流（D-006@v1，2026-06-28-team-mainline-integration）。

    Opt-in 入口（``change.stages.team_mode=True`` 时由 ``dispatch`` 调用）：创建
    execute Mission —— Coordinator 拆 plan 为写类 Worker（impl）→ 并行 dispatch →
    Finalizer 收敛 patch（``finalize_execute_mission``，人审 apply-back D-006）。

    per-Worker 独立 worktree 隔离 = D-006 完整实现延后；v1 共享 worktree，靠
    Coordinator 拆 task 分工避免并发写冲突（proposal §9 完整隔离留后续）。
    """
    from app.modules.agent.control import MissionControlService
    from app.modules.agent.delegation import (
        CoordinatorPlanner,
        DelegationError,
        GLMConfig,
    )
    from app.modules.agent.execution import MissionExecutionService
    from app.modules.agent.mission import MissionService

    cfg = GLMConfig.from_env()
    if cfg is None:
        return {"dispatched": False, "reason": "glm_not_configured_for_execute_team"}
    planner = CoordinatorPlanner(cfg)
    objective = (
        f"执行变更 {change_id} 的 plan：按 task 并行实现代码，每个 Worker 负责一组 "
        "task（impl 角色，写代码），产出 patch 供 Finalizer 合并、人审 apply-back。"
    )
    try:
        mission, runs = await MissionService(session).start_mission(
            workspace_id=workspace_id,
            objective=objective,
            created_by=user_id,
            change_id=change_id,
            planner=planner,
            budget_usd=4.0,
        )
    except DelegationError as exc:
        log.warning(
            "execute_team_plan_failed",
            change_id=str(change_id),
            error=str(exc),
        )
        return {"dispatched": False, "reason": f"execute_team_plan_failed:{exc}"}

    exec_svc = MissionExecutionService(session)
    ctrl = MissionControlService(session)
    now = datetime.now(UTC)
    for run in runs:
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        if not allowed:
            run.status = "killed"
            run.finished_at = now
            run.exit_code = -1
            log.info(
                "execute_team_worker_rejected",
                mission_id=str(mission.id),
                run_id=str(run.id),
                reason=reason,
            )
            continue
        try:
            await exec_svc.dispatch_worker(
                run,
                workspace_id=workspace_id,
                user_id=user_id,
                read_only=False,  # execute 写类 Worker
            )
        except Exception as exc:
            log.warning(
                "execute_team_dispatch_failed",
                run_id=str(run.id),
                error=str(exc),
            )
    await session.commit()
    log.info(
        "execute_team_dispatched",
        change_id=str(change_id),
        mission_id=str(mission.id),
        workers=len(runs),
    )
    return {
        "dispatched": True,
        "mode": "team",
        "mission_id": str(mission.id),
        "workers": len(runs),
        "stage": "execute",
    }


async def read_verify_result(
    session: AsyncSession,
    change_id: uuid.UUID,
) -> str:
    """Read verify-result.md and return 'passed' or 'failed'.

    Default to 'passed' if file missing or no conclusive marker found.
    """
    change = await session.get(Change, change_id)
    if not change or not change.path:
        return "passed"

    from app.modules.workspace.model import Workspace

    ws = await session.get(Workspace, change.workspace_id)
    if not ws or not ws.root_path:
        return "passed"

    vr_path = Path(ws.root_path) / change.path / "verify-result.md"
    if not vr_path.is_file():
        return "passed"

    text = vr_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines()[:30]:
        stripped = line.strip().upper()
        if "FAIL" in stripped and "PASS" not in stripped:
            return "failed"
        if "PASS" in stripped:
            return "passed"
    return "passed"


# ───────────────────────────────────────────────────────────────────────────
# P3 driver-gate-pilot：gate 执行与结果解析（task-06）
#
# design §5.6（Z1 启动探测）/ §7（接口）/ §9（fail-loud）。
# `_run_gate_via_delegate` 构造 ``sillyspec gate verify`` 命令经
# HostFsDelegate.run_command 在 daemon 侧执行（backend 容器够不到源代码 /
# agent 产物，design §5.3 gate-constraint-①），`_read_gate_result` 解析 gate
# JSON 输出为 ``{exit_code, errors, raw_envelope}``。供 task-07 的
# `_run_gate_decision_task` 调用（run_sync/service.py）。
# ───────────────────────────────────────────────────────────────────────────

# gate RPC 超时（design §7：12min = 720s；gate 跑 27s+，留足余量）。
_GATE_RPC_TIMEOUT_SECONDS: float = 720.0

# Z1 子命令缺失信号（design §5.6）。sillyspec 基于 oclif（``No such command``）
# 或 commander 风格（``unknown command``）；``gate is not a sillyspec command``
# 覆盖旧版无 gate 子命令的兜底报错。stderr 命中任一即判定 Z1 分支。
_GATE_SUBCOMMAND_MISSING_HINTS: tuple[str, ...] = (
    "unknown command",
    "no such command",
    "is not a sillyspec command",
    "not a sillyspec command",
)


def _new_host_fs_delegate(session: AsyncSession) -> Any:
    """Lazy-construct a HostFsDelegate bound to the process ws_hub.

    工厂函数（非 SillySpecStageDispatchService 方法），供 ``_run_gate_via_delegate``
    在模块级 async 函数中使用——参照 ``SillySpecStageDispatchService._get_host_fs_delegate``
    （:823）的构造方式（HostFsDelegate + HostFsWsRpc + 进程级 ws_hub）。lazy import
    避免顶层循环（host_fs 依赖 daemon.service 异常）。

    抽成独立工厂便于 task-06 单测注入 mock（隔离真实 WS RPC），并供 task-07
    gate 任务复用。失败抛 :class:`HostFsDelegateUnavailable` 由 caller
    （``_run_gate_via_delegate``）catch 转 exit 2 fail-loud。
    """
    from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    return HostFsDelegate(session, ws_hub=hub, ws_rpc=HostFsWsRpc(hub))


def _read_gate_result(raw_stdout: str) -> dict[str, Any]:
    """解析 ``sillyspec gate verify --json`` 的 stdout 为结果 dict。

    纯函数（design §7）：``ok=True``→exit 0；``ok=False``→exit 1；JSON 解析
    失败 / ``ok`` 字段缺失或类型异常 → exit 2（防御）。``raw_envelope`` 保留
    完整 envelope dict（落 ``AgentRun.gate_result`` 审计，design §2/§8）。

    Args:
        raw_stdout: gate 命令的 stdout 原文（期望 JSON envelope）。

    Returns:
        ``{"exit_code": int, "errors": list[str], "raw_envelope": dict}``。
    """
    try:
        envelope = json.loads(raw_stdout)
    except (json.JSONDecodeError, TypeError):
        return {
            "exit_code": 2,
            "errors": ["gate JSON 解析失败: stdout 非合法 JSON"],
            "raw_envelope": {},
        }
    if not isinstance(envelope, dict):
        return {
            "exit_code": 2,
            "errors": [f"gate JSON 解析失败: 期望对象，得到 {type(envelope).__name__}"],
            "raw_envelope": {},
        }

    ok_value = envelope.get("ok")
    if ok_value is True:
        exit_code = 0
    elif ok_value is False:
        exit_code = 1
    else:
        # ok 字段缺失 / 类型异常（非 bool）→ exit 2（防御）。
        return {
            "exit_code": 2,
            "errors": [f"gate JSON 解析失败: ok 字段缺失或类型异常 (得到 {ok_value!r})"],
            "raw_envelope": envelope,
        }

    errors = envelope.get("errors", []) or []
    if not isinstance(errors, list):
        errors = [str(errors)]

    return {
        "exit_code": exit_code,
        "errors": [str(e) for e in errors],
        "raw_envelope": envelope,
    }


async def _run_gate_via_delegate(
    session: AsyncSession,
    workspace: Any,
    change_name: str,
    spec_root: str,
    stage: str = "verify",
) -> dict[str, Any]:
    """经 HostFsDelegate.run_command 在 daemon 侧执行 ``sillyspec gate``。

    design §5.3 / §7：gate 必须 daemon 跑（容器够不到源代码），走 task-01 的
    ``HostFsDelegate.run_command``（带命令白名单 R3 安全层）。本函数负责：
    构造命令 → 调 run_command → 分析 stdout/stderr/exit_code → 返回
    ``{exit_code, errors, raw_envelope}``（task-07 据此存 gate_result + 决策）。

    **Z1 合并探测（Reverse Sync）**：TaskCard 原写「先用 run_command(["gate",
    "--help"]) 探测子命令存在性」，但 task-01 白名单
    ``_enforce_command_whitelist`` 只允许头部 ``["gate","verify","--change",
    <name>,"--json"]``——``["gate","--help"]`` 不匹配会被白名单 raise。
    故 Z1 合并到正式 gate 执行的结果分析（不破坏白名单契约，仍达 design §5.6
    「子命令缺失 fail-loud exit 2」意图）：

      1. stdout 合法 JSON envelope → ``_read_gate_result`` 解析（exit 0/1）。
      2. stdout 非法/空 + stderr 命中 :data:`_GATE_SUBCOMMAND_MISSING_HINTS`
         → Z1 分支：exit 2 + errors=["sillyspec gate 子命令缺失，需 npm publish
         发版"]（诊断非 fallback，绝不退回 read_verify_result，design §5.6/§9）。
      3. stdout 非法（无子命令缺失信号）→ exit 2 + errors=["gate JSON 解析失败"]。
      4. RPC 异常（HostFsDelegateError/DaemonRpcTimeout/DaemonRuntimeOffline 等）
         → catch 返回 exit 2 + errors=["gate 执行异常: <详情>"]（fail-loud，
         交 task-07 置 gate_status=failed）。

    Args:
        session: async DB session（HostFsDelegate 路由 daemon_id 用）。
        workspace: 目标工作区（取 path_source + id 路由 RPC）。
        change_name: 变更名（sillyspec change 目录名，非 change_id）。
        spec_root: daemon 侧 spec 根目录（cwd，run_command 执行路径）。
        stage: gate stage，当前 ``"verify"``（design §5.4 gate 当前仅 verify，
            参数化前瞻 P4 execute——注意 task-01 白名单当前只锁 verify）。

    Returns:
        ``{"exit_code": int, "errors": list[str], "raw_envelope": dict}``。
    """
    args = ["gate", stage, "--change", change_name, "--json"]
    try:
        delegate = _new_host_fs_delegate(session)
        result = await delegate.run_command(
            workspace=workspace,
            command="sillyspec",
            args=args,
            cwd=spec_root,
            timeout=_GATE_RPC_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        # RPC 异常 / ws_rpc 未接线 / daemon 离线 / 超时 → fail-loud exit 2
        # （design §5.3/§7，不抛崩 gate 任务，交 task-07 catch 置 failed）。
        log.warning(
            "gate_run_via_delegate_exception",
            change_name=change_name,
            stage=stage,
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return {
            "exit_code": 2,
            "errors": [f"gate 执行异常: {exc}"],
            "raw_envelope": {},
        }

    stdout = str(result.get("stdout", "") or "")
    stderr = str(result.get("stderr", "") or "")
    exit_code_proc = result.get("exit_code")

    # 正常路径：stdout 是合法 JSON envelope → _read_gate_result 解析。
    parsed = _read_gate_result(stdout)
    if parsed["raw_envelope"]:
        return parsed

    # stdout 非法/空（_read_gate_result 返回 raw_envelope={} 的 exit 2）→
    # 区分 Z1（子命令缺失）vs 其他解析失败。
    stderr_lower = stderr.lower()
    if any(hint in stderr_lower for hint in _GATE_SUBCOMMAND_MISSING_HINTS):
        return {
            "exit_code": 2,
            "errors": ["sillyspec gate 子命令缺失，需 npm publish 发版"],
            "raw_envelope": {},
        }

    log.warning(
        "gate_run_via_delegate_unparseable_stdout",
        change_name=change_name,
        stage=stage,
        exit_code_proc=exit_code_proc,
        stdout_preview=stdout[:200],
        stderr_preview=stderr_lower[:200],
    )
    # 其他解析失败：_read_gate_result 已生成 errors，exit 2 透传。
    return parsed


class SillySpecStageDispatchService:
    """Unified dispatch entry: create AgentRun + compose agent instructions.

    Replaces the legacy ``dispatch()`` function as the sole entry point
    for all stage-level agent dispatch.  Callers include:
    - ChangeService.transition_with_dispatch()
    - POST /changes/{id}/dispatch route
    - sync_stage_status() internal auto-dispatch
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize the dispatch service.

        Args:
            session: Async database session.
        """
        self._session = session
        # task-08：daemon-client 分支 lazy 构造的 HostFsDelegate（仅 stage
        # callback 走 daemon-client 时才需要）。仿 DaemonService.host_fs_delegate
        # lazy property，避免顶层 import 循环（host_fs 依赖 daemon.service 异常）。
        self._host_fs_delegate: Any = None

    def _get_host_fs_delegate(self) -> Any:
        """Lazy-construct HostFsDelegate for daemon-client stage sync.

        仅 daemon-client path_source 调用（sync_stage_status 分流），构造时
        绑定进程级 ws_hub + HostFsWsRpc。失败抛 HostFsDelegateUnavailable 由
        caller 兜底降级 StageSyncResult(synced=False)（D-006）。
        """
        if self._host_fs_delegate is None:
            from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
            from app.modules.daemon.ws_hub import get_daemon_ws_hub

            hub = get_daemon_ws_hub()
            self._host_fs_delegate = HostFsDelegate(
                self._session,
                ws_hub=hub,
                ws_rpc=HostFsWsRpc(hub),
            )
        return self._host_fs_delegate

    async def reconcile_pending_gate_decisions(self, session: AsyncSession) -> dict[str, int]:
        """task-10 / design §5.5：重启兜底——扫孤儿 gate 任务重置 pending + 重 enqueue。

        backend 重启时 in-flight gate 任务（gate_status pending/running）变孤儿
        （R1）。扫 status='completed' + change_id NOT NULL + gate_status IN
        (pending,running) 的 agent_runs，全部重置 gate_status='pending'（running
        孤儿必须重置才能被 task-07 R3 cas pending→running 抢），逐个
        ``_fire_background_task(_run_gate_decision_task)`` 重 enqueue。孤儿无超时
        阈值（design §5.5——pending 是过渡态，fire 即 cas 成 running）。double-fire
        （reconcile + 残留原任务）由 R3 cas 原子兜底（R10）。挂 main.py lifespan
        startup（M3，非 per-dispatch，区别 reconcile_stale_runs :587）。
        """
        # lazy import 避循环（run_sync.service 依赖本模块的
        # _run_gate_via_delegate / SillySpecStageDispatchService，顶层 import 会循环）。
        from app.modules.daemon.run_sync.service import RunSyncService

        stmt = select(AgentRun).where(
            AgentRun.status == "completed",
            col(AgentRun.change_id).is_not(None),
            col(AgentRun.gate_status).in_(("pending", "running")),
        )
        orphans = list((await session.execute(stmt)).scalars().all())

        if not orphans:
            return {"orphan_count": 0, "reset_to_pending": 0, "reenqueue": 0}

        # 全部重置 pending（running 孤儿必须重置才能被 cas 抢）。
        for run in orphans:
            run.gate_status = "pending"
        await session.commit()

        # 逐个重 enqueue（workspace_id 从 Change.workspace_id 推导，对齐 task-05/07
        # _resolve_gate_workspace_id 的稳定来源）。
        run_sync = RunSyncService(session)
        enqueued = 0
        for run in orphans:
            change_id = run.change_id
            if change_id is None:
                continue
            change = await session.get(Change, change_id)
            workspace_id = change.workspace_id if change else None
            if workspace_id is None:
                log.warning(
                    "gate_reconcile_skip_no_workspace",
                    agent_run_id=str(run.id),
                    change_id=str(change_id),
                )
                continue
            run_sync._fire_background_task(
                run_sync._run_gate_decision_task(
                    agent_run_id=run.id,
                    workspace_id=workspace_id,
                    change_id=change_id,
                ),
                workspace_id=workspace_id,
                run_id=run.id,
            )
            enqueued += 1

        count = len(orphans)
        log.warning(
            "gate_reconcile_reenqueued",
            orphan_count=count,
            reset_to_pending=count,
            reenqueue=enqueued,
        )
        return {
            "orphan_count": count,
            "reset_to_pending": count,
            "reenqueue": enqueued,
        }

    async def dispatch_next_step(
        self,
        session: AsyncSession,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        user_id: uuid.UUID,
        target_stage: str,
        provider: str | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        """Dispatch the next step for a change stage.

        Checks stage config -> checks active runs -> builds bundle
        -> creates AgentRun -> starts execution -> returns result.

        Args:
            session: Async database session.
            workspace_id: Workspace UUID.
            change_id: Change UUID.
            user_id: User UUID triggering the dispatch.
            target_stage: Target SillySpec stage name (e.g. "plan").

        Returns:
            Dict with dispatched, agent_run_id, stage, reason, etc.

        Raises:
            ChangeNotFound: change_id does not correspond to an existing Change.
        """
        from app.core.errors import ChangeNotFound

        # Step 1: Check STAGE_AGENT_CONFIG
        config = STAGE_AGENT_CONFIG.get(target_stage)
        if config is None:
            return {"dispatched": False, "reason": "stage_not_configured", "stage": target_stage}
        if not config.enabled:
            return {"dispatched": False, "reason": "stage_not_enabled", "stage": target_stage}

        # Step 2: Check Change exists
        change = await session.get(Change, change_id)
        if change is None:
            raise ChangeNotFound(f"Change '{change_id}' not found.")

        # Step 3: Clean stale/orphan Runs + check active AgentRun (prevent
        # duplicate dispatch). _cleanup_before_dispatch reconciles stale running
        # Runs, drops legacy orphan Runs, and clears any stale pending orphan —
        # all before has_active_run so none can permanently block the change.
        await _cleanup_before_dispatch(session, change_id)
        if await has_active_run(session, change_id):
            return {"dispatched": False, "reason": "active_run_exists", "stage": target_stage}

        # Step 4: Build AgentSpecBundle
        try:
            await self._build_stage_bundle(session, change_id, target_stage, workspace_id)
        except Exception as exc:
            log.warning(
                "bundle_build_failed",
                change_id=str(change_id),
                stage=target_stage,
                error=str(exc),
            )
            return {"dispatched": False, "reason": "bundle_build_error", "stage": target_stage}

        # Step 5: Record last_dispatch in change.stages JSON (run_id is
        # backfilled in Step 7 once start_stage_dispatch returns the real Run).
        # dict() copy avoids SQLAlchemy JSON in-place mutation not persisting.
        stages = dict(change.stages or {})
        stages["last_dispatch"] = {
            "stage": target_stage,
            "user_id": str(user_id),
            "at": datetime.now(UTC).isoformat(),
            "config": {
                "phase": config.phase,
                "requires_worktree": config.requires_worktree,
                "read_only": config.read_only,
            },
        }
        change.stages = stages
        session.add(change)
        await session.commit()

        # Step 6: Start Agent execution. Wave0 (ql-20260619-001-f6cc): the Run
        # is owned by start_stage_dispatch — dispatch_next_step no longer
        # pre-creates one. Using the returned Run guarantees exactly one Run per
        # execution and that the returned id is the one actually dispatched (and
        # that logs are published under). Mirrors the standalone dispatch().
        try:
            from app.modules.agent.service import AgentService

            agent_service = AgentService(session)
            run = await agent_service.start_stage_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                user_id=user_id,
                stage=target_stage,
                prompt_template=config.prompt_template,
                requires_worktree=config.requires_worktree,
                read_only=config.read_only,
                provider=provider,
                model=model,
            )
        except Exception as exc:
            log.warning("agent_start_failed", change_id=str(change_id), error=str(exc))
            return {"dispatched": False, "reason": "agent_start_error", "stage": target_stage}

        # Step 7: Backfill last_dispatch with the real run_id, then return it.
        # dict() copy avoids SQLAlchemy JSON in-place mutation not persisting.
        stages = dict(change.stages or {})
        stages["last_dispatch"] = {
            **stages.get("last_dispatch", {}),
            "run_id": str(run.id),
            "status": "running",
        }
        change.stages = stages
        session.add(change)
        await session.commit()

        return {
            "dispatched": True,
            "agent_run_id": str(run.id),
            "stage": target_stage,
        }

    async def _build_stage_bundle(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
        stage: str,
        workspace_id: uuid.UUID,
    ) -> AgentSpecBundle:
        """Build a stage-level AgentSpecBundle.

        Tries ``context_builder.build_stage_bundle()`` first; if unavailable
        (e.g. task-05 not yet complete), falls back to a minimal bundle.

        Args:
            session: Async database session.
            change_id: Change UUID.
            stage: Target stage name.
            workspace_id: Workspace UUID.

        Returns:
            AgentSpecBundle with stage_dispatch=True.
        """
        from app.modules.agent.base import AgentSpecBundle

        # Try task-05 build_stage_bundle
        try:
            from app.modules.agent.context_builder import build_stage_bundle

            return await build_stage_bundle(
                session=session,
                change_id=change_id,
                stage=stage,
                workspace_id=workspace_id,
            )
        except ImportError:
            log.info("build_stage_bundle_not_available, using fallback")
        except Exception as exc:
            log.warning("build_stage_bundle_failed", error=str(exc))

        # Fallback: minimal bundle
        change = await session.get(Change, change_id)
        return AgentSpecBundle(
            change_summary=change.title if change and change.title else f"Stage dispatch: {stage}",
            task_key=f"stage:{stage}",
            task_title=f"Stage dispatch: {stage}",
            stage_dispatch=True,
            change_key=change.change_key if change else None,
            stage=stage,
            spec_root=None,
            read_only=False,
        )

    # ------------------------------------------------------------------
    # Stage status sync (task-09)
    # ------------------------------------------------------------------

    async def sync_stage_status(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
        run_id: uuid.UUID,
        *,
        path_source: str | None = None,
    ) -> StageSyncResult:
        """AgentRun 完成后从 sillyspec.db 同步阶段/步骤状态到 Hub。

        读取 sillyspec.db 的 changes + stages + steps 表，投影到
        Change.current_stage 和 Change.stages JSON。

        Args:
            session: SQLAlchemy async session。
            change_id: 目标变更的 UUID。
            run_id: 刚完成的 AgentRun 的 UUID（用于审计追踪）。
            path_source: task-08 透传的工作区路径来源。``"daemon-client"`` 走
                HostFsDelegate RPC 读 sillyspec.db（D-004 / D-009），其他 /
                None 走原 server-local ``sqlite3.connect`` 本地容器分支
                （NFR-02 零回归）。

        Returns:
            StageSyncResult 包含同步状态和步骤信息。
            synced=True 表示同步成功。
            synced=False 表示跳过（db 不存在、读取失败等），不中断主流程。

        Raises:
            ChangeNotFound: 当 change_id 在 Hub DB 中不存在时。
        """
        from app.core.errors import ChangeNotFound
        from app.modules.workspace.service import is_daemon_client_path_source

        # Step 1: Load Change
        change = await session.get(Change, change_id)
        if change is None:
            raise ChangeNotFound(f"Change '{change_id}' not found.")

        # task-08：按 path_source 分流（D-004）。daemon-client 走 HostFsDelegate
        # RPC 读 sillyspec.db；server-local 走原 sqlite3 直读本地容器分支。
        if is_daemon_client_path_source(path_source):
            return await self._sync_stage_status_daemon_client(session, change, change_id, run_id)

        # Step 2: Resolve sillyspec.db path — try all candidates
        db_path = await self._resolve_db_path(session, change)
        fallback_db_path = await self._resolve_db_path_fallback(session, change)
        if db_path is None or not db_path.is_file():
            if fallback_db_path and fallback_db_path.is_file():
                db_path = fallback_db_path
            else:
                log.warning(
                    "sync_stage_status.db_not_found",
                    change_id=str(change_id),
                    db_path=str(db_path) if db_path else None,
                )
                return StageSyncResult(
                    synced=False,
                    change_id=change_id,
                    run_id=run_id,
                    error="sillyspec.db not found",
                )

        # Step 3: Read sillyspec.db
        conn: sqlite3.Connection | None = None
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
        except sqlite3.Error as exc:
            log.info(
                "sync_stage_status.db_connect_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"db_connect_failed: {exc}",
            )

        try:
            # Step 3a: Find change record by change_key
            row = conn.execute(
                "SELECT current_stage, status FROM changes WHERE name = ?",
                (change.change_key,),
            ).fetchone()

            if (
                row is None
                and fallback_db_path
                and fallback_db_path.is_file()
                and db_path != fallback_db_path
            ):
                # Try fallback db (workspace root_path)
                conn.close()
                log.info(
                    "sync_stage_status.trying_fallback_db",
                    change_key=change.change_key,
                    fallback=str(fallback_db_path),
                )
                try:
                    conn = sqlite3.connect(f"file:{fallback_db_path}?mode=ro", uri=True)
                    conn.row_factory = sqlite3.Row
                    row = conn.execute(
                        "SELECT current_stage, status FROM changes WHERE name = ?",
                        (change.change_key,),
                    ).fetchone()
                except sqlite3.Error:
                    row = None

            if row is None:
                log.warning(
                    "sync_stage_status.change_not_in_db",
                    change_key=change.change_key,
                    change_id=str(change_id),
                )
                if conn:
                    conn.close()
                return StageSyncResult(
                    synced=False,
                    change_id=change_id,
                    run_id=run_id,
                    error="change_key not found in sillyspec.db",
                )

            db_current_stage = row["current_stage"]

            # Step 3b: Find the current stage record
            stage_row = conn.execute(
                "SELECT id, status, completed_at FROM stages "
                "WHERE change_id = (SELECT id FROM changes WHERE name = ?) "
                "AND stage = ?",
                (change.change_key, db_current_stage),
            ).fetchone()

            stage_completed = False
            steps_completed: list[str] = []
            steps_pending: list[str] = []
            current_step: str | None = None

            if stage_row is not None:
                stage_completed = stage_row["status"] == "completed"

                # Step 3c: Find all steps for this stage
                step_rows = conn.execute(
                    "SELECT name, status FROM steps WHERE stage_id = ? ORDER BY ordering",
                    (stage_row["id"],),
                ).fetchall()

                for step in step_rows:
                    if step["status"] == "completed":
                        steps_completed.append(step["name"])
                    else:
                        steps_pending.append(step["name"])

                # Step 3d: Determine current_step (first non-completed)
                has_pending = len(steps_pending) > 0
                if has_pending:
                    current_step = steps_pending[0]
            else:
                # Stage record doesn't exist yet
                has_pending = True
                current_step = None

        except sqlite3.Error as exc:
            log.info(
                "sync_stage_status.db_read_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            if conn:
                conn.close()
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"db_read_failed: {exc}",
            )
        finally:
            if conn:
                conn.close()

        # Step 4: Sync current_stage to Change record (directly follows sillyspec.db)
        if change.current_stage != db_current_stage:
            log.info(
                "sync_stage_status.stage_updated",
                change_id=str(change_id),
                old=change.current_stage,
                new=db_current_stage,
            )
            change.current_stage = db_current_stage

        # Step 5: Sync step status to Change.stages JSON
        stages_json = change.stages or {}
        stage_key = db_current_stage
        stages_json[stage_key] = {
            "status": "completed" if stage_completed else "in_progress",
            "steps": {
                "completed": steps_completed,
                "pending": steps_pending,
            },
            "current_step": current_step,
            "synced_at": datetime.now(UTC).isoformat(),
            "synced_from_run": str(run_id),
        }
        change.stages = stages_json
        change.updated_at = datetime.now(UTC)
        session.add(change)
        await session.commit()

        # Step 6: Build and return StageSyncResult
        return StageSyncResult(
            synced=True,
            change_id=change_id,
            run_id=run_id,
            current_stage=db_current_stage,
            current_step=current_step,
            stage_completed=stage_completed,
            has_pending_step=len(steps_pending) > 0,
            steps_completed=steps_completed,
            steps_pending=steps_pending,
        )

    async def _resolve_db_path(
        self,
        session: AsyncSession,
        change: Change,
    ) -> Path | None:
        """解析 sillyspec.db 文件路径。

        优先使用 SpecWorkspace.spec_root，fallback 到 workspace.root_path。
        返回 None 表示无法确定路径。
        """
        from app.core.spec_paths import SpecPathResolver

        try:
            from app.modules.spec_workspace.model import SpecWorkspace

            stmt = select(SpecWorkspace).where(
                col(SpecWorkspace.workspace_id) == change.workspace_id
            )
            spec_ws = (await session.execute(stmt)).scalars().first()

            if spec_ws and spec_ws.strategy != "repo-native":
                # repo-mirrored: daemon 同步源项目 .sillyspec 快照到 specDir 扁平布局
                if spec_ws.strategy == "repo-mirrored":
                    resolver = SpecPathResolver(spec_ws.spec_root, platform_managed=True)
                else:
                    # platform-managed: for_spec_workspace 已设 platform_managed=True
                    resolver = SpecPathResolver.for_spec_workspace(spec_ws)
                db_path = resolver.db_path()
                log.info(
                    "spec_db_resolved",
                    db_path=str(db_path),
                    strategy=spec_ws.strategy,
                    change_id=str(change.id),
                )
                if not db_path.exists():
                    log.warning(
                        "spec_db_missing",
                        db_path=str(db_path),
                        strategy=spec_ws.strategy,
                    )
                return db_path
        except Exception:
            pass

        # Fallback: use workspace root_path
        from app.modules.workspace.model import Workspace

        ws_stmt = select(Workspace).where(col(Workspace.id) == change.workspace_id)
        workspace = (await session.execute(ws_stmt)).scalars().first()
        if not workspace or not workspace.root_path:
            return None

        return SpecPathResolver(workspace.root_path).db_path()

    async def _resolve_db_path_fallback(
        self,
        session: AsyncSession,
        change: Change,
    ) -> Path | None:
        """Always resolve from workspace root_path (used when spec_root db lacks the change)."""
        from app.core.spec_paths import SpecPathResolver
        from app.modules.workspace.model import Workspace

        ws_stmt = select(Workspace).where(col(Workspace.id) == change.workspace_id)
        workspace = (await session.execute(ws_stmt)).scalars().first()
        if not workspace or not workspace.root_path:
            return None
        return SpecPathResolver(workspace.root_path).db_path()

    async def _sync_stage_status_daemon_client(
        self,
        session: AsyncSession,
        change: Change,
        change_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> StageSyncResult:
        """task-08 daemon-client 分支：经 HostFsDelegate RPC 读 sillyspec.db。

        D-009 方案 B / D-004：daemon-client 模式 sillyspec.db 在客户端机器，
        backend 容器不可达。经 delegate.stat 判存在 + delegate.read_file 取
        内容（latin-1 往返保字节，写临时文件后 sqlite3 直读），跑同一套
        changes/stages/steps 查询。

        D-006：delegate RPC 失败（HostFsDelegateUnavailable / 传输异常）→
        StageSyncResult(synced=False) 兜底，warn 不阻塞 lease。
        """
        import tempfile

        from app.modules.workspace.model import Workspace

        # workspace + spec_ws 解析（复用 _resolve_db_path 的 spec_ws.strategy 分支）
        ws_stmt = select(Workspace).where(col(Workspace.id) == change.workspace_id)
        workspace = (await session.execute(ws_stmt)).scalars().first()
        if workspace is None or not workspace.root_path:
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error="workspace_missing_for_daemon_client_sync",
            )

        # 候选 db 绝对路径（host 侧）—— spec_root 优先，fallback workspace root
        db_candidates = await self._resolve_db_rel_candidates(session, change, workspace)
        if not db_candidates:
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error="sillyspec.db path unresolvable",
            )

        try:
            delegate = self._get_host_fs_delegate()
        except Exception as exc:
            log.warning(
                "sync_stage_status.delegate_unavailable",
                change_id=str(change_id),
                error=str(exc),
            )
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"delegate_unavailable: {exc}",
            )

        # 经 delegate.stat 探存在 + delegate.read_file 取 db 字节。
        # read_file 返回 str（UTF-8 解码），db 是二进制——用 latin-1 往返保字节
        # （latin-1 是 1:1 字节映射，无损）。写临时文件后 sqlite3.connect 直读。
        db_content: str | None = None
        for rel_path in db_candidates:
            try:
                stat_info = await delegate.stat(workspace, rel_path)
                if isinstance(stat_info, dict) and stat_info.get("exists"):
                    db_content = await delegate.read_file(workspace, rel_path)
                    break
            except Exception as exc:  # D-006：单个候选 stat/read 失败不致命
                log.info(
                    "sync_stage_status.daemon_client_db_read_failed",
                    change_id=str(change_id),
                    rel_path=rel_path,
                    error=str(exc),
                )

        if not db_content:
            log.warning(
                "sync_stage_status.daemon_client_db_not_found",
                change_id=str(change_id),
            )
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error="sillyspec.db not found via delegate",
            )

        # latin-1 往返还原字节，写临时文件供 sqlite3 直读
        try:
            db_bytes = db_content.encode("latin-1")
        except Exception as exc:
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"db_decode_failed: {exc}",
            )

        conn: sqlite3.Connection | None = None
        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp_file:
                tmp_file.write(db_bytes)
                tmp_path = Path(tmp_file.name)
            conn = sqlite3.connect(f"file:{tmp_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT current_stage, status FROM changes WHERE name = ?",
                (change.change_key,),
            ).fetchone()
            if row is None:
                log.warning(
                    "sync_stage_status.change_not_in_db",
                    change_key=change.change_key,
                    change_id=str(change_id),
                )
                return StageSyncResult(
                    synced=False,
                    change_id=change_id,
                    run_id=run_id,
                    error="change_key not found in sillyspec.db",
                )

            db_current_stage = row["current_stage"]
            stage_row = conn.execute(
                "SELECT id, status, completed_at FROM stages "
                "WHERE change_id = (SELECT id FROM changes WHERE name = ?) "
                "AND stage = ?",
                (change.change_key, db_current_stage),
            ).fetchone()

            stage_completed = False
            steps_completed: list[str] = []
            steps_pending: list[str] = []
            current_step: str | None = None
            if stage_row is not None:
                stage_completed = stage_row["status"] == "completed"
                step_rows = conn.execute(
                    "SELECT name, status FROM steps WHERE stage_id = ? ORDER BY ordering",
                    (stage_row["id"],),
                ).fetchall()
                for step in step_rows:
                    if step["status"] == "completed":
                        steps_completed.append(step["name"])
                    else:
                        steps_pending.append(step["name"])
                if steps_pending:
                    current_step = steps_pending[0]
        except sqlite3.Error as exc:
            log.info(
                "sync_stage_status.daemon_client_db_read_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            return StageSyncResult(
                synced=False,
                change_id=change_id,
                run_id=run_id,
                error=f"db_read_failed: {exc}",
            )
        finally:
            if conn:
                conn.close()
            if tmp_path is not None:
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

        # 投影到 Change（与 server-local 一致）
        if change.current_stage != db_current_stage:
            log.info(
                "sync_stage_status.stage_updated",
                change_id=str(change_id),
                old=change.current_stage,
                new=db_current_stage,
            )
            change.current_stage = db_current_stage

        stages_json = change.stages or {}
        stages_json[db_current_stage] = {
            "status": "completed" if stage_completed else "in_progress",
            "steps": {
                "completed": steps_completed,
                "pending": steps_pending,
            },
            "current_step": current_step,
            "synced_at": datetime.now(UTC).isoformat(),
            "synced_from_run": str(run_id),
        }
        change.stages = stages_json
        change.updated_at = datetime.now(UTC)
        session.add(change)
        await session.commit()

        return StageSyncResult(
            synced=True,
            change_id=change_id,
            run_id=run_id,
            current_stage=db_current_stage,
            current_step=current_step,
            stage_completed=stage_completed,
            has_pending_step=len(steps_pending) > 0,
            steps_completed=steps_completed,
            steps_pending=steps_pending,
        )

    async def _resolve_db_rel_candidates(
        self,
        session: AsyncSession,
        change: Change,
        workspace: Workspace,
    ) -> list[str]:
        """解析 sillyspec.db 相对 workspace.root_path 的候选路径（task-08）。

        daemon-client 分支专用：返回 RPC 友好的相对路径列表（spec_root 优先 +
        workspace root fallback），供 delegate.stat/read_file 消费。host 绝对路径
        容器不可达，故只算 rel。
        """
        from app.core.spec_paths import SpecPathResolver
        from app.modules.spec_workspace.model import SpecWorkspace

        candidates: list[str] = []
        root = Path(workspace.root_path)

        try:
            stmt = select(SpecWorkspace).where(
                col(SpecWorkspace.workspace_id) == change.workspace_id
            )
            spec_ws = (await session.execute(stmt)).scalars().first()
            if spec_ws and spec_ws.strategy != "repo-native" and spec_ws.spec_root:
                if spec_ws.strategy == "repo-mirrored":
                    resolver = SpecPathResolver(spec_ws.spec_root, platform_managed=True)
                else:
                    resolver = SpecPathResolver.for_spec_workspace(spec_ws)
                db_abs = resolver.db_path()
                try:
                    rel = db_abs.resolve().relative_to(root.resolve())
                    candidates.append(str(rel).replace("\\", "/"))
                except ValueError:
                    candidates.append(str(db_abs).replace("\\", "/"))
        except Exception:
            pass

        # fallback：workspace root_path 下 .sillyspec/.runtime/sillyspec.db
        default_db = SpecPathResolver(workspace.root_path).db_path()
        try:
            rel = default_db.resolve().relative_to(root.resolve())
            candidates.append(str(rel).replace("\\", "/"))
        except ValueError:
            candidates.append(str(default_db).replace("\\", "/"))

        # 去重保序
        seen: set[str] = set()
        unique: list[str] = []
        for c in candidates:
            if c not in seen:
                seen.add(c)
                unique.append(c)
        return unique

    async def _read_verify_result(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
    ) -> str:
        return await read_verify_result(session, change_id)


# ---------------------------------------------------------------------------
# Prompt template loader
# ---------------------------------------------------------------------------

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_prompt_template(template_name: str, context: dict[str, Any] | None = None) -> str:
    """Load and render a prompt template.

    The template is a simple markdown file. ``{{variable}}`` placeholders
    are replaced with values from *context*.
    """
    path = _PROMPTS_DIR / template_name
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        log.warning("prompt_template_not_found", template_name=template_name)
        return ""

    if context:
        for key, value in context.items():
            text = text.replace(f"{{{{{key}}}}}", str(value))

    return text
