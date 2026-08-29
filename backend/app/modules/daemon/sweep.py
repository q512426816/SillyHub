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

2026-08-29-daemon-platform-resilience task-05 / design A5（FR-04）追加：

- :func:`session_offline_sweep_once` 离线档改挂起语义——**active 会话收敛
  ``suspended``**（原 failed；非终态可 recover，D-001 恢复口径），**pending
  会话维持 failed**（D-007：daemon 本地无快照记录，suspended 无人 recover）；
  run→failed / lease→cancelled 两步维持现状。suspended 非终态只广播列表
  ``status_changed`` 不发 ``session_ended``。每轮顺带 **suspended 超龄 GC**
  （:data:`SUSPENDED_MAX_AGE_SEC`，默认 24h）——超龄 suspended → failed
  （此时才发终态 ``session_ended``），防 daemon 永不回归的永久泄漏。

2026-08-29-daemon-platform-resilience task-03 / design A4（FR-02）追加：

- :func:`lease_expiry_sweep_once`：lease 过期 GC 单拍——把既有但无调用方的
  ``LeaseService.handle_expired_leases_batch``（内部首步即 ``expire_leases``）
  与 ``DaemonLeaseService.alert_stuck_terminating_leases`` 接线成一轮；三函数
  语义零改动，只新增调用方。claimed batch lease 心跳停后过期重派
  （attempt<3 → run 翻 pending + 新 pending lease）或 run failed（≥3）。
- :func:`lease_expiry_sweeper`：常驻循环（60s 周期），模式与关停契约同
  :func:`session_reconnect_sweeper`。
- :func:`wake_pending_leases_for_online_daemons_once`：backend 重启恢复单拍——
  对在线 daemon（DB status=online）名下的 pending batch lease 重发 WS 唤醒
  （复用 ``RunPlacementService._send_ws_wakeup``），main.py lifespan 启动时
  调一次；重发幂等（ws_hub 唤醒去重滑窗 + daemon claim 幂等，无 DB 副作用）。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
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
# 心跳早于该阈值（或 status 非 online）即收敛。daemon 正常重启会把
# 会话翻 reconnecting 走既有 sweep；走到本档说明 runtime 长时间无心跳且未
# 恢复（机器关机 / 进程死亡不重启），不收敛会永远 active、前端永远转圈。
RUNTIME_OFFLINE_GRACE_SEC = 600

# suspended 挂起态上限时长（2026-08-29-daemon-platform-resilience task-05 /
# design A5 / FR-04）：挂起时刻（suspend-batch / offline sweep 翻 suspended 时
# 写入的 last_active_at）距今超过该阈值即 GC 置 failed（防永久泄漏——daemon
# 永不回来时 24h 后收敛终态并广播 session_ended）。模块常量表达可配（对齐
# RUNTIME_OFFLINE_GRACE_SEC 先例），不新增 Settings 字段（task constraints）。
SUSPENDED_MAX_AGE_SEC = 24 * 3600

# 仅挂起态 lease 需收敛 cancelled；已终态（completed / cancelled / expired）
# 不回写——幂等且不动 lease 状态机取值集合（model.py status 为 free-form
# String(20)，本模块不引入新取值）。
_SWEEPABLE_LEASE_STATUSES = ("pending", "claimed")

# 离线档收敛的会话状态（active=已建立；pending=派发后从未就绪）。task-05
# （design A5 / D-007）起两态归宿分流：active → suspended（非终态可 recover），
# pending → failed（daemon 本地 sessions.json 无快照记录，suspended 无人
# recover，维持 failed 语义更准确）。
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
    的会话按状态分流收敛（task-05 / design A5 / D-007）：

    - **active → suspended**（原 failed）：非终态挂起——daemon 重启后经
      recover → reconnecting 自动恢复（D-001 恢复口径）；同写
      ``last_active_at=now`` 作挂起时刻（超龄 GC 基准）；
    - **pending → failed**（维持原语义）：daemon 本地 sessions.json 无快照
      记录（仅持久化 active 且有 agentSessionId 的会话），suspended 无人
      recover 只能等 24h GC，维持 failed 更准确。

    daemon 正常重启的会话走 recover → reconnecting → 既有 sweep，不会进本档
    （重启即翻状态）；进本档的都是长时间无心跳且未恢复的 runtime。

    同事务保持既有两步（对齐 reconnecting sweep 手法）：
    1. 命中会话（两态）的挂起 run（pending/running）→ ``failed`` + ``finished_at``；
    2. 挂起 lease（pending/claimed）→ ``cancelled``。

    **suspended 超龄 GC（task-05 / design A5，每轮顺带）**：``status='suspended'``
    且 ``coalesce(last_active_at, created_at)`` 距今超过
    :data:`SUSPENDED_MAX_AGE_SEC`（24h）→ ``failed`` + ``ended_at``——daemon
    永不回来时防永久泄漏；coalesce 兜底脏数据 NULL（正常两路径翻 suspended
    均写 last_active_at）。条件 UPDATE 重挂全部条件，幂等可重入。

    commit 后逐会话按终态分流广播：failed（pending 档 + GC 档）发
    ``session_ended``（reason=runtime_offline / suspended_expired）+ 列表
    status_changed；suspended 非终态**只发 status_changed 不发 session_ended**
    （design A5：SSE 会话流继续 keepalive）。
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
            select(AgentSession.id, AgentSession.lease_id, AgentSession.status).where(
                AgentSession.status.in_(_OFFLINE_SWEEPABLE_SESSION_STATUSES),
                col(AgentSession.runtime_id).is_not(None),
                ~online_runtime,
            )
        )
    ).all()

    # SELECT 带出 status 分流两态；UPDATE 重挂各自状态条件——SELECT 与 UPDATE
    # 之间被并发（ready 翻 active / recover 翻 reconnecting）改态的行不会误伤。
    active_ids = [row.id for row in hit_rows if row.status == "active"]
    pending_ids = [row.id for row in hit_rows if row.status == "pending"]
    hit_ids = [row.id for row in hit_rows]
    converged = 0

    if active_ids:
        result = await session.execute(
            update(AgentSession)
            .where(
                AgentSession.id.in_(active_ids),
                AgentSession.status == "active",
            )
            .values(status="suspended", last_active_at=now)
        )
        converged += int(result.rowcount or 0)

    if pending_ids:
        result = await session.execute(
            update(AgentSession)
            .where(
                AgentSession.id.in_(pending_ids),
                AgentSession.status == "pending",
            )
            .values(status="failed", ended_at=now)
        )
        converged += int(result.rowcount or 0)

    # 命中会话的挂起 run 一并收敛（否则 run 永远 running）。
    if hit_ids:
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

    # ── suspended 超龄 GC（同事务顺带；条件全重挂保证幂等）──
    gc_threshold = now - timedelta(seconds=SUSPENDED_MAX_AGE_SEC)
    suspended_age = func.coalesce(AgentSession.last_active_at, AgentSession.created_at)
    gc_ids = [
        row.id
        for row in (
            await session.execute(
                select(AgentSession.id).where(
                    AgentSession.status == "suspended",
                    suspended_age < gc_threshold,
                )
            )
        ).all()
    ]
    gc_failed_ids: set[uuid.UUID] = set()
    if gc_ids:
        result = await session.execute(
            update(AgentSession)
            .where(
                AgentSession.id.in_(gc_ids),
                AgentSession.status == "suspended",
                suspended_age < gc_threshold,
            )
            .values(status="failed", ended_at=now)
        )
        gc_failed_count = int(result.rowcount or 0)
        converged += gc_failed_count
        if gc_failed_count:
            gc_failed_ids = set(gc_ids)

    if not hit_rows and not gc_ids:
        return 0

    await session.commit()

    final_rows = (
        await session.execute(
            select(AgentSession.id, AgentSession.status, AgentSession.user_id).where(
                AgentSession.id.in_(hit_ids + gc_ids)
            )
        )
    ).all()
    for row in final_rows:
        if row.status == "failed":
            # GC 档与离线档失败行区分广播 reason（SSE 收尾依赖 session_ended）。
            reason = "suspended_expired" if row.id in gc_failed_ids else "runtime_offline"
            await _publish_session_ended(row.id, reason=reason)
            # task-03（design §3）：同 reconnecting 档——逐行广播列表变更信号。
            await publish_sessions_changed("status_changed", row.id, row.user_id)
        elif row.status == "suspended":
            # 非终态：只发列表变更信号，不发 session_ended（design A5）。
            await publish_sessions_changed("status_changed", row.id, row.user_id)
    return converged


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


# ── lease 过期 GC（2026-08-29-daemon-platform-resilience task-03 / design A4）──

# lease 过期巡检周期（design A4 定 60s）。与 SWEEP_INTERVAL_SEC 同值但独立常量：
# 两个巡检语义独立，互不牵连（对齐 RECONNECTING_RETRY_WINDOW_SEC 常量唯一落点
# 的做法，不引入 Settings 开关——巡检常开，constraints 定案）。
LEASE_SWEEP_INTERVAL_SEC = 60

# 启动重唤醒单批上限（一次性查询用 limit，防 backend 宕机积压的 pending lease
# 全表捞；超出部分由 lease_expiry_sweeper 的 expire→rollback 路径与 daemon
# 心跳轮询兜底，无需单轮全量）。对齐 expire_leases 的 limit(200) 批处理先例。
WAKEUP_PENDING_LEASES_LIMIT = 200


async def lease_expiry_sweep_once(session: AsyncSession) -> int:
    """lease 过期 GC 单拍：过期标记 + 回滚/failed + terminating 告警（返回处理数）.

    接线（task-03 constraints：三函数只调用不改语义）：

    1. ``DaemonService(session).handle_expired_leases_batch()``——lease/service.py
       的批处理入口，**内部首步即调用 ``expire_leases``**（FOR UPDATE + limit(200)
       把 claimed/pending 且 ``lease_expires_at`` 过期的行标 ``expired``），随后逐
       lease 走 ``handle_lease_expiry``：attempt<3 → run 翻 ``pending`` + 新
       pending lease（attempt+1）+ WS 唤醒重派；attempt≥3 → run ``failed``。
       经 facade 构造（而非直接 ``LeaseService(session)``）是因为
       ``handle_lease_expiry`` 内部经 ``self._facade._publish_run_event`` 发
       Redis 事件——facade 注入缺失时该调用抛 AttributeError 会被 batch 的
       per-lease ``except Exception`` 吞掉，重派后的 WS 唤醒随之丢失。
       注意：**不**在 batch 之外再单独调用 ``expire_leases``——单独先调会把行
       先标 expired，batch 内部的 expire 查询 0 命中、回滚逻辑永不触发；
    2. ``DaemonLeaseService(session).alert_stuck_terminating_leases()``——
       独立观测告警（不改 status、不重试，D-007 方案 C），仅记日志。
    """
    # lazy import：daemon.service / lease_service 顶层引用庞大（facade 聚合五
    # 子域），照 main.py lifespan 内 lazy import 先例，避免模块级重依赖。
    from app.modules.daemon.lease_service import DaemonLeaseService
    from app.modules.daemon.service import DaemonService

    processed = await DaemonService(session).handle_expired_leases_batch()

    stuck_ids = await DaemonLeaseService(session).alert_stuck_terminating_leases()
    if stuck_ids:
        log.warning(
            "lease_terminating_stuck_detected",
            count=len(stuck_ids),
            lease_ids=[str(i) for i in stuck_ids],
        )
    return processed


async def wake_pending_leases_for_online_daemons_once(
    session: AsyncSession, *, limit: int = WAKEUP_PENDING_LEASES_LIMIT
) -> int:
    """backend 重启恢复：对在线 daemon 名下的 pending batch lease 重发 WS 唤醒.

    背景（design A4）：pending batch lease 的派发通知是 WS 单发唤醒，backend
    宕机期间该单发丢失后 lease 只能等 daemon 下一轮轮询/心跳才被 claim。本函数
    在 lifespan 启动时一次性补救：只针对「DB status=online 的 daemon runtime」
    名下的 pending batch lease（interactive lease 绑 session 不绑 run，agent_run_id
    恒 NULL，由会话链路自愈，不在本档）；不在线 daemon 不重发（发了也无人接）。

    唤醒经 ``RunPlacementService._send_ws_wakeup``（复用不修改）：按
    ``daemon_instance_id``（WS 连接键）路由 + ``payload_runtime_id`` 指明
    provider runtime，连接缺失时自带全连接广播兜底。重发幂等（task-03
    acceptance）：WS 唤醒是「请 daemon 来轮询」的触发信号，daemon claim
    幂等 + ws_hub 唤醒去重滑窗，重复重启不产生重复副作用；本函数纯读 + 发
    消息，不动任何 DB 行。

    Returns:
        成功发出唤醒的 lease 数（连接全无时 _send_ws_wakeup 内部记日志跳过，
        也计入返回——信号已尽力投递；单条发送异常逐条吞掉不中断其余）。
    """
    from app.modules.agent.placement import RunPlacementService

    rows = (
        await session.execute(
            select(
                DaemonTaskLease.id.label("lease_id"),
                DaemonTaskLease.agent_run_id.label("agent_run_id"),
                DaemonTaskLease.runtime_id.label("runtime_id"),
                DaemonRuntime.daemon_instance_id.label("daemon_instance_id"),
            )
            .join(DaemonRuntime, DaemonTaskLease.runtime_id == DaemonRuntime.id)
            .where(
                DaemonTaskLease.status == "pending",
                DaemonTaskLease.kind == "batch",
                col(DaemonTaskLease.agent_run_id).is_not(None),
                col(DaemonRuntime.status) == "online",
            )
            .limit(limit)
        )
    ).all()

    if not rows:
        return 0

    placement = RunPlacementService(session)
    woken = 0
    for row in rows:
        # 旧 runtime 行 daemon_instance_id 可空（迁移期过渡列）——无 WS 路由键
        # 只能跳过，交 lease_expiry_sweeper 过期重派路径收敛。
        if row.daemon_instance_id is None:
            log.info(
                "startup_wakeup_skip_no_instance",
                lease_id=str(row.lease_id),
                runtime_id=str(row.runtime_id),
            )
            continue
        try:
            await placement._send_ws_wakeup(
                row.daemon_instance_id,
                row.lease_id,
                row.agent_run_id,
                payload_runtime_id=row.runtime_id,
            )
            woken += 1
        except Exception:
            log.exception(
                "startup_wakeup_send_failed",
                lease_id=str(row.lease_id),
                daemon_instance_id=str(row.daemon_instance_id),
            )
    if woken:
        log.info("startup_wakeup_sent", count=woken, candidates=len(rows))
    return woken


async def lease_expiry_sweeper(interval: float = LEASE_SWEEP_INTERVAL_SEC) -> None:
    """lease 过期 GC 常驻循环（main.py lifespan ``create_task`` 消费）.

    模式与关停契约逐字对齐 :func:`session_reconnect_sweeper`：每轮经
    ``get_session_factory()`` 开短 session 调 :func:`lease_expiry_sweep_once`，
    轮间不占连接池；单轮异常 ``except Exception`` 只 ``log.exception`` 吞掉、
    不崩循环；``asyncio.sleep(interval)`` 处 ``CancelledError`` 透传，关停由
    调用方 ``task.cancel()`` + ``await asyncio.gather(task,
    return_exceptions=True)`` 落地（巡检轮内有 DB 写，须等取消落地）。
    """
    while True:
        try:
            async with get_session_factory()() as db_session:
                processed = await lease_expiry_sweep_once(db_session)
            if processed:
                log.warning("lease_expiry_sweep_processed", count=processed)
        except Exception:
            log.exception("lease_expiry_sweep_round_failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
