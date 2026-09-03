"""ControlCommandService — 控制指令可靠投递落库与状态机收敛（design A2）.

2026-08-29-daemon-platform-resilience task-01 / D-004@v1 / D-006@v1：下发方
（session service inject/interrupt/end/resume、permission_service 审批结果与
超时 deny、provider_switch）统一经 :meth:`ControlCommandService.enqueue` 落库
``daemon_control_commands``（status=pending）后走 WS 推送；推送成功
``mark_delivered``，失败/不在线保持 pending，由 daemon 重连补拉
（``fetch_pending`` **仅返回 pending，delivered 一律不重发**——D-006 零重复
执行优先，inject 重复执行会向 agent 双发 prompt）后 ``ack`` 回执。
``gc`` 三路收敛（pending 过期 / delivered 未 ack 超时 / acked 超龄删除）。

task-04 在 task-01 服务之上交付下发编排与 GC 接线：

- :meth:`ControlCommandService.enqueue_and_push`——三段式下发编排（enqueue 落
  pending → ws_hub 现有消息形状推送（payload 注入 ``command_id``）→ 成功
  ``mark_delivered``，失败/不在线保持 pending 待补拉），供六类指令下发方调用；
- ``gc`` 增加 inject 类过期联动（design A2 / D-007@v1 两条过期路径）：pending
  过期与 delivered-未-ack 过期的 ``session_inject`` 行同步把对应 pending/running
  run 幂等标 ``failed``（error_code 复用 session/service.py 既有
  :data:`INJECT_SEND_FAILED_ERROR_CODE` 先例），不留 600s offline sweep 兜底；
- :func:`control_command_gc_sweeper`——独立 60s 常驻 GC 节拍（挂载理由见其
  docstring），单拍 ``gc`` 直调可测。
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, NamedTuple

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonControlCommand
from app.modules.daemon.protocol import (
    DAEMON_MSG_PERMISSION_RESPONSE,
    DAEMON_MSG_PROVIDER_CONFIG_CHANGED,
    DAEMON_MSG_SESSION_END,
    DAEMON_MSG_SESSION_INJECT,
    DAEMON_MSG_SESSION_INTERRUPT,
    DAEMON_MSG_SESSION_RESUME,
)

if TYPE_CHECKING:
    from app.modules.daemon.ws_hub import DaemonWsHub

log = get_logger(__name__)

# ── kind 词表（design A2；enqueue 缺省 expires_at 亦按 kind 取值）──────────
KIND_SESSION_INJECT = "session_inject"
KIND_SESSION_INTERRUPT = "session_interrupt"
KIND_SESSION_END = "session_end"
KIND_SESSION_RESUME = "session_resume"
KIND_PERMISSION_RESPONSE = "permission_response"
KIND_PROVIDER_CONFIG_CHANGED = "provider_config_changed"

# ── status 词表（与 model.py DaemonControlCommand.status 注释一致）──────────
STATUS_PENDING = "pending"
STATUS_DELIVERED = "delivered"
STATUS_ACKED = "acked"
STATUS_EXPIRED = "expired"
# ql-20260903-016：派发失败收链终态——调用方已把本轮判死（run failed + 504）
# 时取消 pending 指令，daemon 重连补拉不再取到（免消息「复活」/重复执行）。
STATUS_CANCELLED = "cancelled"

# enqueue 未显式给 expires_at 时按 kind 的缺省 TTL（秒）：inject 10min（与
# inject 过期联动 run→failed 的 10min 窗口对齐）、permission_response 6min
# （对齐 5min 审批超时+余量）；其余 kind 走 DEFAULT_EXPIRE_TTL_SECONDS 30min。
EXPIRE_TTL_SECONDS: dict[str, int] = {
    KIND_SESSION_INJECT: 10 * 60,
    KIND_PERMISSION_RESPONSE: 6 * 60,
}
DEFAULT_EXPIRE_TTL_SECONDS: int = 30 * 60

# GC 路径 2：delivered 未 ack 超过该时长 → expired（daemon 收到即崩溃的场景，
# 由会话恢复链路收敛，不追求重发——design A2）。
DELIVERED_ACK_GRACE_SECONDS: int = 10 * 60

# GC 路径 3：acked 保留时长，超龄 DELETE（回执留观测窗口后物理清理）。
ACK_RETENTION_SECONDS: int = 60 * 60

# ── task-04：下发编排词表 ─────────────────────────────────────────────────────

# kind → WS 消息 type（protocol.py 常量族）。enqueue_and_push 据此走对应
# ws_hub send_*：permission_response 走 send_permission_response（专用信封），
# 其余走 send_session_control(msg_type, payload)——与各下发点改造前逐字同形状。
KIND_MSG_TYPE: dict[str, str] = {
    KIND_SESSION_INJECT: DAEMON_MSG_SESSION_INJECT,
    KIND_SESSION_INTERRUPT: DAEMON_MSG_SESSION_INTERRUPT,
    KIND_SESSION_END: DAEMON_MSG_SESSION_END,
    KIND_SESSION_RESUME: DAEMON_MSG_SESSION_RESUME,
    KIND_PERMISSION_RESPONSE: DAEMON_MSG_PERMISSION_RESPONSE,
    KIND_PROVIDER_CONFIG_CHANGED: DAEMON_MSG_PROVIDER_CONFIG_CHANGED,
}

# inject 过期联动 run 收敛的错误码——沿用 session/service.py inject 派发失败
# 收敛（原内联字面量，本常量为唯一落点）与 GC 联动同一取值。
INJECT_SEND_FAILED_ERROR_CODE = "interactive_inject_send_failed"

# inject 过期联动收敛的 run 状态档：pending（派发后 daemon 未启动，daemon
# 长期不回来）与 running（delivered 后 daemon 收到即崩溃，10min 未 ack）。
# pending_approval 排除——审批挂起说明 daemon 活着在跑本轮，不该被指令过期
# 收敛（对齐 sweep.py run 收敛档（"pending","running"）先例）。
_INJECT_LINK_RUN_STATUSES: tuple[str, ...] = ("pending", "running")

# 控制指令 GC 独立巡检周期（秒）。挂载形态二选一（task-04）：并入
# lease_expiry_sweeper 每轮需改 sweep.py（task-04 constraints 明令禁改），
# 故取独立小节拍常驻协程 control_command_gc_sweeper，60s 与模块内其它巡检
# （SWEEP_INTERVAL_SEC / LEASE_SWEEP_INTERVAL_SEC）同档；两类 GC 语义正交
# （投递层 vs 任务层），独立节拍互不连坐失败域。
CONTROL_GC_INTERVAL_SEC = 60


class ControlCommandGcResult(NamedTuple):
    """gc 单轮收敛计数（观测/日志用）。

    ``runs_failed`` 为 task-04 inject 过期联动新增（缺省 0，向后兼容既有
    按 ``expired`` / ``deleted`` 断言的调用方与测试）。
    """

    expired: int
    deleted: int
    runs_failed: int = 0


class ControlCommandService:
    """控制指令（``daemon_control_commands``）落库与状态机服务。

    会话注入风格与模块内其它 service 一致（请求内实例化、AsyncSession 经
    ``__init__`` 注入，如 :class:`~app.modules.daemon.lease_service.DaemonLeaseService`）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def enqueue(
        self,
        runtime_id: uuid.UUID,
        kind: str,
        payload: dict[str, Any] | None = None,
        expires_at: datetime | None = None,
        *,
        command_id: uuid.UUID | None = None,
    ) -> DaemonControlCommand:
        """入队一条控制指令（INSERT status=pending），返回落库行。

        ``expires_at`` 缺省按 kind 计算（``EXPIRE_TTL_SECONDS`` / 30min 兜底），
        显式传入则原样落库。``command_id``（task-04）供 ``enqueue_and_push``
        预生成幂等键（payload 注入的 ``command_id`` 字段与行主键必须同值），
        缺省 uuid4。
        """
        now = datetime.now(UTC)
        if expires_at is None:
            ttl = EXPIRE_TTL_SECONDS.get(kind, DEFAULT_EXPIRE_TTL_SECONDS)
            expires_at = now + timedelta(seconds=ttl)
        row = DaemonControlCommand(
            id=command_id or uuid.uuid4(),
            runtime_id=runtime_id,
            kind=kind,
            payload=payload,
            status=STATUS_PENDING,
            created_at=now,
            expires_at=expires_at,
        )
        self._session.add(row)
        await self._session.commit()
        log.info(
            "control_command_enqueued",
            command_id=str(row.id),
            runtime_id=str(runtime_id),
            kind=kind,
            expires_at=str(expires_at),
        )
        return row

    async def enqueue_and_push(
        self,
        *,
        daemon_id: uuid.UUID,
        runtime_id: uuid.UUID,
        kind: str,
        payload: dict[str, Any] | None = None,
        hub: DaemonWsHub | None = None,
    ) -> tuple[DaemonControlCommand, bool]:
        """三段式下发编排（design A2 / task-04）：落库 pending → WS 推送 → 标 delivered。

        1. 预生成 ``command_id`` 并注入 payload 尾部（dict 追加不改既有键序，旧
           daemon 忽略未知键，WS 消息形状与其余字段逐字节兼容——constraints），
           ``enqueue`` 落 pending 行（自带 commit）；
        2. 经 ws_hub 对应 send_* 按现有消息形状推送（``daemon_id`` 为路由键）；
        3. send 成功 → ``mark_delivered``；失败 / 不在线 / 推送异常 → 保持
           pending 等待 daemon 重连补拉（本方法**不抛错**——各调用点的既有
           对外语义（inject 推送失败标 run failed + 504、end best-effort 仅
           告警等）由调用方按返回的 delivered bool 自行收敛，task-04 定案）。

        Args:
            daemon_id: WS 路由键（daemon_instance_id，迁移期回退 runtime_id）。
            runtime_id: 指令归属 runtime（表 FK + payload 内 provider 判别键）。
            kind: 六类词表之一（``KIND_MSG_TYPE`` 决定 ws_hub send_* 与消息 type）。
            payload: 与现有 WS 消息 payload 同构（不含 command_id，本方法注入）。
            hub: 显式注入的 ws_hub（permission_service ``__init__`` 已持实例的
                先例；测试注入 fake）。缺省取 ``get_daemon_ws_hub()`` 单例。

        Returns:
            ``(落库行, delivered)``——delivered=False 表示消息已落库待补拉。
        """
        command_id = uuid.uuid4()
        enriched = {**(payload or {}), "command_id": str(command_id)}
        row = await self.enqueue(runtime_id, kind, enriched, command_id=command_id)

        delivered = False
        try:
            delivered = await self._push_via_hub(daemon_id, kind, enriched, hub=hub)
        except Exception:
            # 推送异常（ws_hub send_* 内部已兜 send 失败返 False，这里防的是
            # 罕见的路由层异常）与失败同待遇：保持 pending，不改变调用方语义。
            log.warning(
                "control_command_push_error",
                command_id=str(command_id),
                daemon_id=str(daemon_id),
                runtime_id=str(runtime_id),
                kind=kind,
                exc_info=True,
            )
            delivered = False

        if delivered:
            await self.mark_delivered([command_id])
            # bulk update 不经 identity map；同步返回对象属性便于调用方观测。
            row.status = STATUS_DELIVERED
            row.delivered_at = datetime.now(UTC)
        else:
            log.info(
                "control_command_kept_pending_for_pull",
                command_id=str(command_id),
                daemon_id=str(daemon_id),
                runtime_id=str(runtime_id),
                kind=kind,
            )
        return row, delivered

    async def _push_via_hub(
        self,
        daemon_id: uuid.UUID,
        kind: str,
        payload: dict[str, Any],
        *,
        hub: DaemonWsHub | None = None,
    ) -> bool:
        """按 kind 走 ws_hub 对应 send_*（消息形状与改造前逐字一致）。"""
        # lazy import：对齐模块内 cross-domain lazy 范式（session/service.py 的
        # get_daemon_ws_hub 函数级 import 先例），避免 ws_hub → facade 反向环。
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        msg_type = KIND_MSG_TYPE.get(kind)
        if msg_type is None:
            raise ValueError(f"unknown control command kind: {kind!r}")
        if hub is None:
            hub = get_daemon_ws_hub()
        if kind == KIND_PERMISSION_RESPONSE:
            # 专用信封（daemon:permission_response），与改造前 permission_service
            # 直调 send_permission_response 同一入口。
            return await hub.send_permission_response(daemon_id, payload)
        return await hub.send_session_control(daemon_id, msg_type, payload)

    async def mark_delivered(self, command_ids: Sequence[uuid.UUID]) -> int:
        """WS 推送成功后批量标 delivered（仅 pending 行，幂等）。

        限制 ``status=pending``：已 acked/expired 的行不回退（状态机单向）。
        返回实际翻转行数。
        """
        if not command_ids:
            return 0
        stmt = (
            update(DaemonControlCommand)
            .where(
                col(DaemonControlCommand.id).in_(list(command_ids)),
                col(DaemonControlCommand.status) == STATUS_PENDING,
            )
            .values(
                status=STATUS_DELIVERED,
                delivered_at=datetime.now(UTC),
            )
        )
        result = await self._session.execute(stmt)
        await self._session.commit()
        return int(result.rowcount or 0)

    async def cancel_pending(self, command_id: uuid.UUID) -> bool:
        """取消仍在 pending 的指令（pending → cancelled，幂等，非 pending 跳过）。

        ql-20260903-016：inject / interrupt 推送失败且调用方已决定本轮失败
        （run 收敛 failed + 504）时，pending 行若保留，daemon 在 TTL 内重连补拉
        会照常执行——界面已报「未能发送」，消息却「复活」；用户按提示重发后
        同一条消息执行两遍。cancelled 为终态：fetch_pending 不再取到，GC 按
        acked 同款保留期物理清理。返回是否实际翻转。
        """
        stmt = (
            update(DaemonControlCommand)
            .where(
                col(DaemonControlCommand.id) == command_id,
                col(DaemonControlCommand.status) == STATUS_PENDING,
            )
            .values(status=STATUS_CANCELLED)
        )
        result = await self._session.execute(stmt)
        await self._session.commit()
        return int(result.rowcount or 0) > 0

    async def fetch_pending(self, runtime_id: uuid.UUID) -> list[DaemonControlCommand]:
        """补拉待发指令：仅 ``status=pending``，``created_at`` 升序（FIFO）。

        **delivered 一律不重发**（D-006）：推送成功的指令不再出现在补拉结果里。
        """
        stmt = (
            select(DaemonControlCommand)
            .where(
                col(DaemonControlCommand.runtime_id) == runtime_id,
                col(DaemonControlCommand.status) == STATUS_PENDING,
            )
            .order_by(col(DaemonControlCommand.created_at).asc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def ack(
        self,
        command_ids: Sequence[uuid.UUID],
        *,
        runtime_id: uuid.UUID | None = None,
    ) -> int:
        """daemon 消费回执：pending|delivered → acked（幂等，已终态跳过）。

        消费失败的业务错误同样 ack（避免毒丸指令无限重投，design A2）；
        过期/已回执行不再翻转。``runtime_id``（task-04）非空时把翻转范围
        限定在该 runtime 名下（ack 端点归属校验后的越权防线：daemon 无法
        ack 他人 runtime 的指令，未命中行静默跳过）。返回实际翻转行数。
        """
        if not command_ids:
            return 0
        conditions = [
            col(DaemonControlCommand.id).in_(list(command_ids)),
            col(DaemonControlCommand.status).in_([STATUS_PENDING, STATUS_DELIVERED]),
        ]
        if runtime_id is not None:
            conditions.append(col(DaemonControlCommand.runtime_id) == runtime_id)
        stmt = (
            update(DaemonControlCommand)
            .where(*conditions)
            .values(
                status=STATUS_ACKED,
                ack_at=datetime.now(UTC),
            )
        )
        result = await self._session.execute(stmt)
        await self._session.commit()
        return int(result.rowcount or 0)

    async def gc(self, now: datetime) -> ControlCommandGcResult:
        """GC 三路收敛 + inject 过期联动（design A2 / task-04 / D-007@v1）。

        1. pending 且 ``expires_at < now`` → expired；
        2. delivered 且 ``delivered_at < now - 10min`` → expired；
        3. acked 且 ``ack_at < now - 1h`` → DELETE（超龄回执物理清理）；
           cancelled 且 ``created_at < now - 1h`` → DELETE（ql-20260903-016：
           派发失败收链的终态行同款保留期清理，免永久堆积）。

        inject 联动（两条过期路径同样处理，X-15/D-007@v1）：路径 1/2 翻转
        expired 的 ``session_inject`` 行按 ``payload.run_id`` 把对应
        pending/running run 幂等标 ``failed``（error_code=
        :data:`INJECT_SEND_FAILED_ERROR_CODE`，条件 UPDATE 重复轮 0 命中），
        覆盖「daemon 长期不回来时用户发消息」的终态收敛，不留 600s sweep 兜底。

        竞态安全：联动候选先 SELECT（含 kind/payload），UPDATE 重挂同条件
        翻转；联动前复查 ``status='expired'`` ——SELECT 与 UPDATE 之间被并发
        ack/mark_delivered 的行不再 expired，不误伤其 run。

        Returns:
            ``(expired, deleted, runs_failed)`` 计数。
        """
        expired = 0
        delivered_threshold = now - timedelta(seconds=DELIVERED_ACK_GRACE_SECONDS)

        # 联动候选预取（仅路径 1/2 覆盖的 pending/delivered 行；终态行天然排除）。
        candidate_rows = (
            await self._session.execute(
                select(DaemonControlCommand.id, DaemonControlCommand.kind).where(
                    col(DaemonControlCommand.status) == STATUS_PENDING,
                    col(DaemonControlCommand.expires_at).is_not(None),
                    col(DaemonControlCommand.expires_at) < now,
                )
            )
        ).all() + (
            await self._session.execute(
                select(DaemonControlCommand.id, DaemonControlCommand.kind).where(
                    col(DaemonControlCommand.status) == STATUS_DELIVERED,
                    col(DaemonControlCommand.delivered_at).is_not(None),
                    col(DaemonControlCommand.delivered_at) < delivered_threshold,
                )
            )
        ).all()

        stmt_pending_expire = (
            update(DaemonControlCommand)
            .where(
                col(DaemonControlCommand.status) == STATUS_PENDING,
                col(DaemonControlCommand.expires_at).is_not(None),
                col(DaemonControlCommand.expires_at) < now,
            )
            .values(status=STATUS_EXPIRED)
        )
        result = await self._session.execute(stmt_pending_expire)
        expired += int(result.rowcount or 0)

        stmt_delivered_expire = (
            update(DaemonControlCommand)
            .where(
                col(DaemonControlCommand.status) == STATUS_DELIVERED,
                col(DaemonControlCommand.delivered_at).is_not(None),
                col(DaemonControlCommand.delivered_at) < delivered_threshold,
            )
            .values(status=STATUS_EXPIRED)
        )
        result = await self._session.execute(stmt_delivered_expire)
        expired += int(result.rowcount or 0)

        ack_threshold = now - timedelta(seconds=ACK_RETENTION_SECONDS)
        stmt_ack_purge = delete(DaemonControlCommand).where(
            col(DaemonControlCommand.status) == STATUS_ACKED,
            col(DaemonControlCommand.ack_at).is_not(None),
            col(DaemonControlCommand.ack_at) < ack_threshold,
        )
        result = await self._session.execute(stmt_ack_purge)
        deleted = int(result.rowcount or 0)
        # ql-20260903-016：cancelled 终态行同款保留期物理清理（按 created_at，
        # 该状态无 ack_at/delivered_at 可用）。
        stmt_cancelled_purge = delete(DaemonControlCommand).where(
            col(DaemonControlCommand.status) == STATUS_CANCELLED,
            col(DaemonControlCommand.created_at) < ack_threshold,
        )
        result = await self._session.execute(stmt_cancelled_purge)
        deleted += int(result.rowcount or 0)

        # ── inject 过期联动：仅「本轮确实翻成 expired」的候选行参与 ──────────
        runs_failed = 0
        candidate_ids = [row.id for row in candidate_rows]
        if candidate_ids:
            linkable = (
                await self._session.execute(
                    select(
                        DaemonControlCommand.payload,
                        DaemonControlCommand.delivered_at,
                    ).where(
                        col(DaemonControlCommand.id).in_(candidate_ids),
                        col(DaemonControlCommand.status) == STATUS_EXPIRED,
                        col(DaemonControlCommand.kind) == KIND_SESSION_INJECT,
                    )
                )
            ).all()
            # ql-20260831-004：联动判失败同时把可读原因写进 output_redacted
            # （经 SessionRunRead.failure_summary 透出到前端错误卡），并按
            # delivered_at 分桶区分两种语义：投不出去（daemon 离线/断连）vs
            # 投出去了没执行（无回执，daemon 侧静默丢弃）。
            delivered_run_ids: list[uuid.UUID] = []
            undelivered_run_ids: list[uuid.UUID] = []
            for payload, delivered_at in linkable:
                raw = (payload or {}).get("run_id")
                try:
                    run_id = uuid.UUID(str(raw))
                except (ValueError, TypeError):
                    # 非 uuid run_id（防御：payload 手工造数/旧形状缺键）——跳过
                    # 联动，指令过期本身不受影响。
                    log.warning(
                        "control_command_gc_invalid_run_id",
                        run_id=repr(raw),
                    )
                    continue
                (delivered_run_ids if delivered_at else undelivered_run_ids).append(run_id)
            now_run = datetime.now(UTC)
            for run_id_bucket, reason in (
                (
                    undelivered_run_ids,
                    "消息指令 10 分钟内未能送达执行端（daemon 离线或连接中断），"
                    "本轮自动失败；确认该机器 daemon 在线后重试即可",
                ),
                (
                    delivered_run_ids,
                    "消息指令已送达执行端但 10 分钟内未被执行（无回执），"
                    "本轮自动失败；请检查该机器 daemon 状态后重试",
                ),
            ):
                if not run_id_bucket:
                    continue
                result = await self._session.execute(
                    update(AgentRun)
                    .where(
                        AgentRun.id.in_(run_id_bucket),
                        AgentRun.status.in_(_INJECT_LINK_RUN_STATUSES),
                    )
                    .values(
                        status="failed",
                        finished_at=now_run,
                        error_code=INJECT_SEND_FAILED_ERROR_CODE,
                        output_redacted=reason,
                    )
                )
                runs_failed += int(result.rowcount or 0)

        await self._session.commit()
        if expired or deleted or runs_failed:
            log.info(
                "control_command_gc",
                expired=expired,
                deleted=deleted,
                runs_failed=runs_failed,
            )
        return ControlCommandGcResult(expired=expired, deleted=deleted, runs_failed=runs_failed)


# ── 常驻 GC 节拍（task-04 / design A2 + A4）──────────────────────────────────


async def control_command_gc_sweeper(interval: float = CONTROL_GC_INTERVAL_SEC) -> None:
    """控制指令 GC 常驻循环（lifespan ``create_task`` 消费）。

    挂载形态裁定（task-04 constraints「不改 sweep.py 与 main.py」×「挂载
    task-03 常驻 sweeper」二选一）：并入 ``lease_expiry_sweeper`` 每轮需编辑
    sweep.py——本卡禁改；故取独立小节拍常驻协程，模式与关停契约逐字对齐
    ``lease_expiry_sweeper``（每轮经 ``get_session_factory()`` 开短 session、
    单轮异常 ``log.exception`` 吞掉不崩循环、``asyncio.sleep`` 处
    ``CancelledError`` 透传，调用方 ``task.cancel()`` + ``gather`` 落地）。
    60s 节拍与 lease/session 巡检同档；控制指令过期窗（10min/6min/30min）
    对 60s 粒度不敏感。两类 GC 语义正交（投递层 vs 任务层 lease），独立循环
    互不连坐失败域。lifespan 的 create_task 挂载行归后续持有 main.py 的任务
    补线（见任务卡 constraints）。
    """
    while True:
        try:
            async with get_session_factory()() as db_session:
                result = await ControlCommandService(db_session).gc(datetime.now(UTC))
            if result.expired or result.deleted or result.runs_failed:
                log.warning(
                    "control_command_gc_sweep_converged",
                    expired=result.expired,
                    deleted=result.deleted,
                    runs_failed=result.runs_failed,
                )
        except Exception:
            log.exception("control_command_gc_sweep_round_failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
