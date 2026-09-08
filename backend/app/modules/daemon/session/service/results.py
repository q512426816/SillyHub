"""session 子域结果对象 + readiness 单例（task-08 拆分，原 :738-952 纯搬移）。

``get_session_readiness`` 定义落位于此，包 ``__init__`` 重导出同名绑定；
子模块内调用点一律经 ``_svc.get_session_readiness()`` 延迟解析（D-007——
conftest / test_session_readiness 等以 patch / 别名 setattr 形态替换本命名
空间属性，子模块直接 from-import 会使 patch 拦截失效）。
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Literal

from app.modules.agent.model import AgentRun, AgentSession


@dataclass(frozen=True, slots=True)
class SessionDispatchResult:
    """Result of create_session / inject_session (D-005@v1 triple).

    ql-20260825-011（后端真实排队）：忙轮入队路径没有新 run——``queued=True``
    时 ``agent_run`` / ``queue_entry_id`` 二选一有值（入队成功 → 只有
    ``queue_entry_id``）。create_session / 空闲 inject 路径 ``queued`` 恒
    False，三字段语义与既有完全一致（零回归）。

    quick（2026-09-02 群聊忙轮注入）：``mid_turn=True`` 表示消息经
    busy_strategy="inject" 注入了**当前活跃轮**（steering）——``agent_run``
    为该活跃 run（非新建，单会话单活跃 run 不变式保持），本轮 user_input
    留痕日志挂同一 run。其余路径缺省 False。
    """

    agent_session: AgentSession
    agent_run: AgentRun | None = None
    lease_id: uuid.UUID | None = None
    queued: bool = False
    queue_entry_id: uuid.UUID | None = None
    mid_turn: bool = False


@dataclass(frozen=True, slots=True)
class SessionControlResult:
    """Result of interrupt_session / end_session.

    ``current_run_id`` is the run targeted by the control message (the unique
    currentRun), or None when end_session ran on a session without an active
    turn.
    """

    agent_session: AgentSession
    current_run_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class SessionRecoveryResult:
    """Result of recover_session_after_daemon_restart (task-10, FR-08).

    ``status`` is the post-recover session state as seen by backend:
      - ``reconnecting``: recover succeeded, currentRun converged; daemon now
        runs restoreAndReconnect (query resume) and will confirm_reconnected.
      - ``ended``/``failed``: session was already terminal (not resurrected).
      - ``rejected``: ownership mismatch (runtime/lease/provider/lease kind);
        daemon must delete its local record and not call restoreAndReconnect.

    ``interrupted_run_status`` reports the converged run result (``failed``)
    when a crashed currentRun was reconciled; ``None`` when the session was
    idle (no running run) or already terminal.
    """

    session_id: uuid.UUID
    lease_id: uuid.UUID | None
    status: Literal["active", "ended", "failed", "reconnecting", "rejected"]
    interrupted_run_status: Literal["failed"] | None = None


@dataclass(frozen=True, slots=True)
class SuspendBatchResult:
    """Result of suspend_sessions_for_daemon（task-05 provides 契约）.

    ``suspended`` = 实际翻 suspended 的**主会话**（``parent_session_id`` IS NULL）
    行数（条件 UPDATE 命中数——重复调用对已挂起/终态会话 no-op 计 0）；
    ``runs_failed`` = 同批收敛 failed 的活跃轮 run 行数（主会话 error_code=
    daemon_stopped + worker error_code=daemon_interrupted 合计）。

    2026-08-29-batch-session-inherit task-01 追加：``workers`` = 同批按
    ``parent_session_id`` 分流改判 ``failed``（error_code=daemon_interrupted）的
    worker 子会话 ``(session_id, runtime_id)`` 列表——重派种子，供 task-02 异步
    重派消费（runtime_id 为派发路由键）；**仅内部消费**，router 响应 DTO
    （SuspendBatchResponse）只读 suspended / runs_failed 两键，响应契约零变化。
    """

    suspended: int
    runs_failed: int
    workers: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _PrelockedInjectAttachments:
    """P1（2026-08-25 会话路径二审 #1）：取锁前预组装的附件载荷快照。

    ``rows`` = 已过引擎/归属/数量校验的 SessionAttachment 行（保留入参顺序）；
    ``inject_attachments`` = SESSION_INJECT payload 的 attachments 列表（MinIO
    组装产物）；``gate_*`` = 预组装时的多模态 gate 快照——锁内复核「预读与取锁
    之间会话供应商/引擎是否漂移」用，漂移且 supports 翻转才在锁内重组装。
    """

    rows: list
    inject_attachments: list[dict]
    gate_supports_multimodal: bool
    gate_provider_id_basis: uuid.UUID | None
    agent_kind: str


@dataclass(frozen=True, slots=True)
class _PreparedPpmAttachment:
    """task-03（2026-08-28-session-ppm-task-binding / FR-03 / D-006）：PPM 附件
    物化的写事务外预备产物。

    ``_materialize_ppm_attachments`` 在写事务外完成 storage 读 IO、``_can_access``
    与降级决策，并把对象写入 session attachment storage（``store_bytes`` 内容
    寻址）；本结构承载落 ``SessionAttachment`` 行所需的列值——行 insert 归
    create_session 写事务内（session.id 已知后）flush-only 完成。
    """

    kind: str
    media_type: str
    bytes: int
    name: str
    object_key: str
    sha256: str


class SessionReadiness:
    """跨请求共享的内存 session ready 状态管理器（task-05 / D-002@v1）。

    daemon 在 create 完成（fresh / recover）后调 :meth:`mark_ready`；
    ``inject_session`` 在 send SESSION_INJECT 前调 :meth:`wait` 阻塞等 ready
    event；session end/failed 后调 :meth:`clear` 清状态。

    **必须模块级单例**（gap-2 / D-002）：``SessionService`` /
    ``DaemonService`` 在 ``router.py`` 是 per-request 实例化，若把 readiness
    放 Service 实例字段，``mark_ready`` 与 ``wait`` 会各看各的
    ``_ready`` / ``_events``（不同实例），事件永远等不到 set。模块级单例
    保证跨请求共享同一份 set + event dict。

    ``asyncio.Event`` 必须在 event loop 内 ``await``：所有调用方
    （handler / inject_session / confirm_session_reconnected）均在
    ``async def`` 内执行，loop 上下文就绪。
    """

    def __init__(self) -> None:
        self._ready: set[uuid.UUID] = set()
        self._events: dict[uuid.UUID, asyncio.Event] = {}

    def _get_or_create_event(self, session_id: uuid.UUID) -> asyncio.Event:
        """取或建 per-session event（懒建）。"""
        event = self._events.get(session_id)
        if event is None:
            event = asyncio.Event()
            self._events[session_id] = event
        return event

    def mark_ready(self, session_id: uuid.UUID) -> None:
        """标记 session ready 并唤醒所有等待该 session 的 wait 协程。幂等。

        重复 mark 同一 session 不报错（set.add 幂等、event.set 幂等）。
        P2（2026-08-25 会话审查）：set 完成后把 ``_events`` 键 pop 掉——已拿到
        Event 引用的等待者不受影响（其 ``wait`` 已被 set 唤醒 / 立即通过），
        新到的 ``wait`` 走 ``_ready`` 快速路径；键不残留，dict 规模以并发
        等待者为上界（原实现每个 mark 过的 session 永占一个槽位，无界增长）。
        """
        self._ready.add(session_id)
        event = self._get_or_create_event(session_id)
        event.set()
        self._events.pop(session_id, None)

    async def wait(self, session_id: uuid.UUID, timeout: float = 8) -> bool:
        """阻塞等 session ready event。

        - 已 ready（``session_id`` ∈ :attr:`_ready`）立即返 ``True``（零开销）。
        - 未 ready → ``asyncio.wait_for`` 包 ``event.wait()``，被 mark_ready
          唤醒后返 ``True``；超时返 ``False``（**不抛** ``TimeoutError``）。

        Args:
            session_id: AgentSession id。
            timeout: 超时秒数，默认 8s（ql-20260814-008：正常 daemon /ready
                上报 ~1s 内到；原 30s 会让 HTTP 请求先被 Next.js 代理 ~30s
                掐断，用户看到 500。8s 覆盖正常波动，超时仍 fallback 发
                SESSION_INJECT，兼容旧 daemon 不上报 ready（D-003 / R-02）。

        Returns:
            ``True`` = ready（被 mark 或已 ready）；``False`` = 超时。
        """
        # 已 ready 快速路径：不进入 wait_for，零开销。
        if session_id in self._ready:
            return True
        event = self._get_or_create_event(session_id)
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
            return True
        except TimeoutError:
            return False

    def clear(self, session_id: uuid.UUID) -> None:
        """清除 session ready 状态（session end/failed 后调）。

        P2（2026-08-25 会话审查）：**直接 pop ``_events`` 键**（原实现用新
        ``asyncio.Event`` 替换槽位，键永不消失 → dict 随会话数无界增长）。
        语义不变：旧 event 若已 ``set``，已持有其引用的等待者早已通过；未
        ``set`` 的（clear 时无人 mark）等待者本就要超时——下一次 ``wait`` 经
        ``_get_or_create_event`` 建全新未 set 的 event，必须等下一次
        ``mark_ready`` 才能 set 返 ``True``，与原「换新未 set event」一致。
        """
        self._ready.discard(session_id)
        self._events.pop(session_id, None)


_SessionReadiness: SessionReadiness | None = None


def get_session_readiness() -> SessionReadiness:
    """Return (and lazily create) the process-wide SessionReadiness singleton.

    模块级单例（gap-2 / D-002）：``SessionService`` / ``DaemonService`` 在
    ``router.py`` 是 per-request 实例化，readiness 不能放实例字段（否则
    mark/wait 各看各的 set/event 失效）。参照 ``app/core/db.py`` 的
    ``get_session_factory()`` 范式：模块级变量 + 懒初始化访问器。
    """
    global _SessionReadiness
    if _SessionReadiness is None:
        _SessionReadiness = SessionReadiness()
    return _SessionReadiness
