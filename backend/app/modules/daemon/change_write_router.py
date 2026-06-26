"""daemon-client change-write 任务队列回执端点 (task-09, FR-08 / D-004@v1).

daemon-client workspace 的 change 代写任务队列：daemon 经 lease-polling 轮询消费
（GET /runtimes/{rid}/pending-change-writes → claim(token 轮转) → 本地写
changes/<key>/ → complete 回执），**不启动 agent**（与 DaemonTaskLease 的
agent-run 语义区分，故独立表 daemon_change_writes 而非复用 lease.kind）。

设计来源：
- design §5.3 Phase 3：daemon 不暴露 HTTP，change-write 经 lease-polling。
- design §7.5 契约表：write_change 下发 pending→claimed；回执 claimed→done。
- design NFR-03：claimed 超时 60s → failed（前端可重试）。

鉴权：复用 ``get_current_principal``（daemon X-API-Key 或 Bearer），不新增 auth。
并发互斥：PG 走 ``SELECT ... FOR UPDATE SKIP LOCKED``；SQLite 无该语法退化为
事务内 ``status`` 状态校验（先 SELECT 再 UPDATE，靠行级状态判抢占结果，断言不
绑死 SQL 方言名）。
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.auth_deps import get_current_principal
from app.core.db import get_session
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonChangeWrite
from app.modules.daemon.schema import (
    ChangeWriteClaimResponse,
    ChangeWriteCompleteRequest,
    ChangeWritePendingItem,
)

log = get_logger(__name__)

router = APIRouter(tags=["daemon"])

# NFR-03：claimed 行超时阈值（秒），超时由 gc 置 failed。
CHANGE_WRITE_CLAIM_TIMEOUT_SECONDS = 60


# ── Domain errors (task-09；对齐 lease 风格，独立本包定义) ──────────────────


class DaemonChangeWriteNotFound(AppError):
    code = "HTTP_404_DAEMON_CHANGE_WRITE_NOT_FOUND"
    http_status = 404


class DaemonChangeWriteNotPending(AppError):
    """claim 时行非 pending（已 claimed/done/failed）→ 409。"""

    code = "HTTP_409_DAEMON_CHANGE_WRITE_NOT_PENDING"
    http_status = 409


class DaemonChangeWriteNotClaimed(AppError):
    """complete 时行非 claimed → 409。"""

    code = "HTTP_409_DAEMON_CHANGE_WRITE_NOT_CLAIMED"
    http_status = 409


class DaemonChangeWriteTokenMismatch(AppError):
    """complete 校验 claim_token 不匹配 → 409（task-09 明确 token/状态不符 409）。"""

    code = "HTTP_409_DAEMON_CHANGE_WRITE_TOKEN_MISMATCH"
    http_status = 409


def _is_sqlite(session: AsyncSession) -> bool:
    """dialect 探测：SQLite 无 ``FOR UPDATE SKIP LOCKED``，走退化分支。"""
    bind = session.bind
    dialect_name = getattr(bind, "dialect", None)
    name = getattr(dialect_name, "name", "") if dialect_name else ""
    return name == "sqlite"


async def _gc_expired_change_writes(session: AsyncSession) -> int:
    """NFR-03：把 claimed 超时（claimed_at < now-60s）的行置 failed。

    复用 lease ``gc_expired_leases`` 的批处理语义（单事务扫一遍 + 状态翻转），
    由 pending 端点顺带触发，避免新增后台 sweep 调度（task-09 约束：不扩调度）。

    Returns: 被回收的行数（仅日志用，断言不绑死）。
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=CHANGE_WRITE_CLAIM_TIMEOUT_SECONDS)
    stmt = (
        select(DaemonChangeWrite)
        .where(DaemonChangeWrite.status == "claimed")  # type: ignore[arg-type]
        .where(DaemonChangeWrite.claimed_at.is_not(None))  # type: ignore[attr-defined]
        .where(DaemonChangeWrite.claimed_at < cutoff)  # type: ignore[operator]
    )
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return 0
    now = datetime.now(UTC)
    for cw in rows:
        cw.status = "failed"
        cw.error = "claim timeout"
        cw.completed_at = now
        session.add(cw)
    await session.commit()
    log.info("change_write_gc_expired", count=len(rows))
    return len(rows)


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get(
    "/runtimes/{runtime_id}/pending-change-writes",
    response_model=list[ChangeWritePendingItem],
)
async def get_pending_change_writes(
    runtime_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_principal)],
) -> list[ChangeWritePendingItem]:
    """daemon 轮询：返回 runtime 下所有 pending change-write（FR-08）。

    对齐 ``pending-leases``（router.py:1392）——raw SQL + mapping 返回。顺带触发
    NFR-03 超时 gc，保证 daemon 看到的 pending 集不被超时 claimed 行卡住（claimed
    行不返回，gc 只清超时行）。
    """
    # 顺带回收超时 claimed 行（NFR-03），不影响本端点返回（只返回 pending）。
    await _gc_expired_change_writes(session)

    # 用 ORM 查询（非 raw SQL）：runtime_id 是 UUID 列，SQLite 原生驱动无法绑定
    # UUID 对象、且 raw SQL 的字符串比对与 Uuid 列序列化格式未必一致；ORM 让
    # SQLAlchemy 统一处理跨 dialect 的 UUID 序列化（PG/SQLite 均正确）。
    stmt = (
        select(DaemonChangeWrite)
        .where(DaemonChangeWrite.runtime_id == runtime_id)  # type: ignore[arg-type]
        .where(DaemonChangeWrite.status == "pending")  # type: ignore[arg-type]
        .order_by(DaemonChangeWrite.created_at)
    )
    rows = (await session.execute(stmt)).scalars().all()
    out: list[ChangeWritePendingItem] = []
    for cw in rows:
        out.append(
            ChangeWritePendingItem(
                task_id=cw.id,
                change_key=cw.change_key,
                workspace_id=cw.workspace_id,
                files=cw.files or [],
                created_at=cw.created_at,  # type: ignore[arg-type]
            )
        )
    return out


@router.post(
    "/change-writes/{change_write_id}/claim",
    response_model=ChangeWriteClaimResponse,
)
async def claim_change_write(
    change_write_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_principal)],
) -> ChangeWriteClaimResponse:
    """daemon 抢占一行 pending change-write：生成 claim_token，pending→claimed。

    幂等：同 id 已 claimed/done/failed 拒（409）。并发两 daemon 抢同一行靠
    SKIP LOCKED（PG）/ 事务内状态校验（SQLite）互斥——只能一方得手。
    """
    now = datetime.now(UTC)
    claim_token = secrets.token_hex(32)

    # ── PG: SELECT ... FOR UPDATE SKIP LOCKED（行级互斥） ──────────────────
    if not _is_sqlite(session):
        locked = await session.execute(
            sa_text(
                """
                SELECT id, change_key, files
                FROM daemon_change_writes
                WHERE id = :cid AND status = 'pending'
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"cid": str(change_write_id)},
        )
        row = locked.mappings().first()
        if row is None:
            # 可能不存在、或已被他人锁/抢占。区分一下：行不存在→404，否则→409。
            existing = await session.get(DaemonChangeWrite, change_write_id)
            if existing is None:
                raise DaemonChangeWriteNotFound(
                    f"Change write '{change_write_id}' not found.",
                    details={"change_write_id": str(change_write_id)},
                )
            raise DaemonChangeWriteNotPending(
                f"Change write '{change_write_id}' is not pending (status={existing.status}).",
                details={
                    "change_write_id": str(change_write_id),
                    "status": existing.status,
                },
            )
        await session.execute(
            sa_text(
                """
                UPDATE daemon_change_writes
                SET status = 'claimed', claim_token = :tok, claimed_at = :now
                WHERE id = :cid
                """
            ),
            {"tok": claim_token, "now": now, "cid": str(change_write_id)},
        )
        await session.commit()
        change_key = row["change_key"]
        files = row["files"] or []
    else:
        # ── SQLite 退化：事务内状态校验（无 SKIP LOCKED） ─────────────────
        cw = await session.get(DaemonChangeWrite, change_write_id)
        if cw is None:
            raise DaemonChangeWriteNotFound(
                f"Change write '{change_write_id}' not found.",
                details={"change_write_id": str(change_write_id)},
            )
        if cw.status != "pending":
            raise DaemonChangeWriteNotPending(
                f"Change write '{change_write_id}' is not pending (status={cw.status}).",
                details={
                    "change_write_id": str(change_write_id),
                    "status": cw.status,
                },
            )
        cw.status = "claimed"
        cw.claim_token = claim_token
        cw.claimed_at = now
        session.add(cw)
        await session.commit()
        change_key = cw.change_key
        files = cw.files or []

    log.info(
        "daemon_change_write_claimed",
        change_write_id=str(change_write_id),
    )
    return ChangeWriteClaimResponse(
        task_id=change_write_id,
        claim_token=claim_token,
        change_key=change_key,
        files=files,
    )


@router.post(
    "/change-writes/{change_write_id}/complete",
    response_model=dict,
)
async def complete_change_write(
    change_write_id: uuid.UUID,
    data: ChangeWriteCompleteRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_principal)],
) -> dict:
    """daemon 回执：校验 claim_token + status=claimed → ok 落 done / 失败落 failed。

    token/状态不符 → 409。``ok=True`` 时可选 ``files`` 回写实际写入路径清单。
    """
    cw = await session.get(DaemonChangeWrite, change_write_id)
    if cw is None:
        raise DaemonChangeWriteNotFound(
            f"Change write '{change_write_id}' not found.",
            details={"change_write_id": str(change_write_id)},
        )
    if cw.status != "claimed":
        raise DaemonChangeWriteNotClaimed(
            f"Change write '{change_write_id}' is not claimed (status={cw.status}).",
            details={
                "change_write_id": str(change_write_id),
                "status": cw.status,
            },
        )
    # token 轮转校验对齐 lease _get_lease_and_verify_token。
    if not cw.claim_token or cw.claim_token != data.claim_token:
        raise DaemonChangeWriteTokenMismatch(
            "Invalid or missing claim_token.",
            details={"change_write_id": str(change_write_id)},
        )

    now = datetime.now(UTC)
    if data.ok:
        cw.status = "done"
        cw.completed_at = now
        if data.files is not None:
            cw.files = data.files
        cw.error = None
    else:
        cw.status = "failed"
        cw.completed_at = now
        cw.error = data.error or "change write failed"
    session.add(cw)
    await session.commit()

    log.info(
        "daemon_change_write_completed",
        change_write_id=str(change_write_id),
        ok=data.ok,
    )
    return {"task_id": str(change_write_id), "status": cw.status}
