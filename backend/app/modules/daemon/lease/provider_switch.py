"""notify_provider_switch — 默认供应商变更后查 active interactive session 按 daemon 分组推送热切换。

change 2026-08-06-provider-switch-live-session / task-04 / FR-06 / D-005@v1 / D-006@v1。

落点选择（allowed_paths 两选一）：新建本模块级函数,而非并入 lease_service.py。
理由：
  - ``notify_provider_switch`` 是无状态的模块级 helper（``session`` 由调用方注入,
    参考 task-02 ``resolve_default_provider_config`` 范式）,不持有 ``DaemonLeaseService``
    在 ``__init__`` 绑定的 ``self._session`` 生命周期;并入 service 类需强行套实例方法。
  - 职责是「查 active session + 按 daemon 分组 + WS 推送」,与 lease 正向生命周期
    （claim/heartbeat/expire/cancel）正交,放在 lease/ 子包下以模块级函数暴露更内聚。
  - 参考 ``_send_interactive_cancel``（lease_service.py:550）的 WS 推送范式：
    lazy import ``_resolve_daemon_id_for_runtime`` + ``get_daemon_ws_hub``,best-effort
    只告警不阻塞。

调用方（task-03 set_default/unset_default）：先经 ``resolve_default_provider_config``
构造新 config（启动）或传 None（停止）,再把结果传入本函数。本函数不查 LlmProvider——
provider_config 的「单一真相源」由 task-02 helper 守护（D-006）,此处只负责分发推送。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.model import AgentSession
from app.modules.daemon.control_commands import (
    KIND_PROVIDER_CONFIG_CHANGED,
    ControlCommandService,
)
from app.modules.daemon.model import DaemonTaskLease

log = get_logger(__name__)

# AgentSession.status 仅取 active / reconnecting（design §5 Wave1 + task-04 constraints：
# Grill 已确认枚举不含 ended/failed/pending）。ended/failed 是终态无需热切换;
# pending 尚未与 daemon 握手成功（SDK session_id 未回）,推过去 daemon 也无 SessionState
# 可挂 pendingSwitch,故排除。reconnecting 同 active 处理（daemon 仍持有 SessionState）。
_AFFECTED_SESSION_STATUSES: tuple[str, ...] = ("active", "reconnecting")


async def notify_provider_switch(
    session: AsyncSession,
    user_id: uuid.UUID,
    provider_config: dict | None,
) -> int:
    """查用户 active interactive session 按 owning daemon 推送 PROVIDER_CONFIG_CHANGED。

    change 2026-08-06-provider-switch-live-session / task-04 / FR-06 / D-005@v1。

    流程（design §5 Wave1 step 3-4）：
      1. 查 ``agent_sessions`` WHERE ``user_id`` = 目标 AND ``status`` IN (active,
         reconnecting),JOIN ``daemon_task_leases`` ON lease_id 过滤 ``kind='interactive'``
         （仅 interactive lease 绑定的会话才走 SDK driver 热切换;batch lease 是独立新
         进程,design N2 明确不处理）。
      2. 每个 session 经 ``session.runtime_id`` → ``_resolve_daemon_id_for_runtime``
         解析 owning daemon_instance_id（D-007 migration window:runtime 未绑 daemon_entity
         时回退 runtime_id 本身);解析为 None（runtime 行缺失）或 session.runtime_id 为 None
         → 跳过并告警（best-effort,不阻塞其余）。
      3. 经 ``ws_hub.send_session_control(daemon_id, PROVIDER_CONFIG_CHANGED, payload)``
         推送,payload = ``{session_id, provider_config}``（对齐
         ``ProviderConfigChangedPayload``）。启动场景 provider_config 为 task-02 helper
         构造的新 config dict;停止场景传 None（daemon 按 design §5 reloadWithProvider(null)
         回退本机凭证,D-004@v1）。
      4. best-effort：单个 daemon 离线（send 返回 False）/ 异常只告警,不影响其余 daemon
         推送（design §9 / 参考 ``_send_interactive_cancel``）。返回成功投递的 session 计数
         （``delivered=True``）;无 active session 返回 0,no-op 不抛异常（brownfield 零回归）。

    「按 daemon_id 分组」语义（R-02）：payload 必带 ``session_id``（daemon 据此定位
    SessionState 走 markPendingSwitch,design §5 Wave2）,故每个 (daemon_id, session_id)
    对各推一次——同一 daemon 上多个 session 会收到多条（每条带不同 session_id）,
    daemon 端 pendingSwitch 覆盖写天然幂等（R-02）。分组指路由维度（先解析 daemon_id
    再 send）,非去重折叠。

    Args:
        session: DB 会话（调用方注入,典型为 set_default/unset_default 的请求级 session）。
        user_id: 目标用户（LlmProvider.user_id）。
        provider_config: 启动场景为 ``resolve_default_provider_config`` 构造的中性 config
            dict（9 字段,含解密 api_key）;停止场景传 None。

    Returns:
        成功投递（``send_session_control`` 返回 True）的 session 计数;无 active session
        或全部离线时返回 0。
    """
    # ── step 1: 查 active interactive session（join lease 过滤 kind='interactive'）──
    stmt = (
        select(AgentSession)
        .join(DaemonTaskLease, AgentSession.lease_id == DaemonTaskLease.id)
        .where(
            AgentSession.user_id == user_id,
            AgentSession.status.in_(_AFFECTED_SESSION_STATUSES),
            DaemonTaskLease.kind == "interactive",
        )
    )
    rows = (await session.execute(stmt)).scalars().all()

    if not rows:
        log.info("provider_switch_no_active_session", user_id=str(user_id))
        return 0

    # lazy import：避免与 session.service / ws_hub 的顶层循环 import（同 _send_interactive_cancel）。
    from app.modules.daemon.session.service import _resolve_daemon_id_for_runtime

    delivered_count = 0

    for sess in rows:
        # ── step 2: runtime_id → daemon_id（D-005@v1 send_session_control 路由键）──
        runtime_id = sess.runtime_id
        if runtime_id is None:
            log.warning(
                "provider_switch_session_no_runtime",
                session_id=str(sess.id),
                user_id=str(user_id),
            )
            continue

        daemon_id = await _resolve_daemon_id_for_runtime(session, runtime_id)
        if daemon_id is None:
            # runtime 行缺失（极端：runtime 已 CASCADE 删除但 session 残留）→ 无法路由,
            # 跳过不阻塞其余。best-effort（design §9）。
            log.warning(
                "provider_switch_daemon_unresolved",
                session_id=str(sess.id),
                runtime_id=str(runtime_id),
            )
            continue

        # ── step 3: 推送 PROVIDER_CONFIG_CHANGED（payload 对齐 ProviderConfigChangedPayload）──
        # task-04（design A2）：走控制指令三段式——落库 pending + ws_hub 推送
        # （消息形状不变）+ delivered 标记；WS 失败/不在线保持 pending 待补拉，
        # 热切换即时性缺陷由 daemon 重连对账弥补。
        payload = {
            "session_id": str(sess.id),
            "provider_config": provider_config,
        }
        try:
            _row, delivered = await ControlCommandService(session).enqueue_and_push(
                daemon_id=daemon_id,
                runtime_id=runtime_id,
                kind=KIND_PROVIDER_CONFIG_CHANGED,
                payload=payload,
            )
        except Exception as exc:
            # best-effort（design §9）：WS 异常不影响其余 session 推送。
            log.warning(
                "provider_switch_signal_failed",
                session_id=str(sess.id),
                daemon_id=str(daemon_id),
                error=str(exc),
            )
            continue

        log.info(
            "provider_switch_signal_sent",
            session_id=str(sess.id),
            daemon_id=str(daemon_id),
            delivered=delivered,
        )
        if delivered:
            delivered_count += 1

    log.info(
        "provider_switch_completed",
        user_id=str(user_id),
        matched_sessions=len(rows),
        delivered_sessions=delivered_count,
    )
    return delivered_count
