"""DS-6 会话恢复巡检兜底（2026-08-21-session-reopen-resume task-05 / FR-07）.

背景：reopen / daemon 重启 recover 把会话翻 ``reconnecting`` 后，恢复成败由
daemon 回调 confirm-reconnected / mark-recovery-failed 翻转；旧版 daemon 未
升级不发 confirm、或回调丢失时，会话会永久卡在 ``reconnecting``。本模块是
后端侧巡检兜底（与 DS-5 手动重试窗口构成双保险）：

- :func:`session_reconnect_sweep_once`：无状态单次扫描（注入 AsyncSession，
  便于单测直调）。把 ``status='reconnecting'`` 且 ``last_active_at`` 距今超过
  :data:`RECONNECTING_RETRY_WINDOW_SEC`（180s，常量唯一落点
  session/service.py，本模块只 import 不重复定义）的会话收敛为 ``failed``
  （写 ``ended_at``），命中行的挂起 lease（pending/claimed）置 ``cancelled``
  （design 审查 gap 修复定案：interactive lease 恒 NULL ``lease_expires_at``，
  ``expired`` 不适用；``cancelled`` 与"恢复放弃"语义一致）。时间阈值在
  Python 侧用 ``datetime.now(UTC)`` 算好后绑定参数，不依赖 DB 方言时间函数
  （aiosqlite / PG 双方言，NFR-04）。
- :func:`session_reconnect_sweeper`：常驻循环（60s 周期，interval 参数默认值
  表达，不新增 Settings 开关——巡检常开，constraints 定案），仿
  ``mission_patrol_loop`` 协程手法（agent/patrol.py:490-498）；main.py lifespan
  ``create_task`` 挂载、finally cancel + gather 关停。
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.session.service import RECONNECTING_RETRY_WINDOW_SEC
from app.modules.daemon.session_events import publish_sessions_changed

log = get_logger(__name__)

# 巡检周期（design DS-6 定 60s）。以 interval 参数默认值表达，不加 Settings
# 字段/开关（task-05 constraints：巡检常开，与 mission_patrol_enabled 先例不同）。
SWEEP_INTERVAL_SEC = 60

# runtime 离线宽限（2026-08-24 会话审查 P2b）：active/pending 会话其 runtime
# 心跳早于该阈值（或 status 非 online）即收敛 failed。daemon 正常重启会把
# 会话翻 reconnecting 走既有 sweep；走到本档说明 runtime 长时间无心跳且未
# 恢复（机器关机 / 进程死亡不重启），不收敛会永远 active、前端永远转圈。
RUNTIME_OFFLINE_GRACE_SEC = 600

# 仅挂起态 lease 需收敛 cancelled；已终态（completed / cancelled / expired）
# 不回写——幂等且不动 lease 状态机取值集合（model.py status 为 free-form
# String(20)，本模块不引入新取值）。
_SWEEPABLE_LEASE_STATUSES = ("pending", "claimed")

# 离线档收敛的会话状态（active=已建立；pending=派发后从未就绪）。
_OFFLINE_SWEEPABLE_SESSION_STATUSES = ("active", "pending")


async def _publish_session_ended(session_id, *, reason: str, current_run_id=None) -> None:
    """广播 session_ended（best-effort，Redis 抖动不影响收敛本身）.

    SSE 生成器（AgentService.stream_session_logs）只在收到 session_ended 时
    收尾；终态写入点不广播会让已连上的客户端永远收 keepalive。
    """
    try:
        redis = get_redis()
        await redis.publish(
            f"agent_session:{session_id}",
            json.dumps(
                {
                    "event": "session_ended",
                    "session_id": str(session_id),
                    "reason": reason,
                    "current_run_id": str(current_run_id) if current_run_id else None,
                },
                default=str,
            ),
        )
    except Exception:
        log.warning("sweep_publish_session_ended_failed", session_id=str(session_id), reason=reason)


async def session_reconnect_sweep_once(session: AsyncSession) -> int:
    """单次扫描收敛卡死的 reconnecting 会话（返回收敛行数 int）.

    条件仅两条：``status='reconnecting'`` AND ``last_active_at <
    now-RECONNECTING_RETRY_WINDOW_SEC``（软删行同样收敛，无可见影响——条件
    刻意不挂 ``deleted_at``）。实现走「先 SELECT 候选 id/lease_id，再两步条件
    UPDATE」（task-05 implementation 定案，方言兼容按仓库先例不用
    UPDATE..RETURNING）：

    1. SELECT 候选行的 id / lease_id（只取收敛 lease 所需列）；
    2. 条件 UPDATE agent_sessions → ``failed`` + ``ended_at=now``——WHERE 重挂
       同样两条条件，SELECT 与 UPDATE 之间被并发 confirm 翻转的行不会误伤，
       多轮 / 多 worker 重复执行幂等（第二次命中 0 行）；
    3. 条件 UPDATE 命中行的挂起 lease（pending/claimed）→ ``cancelled``。

    三步同事务、最后统一 commit；时间比较在 Python 侧算好阈值再绑定。
    """
    now = datetime.now(UTC)
    # Python 侧算好阈值再绑定：不依赖 DB 方言时间函数（NFR-04）。
    threshold = now - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC)

    hit_rows = (
        await session.execute(
            select(AgentSession.id, AgentSession.lease_id).where(
                AgentSession.status == "reconnecting",
                AgentSession.last_active_at < threshold,
            )
        )
    ).all()
    if not hit_rows:
        return 0

    hit_ids = [row.id for row in hit_rows]
    result = await session.execute(
        update(AgentSession)
        .where(
            AgentSession.id.in_(hit_ids),
            AgentSession.status == "reconnecting",
            AgentSession.last_active_at < threshold,
        )
        .values(status="failed", ended_at=now)
    )
    converged = int(result.rowcount or 0)

    lease_ids = [row.lease_id for row in hit_rows if row.lease_id is not None]
    if lease_ids:
        await session.execute(
            update(DaemonTaskLease)
            .where(
                DaemonTaskLease.id.in_(lease_ids),
                DaemonTaskLease.status.in_(_SWEEPABLE_LEASE_STATUSES),
            )
            .values(status="cancelled", updated_at=now)
        )

    await session.commit()
    # 终态广播（P2b）：sweep 收敛此前不发任何事件，已连上的 SSE 永远 keepalive。
    # 以 UPDATE 后状态复查决定广播对象（条件 UPDATE 未命中的并发翻转行 status
    # 已非 failed，不发——避免向活会话误发 ended）。
    final_rows = (
        await session.execute(
            select(AgentSession.id, AgentSession.status, AgentSession.user_id).where(
                AgentSession.id.in_(hit_ids)
            )
        )
    ).all()
    for row in final_rows:
        if row.status == "failed":
            await _publish_session_ended(row.id, reason="reconnect_window_expired")
            # task-03（design §3）：终态收敛同步广播列表变更信号（status_changed），
            # 会话列表秒级反映。逐行发（design 定案）；publish 内部静默容错，
            # 巡检常驻协程不加重试（constraints）。
            await publish_sessions_changed("status_changed", row.id, row.user_id)
    return converged


async def session_offline_sweep_once(session: AsyncSession) -> int:
    """单次扫描收敛 runtime 长时间离线的 active/pending 会话（返回收敛行数）.

    2026-08-24 会话审查 P2b（M-2/H-3）：daemon 永久死亡（机器报废 / 进程死亡
    不重启）后，active 会话无任何收敛路径——sweep 只扫 reconnecting，用户
    inject 每轮"派发失败 run failed 但会话保持 active"，前端永远转圈。本档
    补位：``status IN ('active','pending')`` 且 runtime 不满足
    ``status='online' AND last_heartbeat_at >= now-RUNTIME_OFFLINE_GRACE_SEC``
    的会话收敛 ``failed``。

    daemon 正常重启的会话走 recover → reconnecting → 既有 sweep，不会进本档
    （重启即翻状态）；进本档的都是长时间无心跳且未恢复的 runtime。

    收敛动作同事务三步（对齐 reconnecting sweep 手法）：
    1. 会话 → ``failed`` + ``ended_at``（条件 UPDATE 重挂状态条件，幂等）；
    2. 命中会话的挂起 run（pending/running）→ ``failed`` + ``finished_at``；
    3. 挂起 lease（pending/claimed）→ ``cancelled``。
    commit 后逐会话广播 ``session_ended``（reason=runtime_offline）。
    """
    now = datetime.now(UTC)
    grace = now - timedelta(seconds=RUNTIME_OFFLINE_GRACE_SEC)

    online_runtime = (
        select(DaemonRuntime.id)
        .where(
            DaemonRuntime.id == AgentSession.runtime_id,
            col(DaemonRuntime.status) == "online",
            col(DaemonRuntime.last_heartbeat_at) >= grace,
        )
        .correlate(AgentSession)
        .exists()
    )
    hit_rows = (
        await session.execute(
            select(AgentSession.id, AgentSession.lease_id).where(
                AgentSession.status.in_(_OFFLINE_SWEEPABLE_SESSION_STATUSES),
                col(AgentSession.runtime_id).is_not(None),
                ~online_runtime,
            )
        )
    ).all()
    if not hit_rows:
        return 0

    hit_ids = [row.id for row in hit_rows]
    await session.execute(
        update(AgentSession)
        .where(
            AgentSession.id.in_(hit_ids),
            AgentSession.status.in_(_OFFLINE_SWEEPABLE_SESSION_STATUSES),
        )
        .values(status="failed", ended_at=now)
    )

    # 命中会话的挂起 run 一并收敛（否则 run 永远 running）。
    await session.execute(
        update(AgentRun)
        .where(
            AgentRun.agent_session_id.in_(hit_ids),
            AgentRun.status.in_(("pending", "running")),
        )
        .values(status="failed", finished_at=now)
    )

    lease_ids = [row.lease_id for row in hit_rows if row.lease_id is not None]
    if lease_ids:
        await session.execute(
            update(DaemonTaskLease)
            .where(
                DaemonTaskLease.id.in_(lease_ids),
                DaemonTaskLease.status.in_(_SWEEPABLE_LEASE_STATUSES),
            )
            .values(status="cancelled", updated_at=now)
        )

    await session.commit()

    final_rows = (
        await session.execute(
            select(AgentSession.id, AgentSession.status, AgentSession.user_id).where(
                AgentSession.id.in_(hit_ids)
            )
        )
    ).all()
    for row in final_rows:
        if row.status == "failed":
            await _publish_session_ended(row.id, reason="runtime_offline")
            # task-03（design §3）：同 reconnecting 档——逐行广播列表变更信号。
            await publish_sessions_changed("status_changed", row.id, row.user_id)
    return len([r for r in final_rows if r.status == "failed"])


async def session_reconnect_sweeper(interval: float = SWEEP_INTERVAL_SEC) -> None:
    """常驻巡检循环（main.py lifespan ``create_task`` 消费）.

    仿 ``mission_patrol_loop``（agent/patrol.py）：每轮经 ``get_session_factory()``
    开短 session 调 :func:`session_reconnect_sweep_once`，轮间不长期占连接池；
    单轮异常 ``except Exception`` 只 ``log.exception`` 吞掉、不崩循环；
    ``asyncio.sleep(interval)`` 处 ``CancelledError`` 透传（BaseException 不被
    ``except Exception`` 吞，shutdown cancel 才能干净落地）。关停由调用方
    ``task.cancel()`` + ``await asyncio.gather(task, return_exceptions=True)``
    落地（对齐 patrol 关停契约——巡检轮内有 DB 写，须等取消落地）。
    """
    while True:
        try:
            async with get_session_factory()() as db_session:
                converged = await session_reconnect_sweep_once(db_session)
                # P2b：同一轮顺带收敛 runtime 离线的 active/pending 会话
                # （daemon 永久死亡场景，reconnecting sweep 覆盖不到）。
                offline_converged = await session_offline_sweep_once(db_session)
            if converged:
                log.warning(
                    "session_reconnect_sweep_converged",
                    count=converged,
                    window_seconds=RECONNECTING_RETRY_WINDOW_SEC,
                )
            if offline_converged:
                log.warning(
                    "session_offline_sweep_converged",
                    count=offline_converged,
                    grace_seconds=RUNTIME_OFFLINE_GRACE_SEC,
                )
        except Exception:
            log.exception("session_reconnect_sweep_round_failed")
        # cancel 透传：sleep 是循环唯一的常规挂起点，CancelledError 必须穿出
        # 循环保证 lifespan 的 cancel + await 干净落地。
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
