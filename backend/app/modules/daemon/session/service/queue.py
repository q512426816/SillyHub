"""会话排队消息管理（task-08 拆分，原 :4749-5229 + 忙轮入队分支）。

8 个队列方法体下沉 + dispatch_next_queued_message（模块级，run 终态钩子
后台派发入口）+ _handle_busy_turn（自 _inject_into_session 忙轮三分支整体
拆出：steering 直注入 / 409 冲突 / 排队入队，零改写）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlmodel import col

import app.modules.daemon.session.service as _svc
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import (
    SESSION_QUEUE_MAX_PENDING,
    AgentRun,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.daemon.schema import PageContextCreateBlock
from app.modules.daemon.session.service.auto_resume import (
    parse_auto_resume_origin,
)

from .errors import (
    DaemonSessionNotActive,
    DaemonSessionQueueEntryNotEditable,
    DaemonSessionQueueEntryNotFound,
    DaemonSessionQueueFull,
    DaemonSessionQueueOrderMismatch,
    DaemonSessionTurnConflict,
)
from .helpers import (
    TASK_WAKEUP_PROMPT_PREFIX,
    _merge_task_wakeup_prompt,
    _prepend_group_chain_marker,
    _split_group_chain_marker,
)
from .results import SessionDispatchResult

log = get_logger(__name__)


async def _handle_busy_turn(
    svc,
    session: AgentSession,
    current: AgentRun,
    *,
    prompt: str,
    attachment_ids: list[uuid.UUID] | None = None,
    attachment_owner_user_id: uuid.UUID | None = None,
    page_context: PageContextCreateBlock | None = None,
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    model: str | None = None,
    queue_when_busy: bool = False,
    busy_strategy: Literal["queue", "inject"] | None = None,
    run_sender_user_id: uuid.UUID | None = None,
    queue_sender_user_id: uuid.UUID | None = None,
    turn_metadata: dict | None = None,
) -> SessionDispatchResult:
    """忙轮三分支收口（task-08 自 _inject_into_session:3499-3650 拆出，零改写）。

    调用方已持会话行锁且 current（唯一活跃 run）非空：busy_strategy="inject"
    且不带切换维度 → steering 直注入活跃轮；否则按 queue_when_busy /
    busy_strategy 判冲突 409 或落排队表（满员 409 / 通知合并不新增行 /
    MAX(position)+1 入队）。所有路径均返回 SessionDispatchResult。
    """
    # 原 _inject_into_session 局部变量（= session.id），随分段拆出保名。
    session_id = session.id

    # quick（2026-09-02 群聊忙轮注入 steering）：busy_strategy=
    # "inject" 的调用方（群聊 @ 忙轮成员）跳过排队，直接把消息
    # 注入当前活跃轮——不建新 run（run_id 沿用活跃 run，单会话单
    # 活跃 run 不变式保持），本轮 user_input 留痕日志挂同一活跃
    # run（turn_metadata 照传），SESSION_INJECT 沿三段式下发
    # （daemon 侧 running 时注入是既有安全路径：工具间隙 mid-turn
    # 消费=steering 目标，最坏轮边界消费=等同原排队时延）。仅普通
    # 消息轮支持：携带配置切换维度（轮边界语义）不生效，回落下方
    # 排队/切换分支。
    if (
        busy_strategy == "inject"
        and agent_profile_id is None
        and llm_provider_id is None
        and model is None
    ):
        return await svc._inject_mid_turn_into_run(
            session,
            current_run=current,
            prompt=prompt,
            attachment_ids=attachment_ids,
            attachment_owner_user_id=attachment_owner_user_id,
            turn_metadata=turn_metadata,
        )
    # ql-20260825-011（后端真实排队）：忙轮不再无条件 409——
    # queue_when_busy=True 的调用方（前端会话 UI）改落排队表，
    # run 终态后由 dispatch_next_queued_message 自动派发；默认
    # False 保持既有 DaemonSessionTurnConflict 拒绝语义（service
    # 身份路径 / 平台审批代写零回归）。入队仍在锁内判定，满员
    # 检查与写行原子（并发双发不会超上限）。
    if not queue_when_busy and busy_strategy != "queue":
        raise DaemonSessionTurnConflict(
            f"Session '{session_id}' already has an active run '{current.id}'.",
            details={
                "session_id": str(session_id),
                "current_run_id": str(current.id),
            },
        )
    pending_count = len(
        (
            await svc._session.execute(
                select(AgentSessionQueuedMessage.id).where(
                    AgentSessionQueuedMessage.agent_session_id == session.id,
                    AgentSessionQueuedMessage.status == "pending",
                )
            )
        ).all()
    )
    if pending_count >= SESSION_QUEUE_MAX_PENDING:
        raise DaemonSessionQueueFull(
            f"会话排队消息已达上限（{SESSION_QUEUE_MAX_PENDING} 条），请等当前本轮结束后再发送。",
            details={
                "session_id": str(session_id),
                "pending": pending_count,
            },
        )
    # ql-20260827-015：通知合并——同会话已有 pending 的「[后台任务通知]」
    # 条目时并入不新增行（行锁内查询 + 更新，与满员检查同事务原子）。
    # 返回形态与普通入队一致（queued=True + 同 entry id），daemon 调用
    # 方无感。
    # 2026-08-31-session-queue-ux（design §4 Phase1.2/D-002）：merge 只
    # 原地改 prompt——不新建行、原条目 position 保持不变。
    existing_notification: AgentSessionQueuedMessage | None = None
    if prompt.startswith(TASK_WAKEUP_PROMPT_PREFIX):
        existing_notification = (
            await svc._session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session.id,
                    AgentSessionQueuedMessage.status == "pending",
                    AgentSessionQueuedMessage.prompt.like(f"{TASK_WAKEUP_PROMPT_PREFIX}%"),
                )
            )
        ).scalar_one_or_none()
    if existing_notification is not None:
        existing_notification.prompt = _merge_task_wakeup_prompt(
            existing_notification.prompt or "", prompt
        )
        svc._session.add(existing_notification)
        await svc._session.commit()
        await svc._publish_session_event(
            session.id,
            {
                "event": "queue_changed",
                "session_id": str(session.id),
                "queue_entry_id": str(existing_notification.id),
                "action": "merged",
            },
        )
        return SessionDispatchResult(
            agent_session=session,
            agent_run=None,
            lease_id=None,
            queued=True,
            queue_entry_id=existing_notification.id,
        )
    # 2026-08-31-session-queue-ux D-002（R-01）：入队序键 = 会话现有
    # 条目 MAX(position)+1（空队列首条=0）。查询在调用方
    # _get_owned_session_for_update 会话行锁内、与满员检查/merge
    # 同事务，无并发窗口；行锁已保证串行，不加唯一约束（排序键带
    # created_at 次序，position 重复不破坏正确性）。
    from sqlalchemy import func

    max_position = (
        await svc._session.execute(
            select(func.max(AgentSessionQueuedMessage.position)).where(
                AgentSessionQueuedMessage.agent_session_id == session.id
            )
        )
    ).scalar()
    entry = AgentSessionQueuedMessage(
        agent_session_id=session.id,
        # task-03（群聊影子排队）：sender 记实际发送者（覆盖优先），
        # 其余路径维持 run_sender_user_id or 会话属主既有语义。
        sender_user_id=(queue_sender_user_id or run_sender_user_id or session.user_id),
        # task-04（群链透传）：排队条目无 metadata 列——链 id/深度拼
        # 进 prompt 头部标记行，派发侧剥离还原（见
        # _split_group_chain_marker）。
        prompt=_prepend_group_chain_marker(prompt, turn_metadata),
        attachment_ids=([str(a) for a in attachment_ids] if attachment_ids else None),
        page_context=(
            page_context.model_dump(mode="json", exclude_none=True)
            if page_context is not None
            else None
        ),
        agent_profile_id=agent_profile_id,
        llm_provider_id=llm_provider_id,
        status="pending",
        # task-05 缺陷 A 修正：or 兜底在 max==0 时回卷（0 or -1 = -1），
        # 连续入队全 0——显式 None 判（对齐 MAX+1 语义，D-002）。
        position=(max_position + 1) if max_position is not None else 0,
    )
    svc._session.add(entry)
    await svc._session.commit()
    await svc._session.refresh(entry)
    await svc._publish_session_event(
        session.id,
        {
            "event": "queue_changed",
            "session_id": str(session.id),
            "queue_entry_id": str(entry.id),
            "action": "enqueued",
        },
    )
    return SessionDispatchResult(
        agent_session=session,
        agent_run=None,
        lease_id=None,
        queued=True,
        queue_entry_id=entry.id,
    )


async def _fail_pending_queued_messages(svc, session_id: uuid.UUID, error_msg: str) -> int:
    """把会话的全部 pending 排队消息翻 failed（调用方事务内，不 commit）。

    返回翻状态条数（观测用）。end_session / 派发遇不可恢复态时收口，
    队列不留永远 pending 的死条目。
    """
    rows = (
        (
            await svc._session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id,
                    AgentSessionQueuedMessage.status == "pending",
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for row in rows:
        row.status = "failed"
        row.error_msg = error_msg
        row.updated_at = now
        svc._session.add(row)
    return len(rows)


async def list_queued_messages(
    svc, session_id: uuid.UUID, user_id: uuid.UUID
) -> list[AgentSessionQueuedMessage]:
    """列出会话排队消息（position 升序、created_at 次之 = 派发顺序，
    2026-08-31-session-queue-ux FR-04/D-002——与 dispatch 队首取条同键）。

    归属校验复用 :meth:`_get_owned_session_for_update` 后立即 rollback
    释放行锁（排队列表是低频读，不占写锁）；owned_id 在 rollback 前取
    标量，避免回滚后属性过期。
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)
    owned_id = session.id
    await svc._session.rollback()
    rows = (
        (
            await svc._session.execute(
                select(AgentSessionQueuedMessage)
                .where(AgentSessionQueuedMessage.agent_session_id == owned_id)
                .order_by(
                    col(AgentSessionQueuedMessage.position),
                    col(AgentSessionQueuedMessage.created_at),
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def delete_queued_message(
    svc, session_id: uuid.UUID, entry_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """删除一条排队消息（用户在队列条上点 ×）。发送中不可删的约束在
    前端——后端派发是「取队头 pending → _inject_into_session → 成功即
    删行」，这里删除 pending/failed 条目与派发路径在会话行锁上互斥，
    不会删到正在派发的条目。
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)
    entry = (
        await svc._session.execute(
            select(AgentSessionQueuedMessage).where(
                AgentSessionQueuedMessage.id == entry_id,
                AgentSessionQueuedMessage.agent_session_id == session.id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotFound(
            f"排队消息 '{entry_id}' 不存在或不属于会话 '{session_id}'。",
            details={"session_id": str(session_id), "entry_id": str(entry_id)},
        )
    await svc._session.delete(entry)
    await svc._session.commit()
    await svc._publish_session_event(
        session.id,
        {
            "event": "queue_changed",
            "session_id": str(session.id),
            "queue_entry_id": str(entry_id),
            "action": "deleted",
        },
    )


async def retry_queued_message(
    svc, session_id: uuid.UUID, entry_id: uuid.UUID, user_id: uuid.UUID
) -> AgentSessionQueuedMessage:
    """failed → pending 并立即尝试派发（忙则留队等 run 终态自动派发）。"""
    session = await svc._get_owned_session_for_update(session_id, user_id)
    entry = (
        await svc._session.execute(
            select(AgentSessionQueuedMessage).where(
                AgentSessionQueuedMessage.id == entry_id,
                AgentSessionQueuedMessage.agent_session_id == session.id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotFound(
            f"排队消息 '{entry_id}' 不存在或不属于会话 '{session_id}'。",
            details={"session_id": str(session_id), "entry_id": str(entry_id)},
        )
    if entry.status == "failed":
        entry.status = "pending"
        entry.error_msg = None
        entry.updated_at = datetime.now(UTC)
        svc._session.add(entry)
        await svc._session.commit()
        await svc._session.refresh(entry)
    # 派发尝试复用会话行锁路径（忙则内部自然 no-op）。
    await svc.dispatch_queued_messages(session.id)
    fresh = await svc._session.get(AgentSessionQueuedMessage, entry_id)
    if fresh is not None:
        return fresh
    # 派发成功：dispatch 内部已删行并 commit（turn 已落 AgentRun、
    # queue_changed=dispatched 事件已发）。此处 re-get 必为 None——此前
    # 裸 assert 在该路径必抛 AssertionError → 接口 500，但消息其实已
    # 发出。返回删除前的 detached 快照（expire_on_commit=False 属性仍在），
    # status 标 dispatched 供调用方识别；前端消费 SSE/重新拉队列为准。
    entry.status = "dispatched"
    return entry


async def reorder_queued_messages(
    svc,
    session_id: uuid.UUID,
    entry_ids: list[uuid.UUID],
    user_id: uuid.UUID,
) -> None:
    """按上传序全量重写排队条目 position（2026-08-31-session-queue-ux FR-04）。

    会话行锁内（R-01）校验 ``entry_ids`` 集合 == 现有条目全集（表内只剩
    pending+failed，派发成功即删行）——多 / 少 / 含他会话条目 / 重复 id
    均 422 :class:`DaemonSessionQueueOrderMismatch`（D-003 全量上传，不允许
    部分重排）；校验通过后按列表序重写 position=0..n-1 + updated_at，
    commit 并补发 queue_changed(action="reordered")。
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)
    rows = list(
        (
            await svc._session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session.id
                )
            )
        )
        .scalars()
        .all()
    )
    # 长度先比（拦重复 id 的多上传），集合再比（拦少传/传错会话条目）。
    if len(entry_ids) != len(rows) or set(entry_ids) != {row.id for row in rows}:
        # task-05 缺陷 B 同款修正：rollback 过期 ORM 实例——details 先取标量
        # 再回滚（expected/received 均为 str 快照），否则 MissingGreenlet 500。
        mismatch_details = {
            "session_id": str(session_id),
            "expected_entry_ids": sorted(str(row.id) for row in rows),
            "received_entry_ids": sorted(str(i) for i in entry_ids),
        }
        await svc._session.rollback()
        raise DaemonSessionQueueOrderMismatch(
            f"排队条目集合与会话 '{session_id}' 现有条目不一致（reorder 需全量上传）。",
            details=mismatch_details,
        )
    # 2026-09-10-auto-resume-interrupted-turn：续跑条目 position 是队首语义
    # （恢复原执行顺序，D-012）——reorder 会破坏该语义，照 edit 的 409 口径
    # 拒绝含续跑条目的重排（用户可 delete 该条目后再重排其余）。
    if any(row.origin is not None and row.origin.startswith("auto_resume:") for row in rows):
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotEditable(
            f"会话 '{session_id}' 队列含自动续跑条目，不支持重排（可删除该条目后重排）。",
            details={"session_id": str(session_id)},
        )
    by_id = {row.id: row for row in rows}
    now = datetime.now(UTC)
    for position, entry_id in enumerate(entry_ids):
        row = by_id[entry_id]
        row.position = position
        row.updated_at = now
        svc._session.add(row)
    await svc._session.commit()
    await svc._publish_session_event(
        session.id,
        {
            "event": "queue_changed",
            "session_id": str(session.id),
            "action": "reordered",
        },
    )


async def update_queued_message(
    svc,
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    prompt: str,
    user_id: uuid.UUID,
) -> AgentSessionQueuedMessage:
    """编辑排队条目 prompt 文本（2026-08-31-session-queue-ux FR-06 / NG-01）。

    会话行锁内（R-01）取条目（404）；仅改 prompt + updated_at（附件 /
    配置快照不动，NG-01）；TASK_WAKEUP 系统通知条目 409 不可编辑
    （D-009）；failed 条目保存后重置 pending + 清 error_msg，并复用
    :meth:`dispatch_queued_messages` 立即尝试派发（对齐 retry 模式，忙则
    内部 no-op 留队）；commit 后补发 queue_changed(action="edited")。
    长度 1..8000 校验在 DTO 层（QueueEntryUpdateRequest，对齐
    SessionInjectRequest.prompt 的 8000 上限）。
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)
    entry = (
        await svc._session.execute(
            select(AgentSessionQueuedMessage).where(
                AgentSessionQueuedMessage.id == entry_id,
                AgentSessionQueuedMessage.agent_session_id == session.id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotFound(
            f"排队消息 '{entry_id}' 不存在或不属于会话 '{session_id}'。",
            details={"session_id": str(session_id), "entry_id": str(entry_id)},
        )
    if (entry.prompt or "").startswith(TASK_WAKEUP_PROMPT_PREFIX):
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotEditable(
            f"系统通知条目 '{entry_id}' 不支持编辑。",
            details={"session_id": str(session_id), "entry_id": str(entry_id)},
        )
    # 2026-09-10-auto-resume-interrupted-turn：续跑条目包装头是系统模板（改坏
    # 会让续跑语义失真）——照 TASK_WAKEUP 先例 409。
    if entry.origin is not None and entry.origin.startswith("auto_resume:"):
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotEditable(
            f"自动续跑条目 '{entry_id}' 不支持编辑。",
            details={"session_id": str(session_id), "entry_id": str(entry_id)},
        )
    entry.prompt = prompt
    entry.updated_at = datetime.now(UTC)
    was_failed = entry.status == "failed"
    if was_failed:
        entry.status = "pending"
        entry.error_msg = None
    svc._session.add(entry)
    await svc._session.commit()
    await svc._session.refresh(entry)
    await svc._publish_session_event(
        session.id,
        {
            "event": "queue_changed",
            "session_id": str(session.id),
            "queue_entry_id": str(entry.id),
            "action": "edited",
        },
    )
    if not was_failed:
        return entry
    # failed 重置 pending 后立即尝试派发（对齐 retry :4279 模式）。
    await svc.dispatch_queued_messages(session.id)
    fresh = await svc._session.get(AgentSessionQueuedMessage, entry_id)
    if fresh is not None:
        return fresh
    # 派发成功：行已删（retry 同款），返回 detached 快照标 dispatched。
    entry.status = "dispatched"
    return entry


async def dispatch_queued_message_now(
    svc,
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    user_id: uuid.UUID,
) -> bool:
    """立即发送排队条目（2026-08-31-session-queue-ux FR-05 / D-001）。

    会话行锁内（R-01）：非 active 409（终态/挂起均拒，与 interrupt 同
    口径）；条目 404；failed 重置 pending + 清 error_msg；本条 position
    置队首（全量重写该会话队列 0..n-1，D-002 ≤5 行）+ commit + 补发
    queue_changed(action="dispatch_now")——**commit 先于 interrupt 发送**，
    interrupt 失败不回滚置顶（R-03）。随后判活跃 run：
    - 有 → :meth:`_send_interrupt_control` 打断当前轮（daemon 零改动
      D-007，run 终态钩子接力派发队首=本条；AppError 向上抛），返 True；
    - 无 → 当场 :meth:`dispatch_queued_messages` 同步派发本条（R-04，
      条目可能当场删行），返 False。

    Returns:
        interrupted: True=已打断活跃轮（接力派发）；False=空闲当场派发。
    """
    session = await svc._get_owned_session_for_update(session_id, user_id)
    if session.status != "active":
        # task-05 缺陷 B 修正：rollback 会过期 ORM 实例，先取标量再回滚
        # （对齐 list_queued_messages 的 owned_id 先例），否则 409 变 MissingGreenlet 500。
        stale_status = session.status
        await svc._session.rollback()
        raise DaemonSessionNotActive(
            f"AgentSession '{session_id}' is not active (status={stale_status}).",
            details={"session_id": str(session_id), "status": stale_status},
        )
    rows = list(
        (
            await svc._session.execute(
                select(AgentSessionQueuedMessage)
                .where(AgentSessionQueuedMessage.agent_session_id == session.id)
                .order_by(
                    col(AgentSessionQueuedMessage.position),
                    col(AgentSessionQueuedMessage.created_at),
                )
            )
        )
        .scalars()
        .all()
    )
    entry = next((row for row in rows if row.id == entry_id), None)
    if entry is None:
        await svc._session.rollback()
        raise DaemonSessionQueueEntryNotFound(
            f"排队消息 '{entry_id}' 不存在或不属于会话 '{session_id}'。",
            details={"session_id": str(session_id), "entry_id": str(entry_id)},
        )
    if entry.status == "failed":
        entry.status = "pending"
        entry.error_msg = None
    # 置队首：本条放 0，其余按现序顺移（全量重写 ≤5 行，D-002）。
    rows.remove(entry)
    now = datetime.now(UTC)
    for position, row in enumerate([entry, *rows]):
        row.position = position
        row.updated_at = now
        svc._session.add(row)
    await svc._session.commit()
    await svc._publish_session_event(
        session.id,
        {
            "event": "queue_changed",
            "session_id": str(session.id),
            "queue_entry_id": str(entry_id),
            "action": "dispatch_now",
        },
    )
    # commit 后判活跃 run（置顶持久化先于 interrupt，R-03）。
    run = await svc._get_current_run(session.id)
    if run is not None:
        await svc._send_interrupt_control(session, run_id=run.id)
        return True
    await svc.dispatch_queued_messages(session.id)
    return False


async def dispatch_queued_messages(svc, session_id: uuid.UUID) -> None:
    """派发会话排队消息（循环派发，2026-08-31-session-queue-ux FR-01/02）。

    语义：外层 ``while`` 每轮重取会话行锁（FOR UPDATE）后分支——
    - 会话不存在 → 返回；
    - 终态（``{ended, failed}``，D-010 词表无 cancelled）→ pending 条目
      全部转 failed（现状保留，队尾不留死条目）；
    - 非 active 且非终态（pending/reconnecting/suspended）→ rollback 返回，
      pending **原样保留**（D-005——非终态会话还有恢复可能，失败化只留给
      终态；等 confirm 恢复钩子 / 用户动作等下一触发点）；
    - 有活跃 run → rollback 返回（会话忙，等本轮 turn 终态钩子再触发）；
    - 取队首 pending（position 最小、created_at 次之——FR-04/D-002，与
      list 排序同键）重放 inject（page_context / attachment_ids 宽容解析）：
      成功即删行 → 继续下一轮（新 run 已活跃，下轮 current_run 分支自然
      退出，「至多一个活跃 run」不变式天然串行）；AppError → 该条转
      failed 留队 → 连续失败计数 +1，**≥2 停止本轮循环**（R-05/D-004——
      系统性故障不连环刷屏），否则继续下一条（瞬态单点失败不拖队）。
      派发成功一条计数清零。每轮消耗（删行/转 failed）一个 pending 条目
      且队列上限 5，循环必然终止。
    """
    consecutive_failures = 0
    while True:
        session = (
            await svc._session.execute(
                select(AgentSession).where(AgentSession.id == session_id).with_for_update()
            )
        ).scalar_one_or_none()
        if session is None:
            return
        if session.status in ("ended", "failed"):
            await svc._fail_pending_queued_messages(
                session_id, f"会话当前状态为 {session.status}，排队消息未发送。"
            )
            await svc._session.commit()
            return
        if session.status != "active":
            # D-005（FR-02 / P3 根因）：非终态非 active 不再批量失败化，
            # pending 原样保留等下一触发点。
            await svc._session.rollback()
            return
        if await svc._get_current_run(session.id) is not None:
            await svc._session.rollback()
            return

        entry = (
            await svc._session.execute(
                select(AgentSessionQueuedMessage)
                .where(
                    AgentSessionQueuedMessage.agent_session_id == session.id,
                    AgentSessionQueuedMessage.status == "pending",
                )
                .order_by(
                    col(AgentSessionQueuedMessage.position),
                    col(AgentSessionQueuedMessage.created_at),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if entry is None:
            await svc._session.rollback()
            return

        # 2026-09-10-auto-resume-interrupted-turn（D-002@v2 / G10）：派发时守卫——
        # 续跑条目（origin=auto_resume:<源 run id>）在入队后被用户手动重发/新
        # 发言超越时（source run 之后存在更新 run），重放原任务会执行两遍——
        # 静默删行跳过记日志，等待中的其它 pending 条目照常派发。入队时 G4 只
        # 挡「入队前已重发」，本守卫挡「入队后、派发前重发」（Grill P1-2）。
        auto_resume_source = parse_auto_resume_origin(entry.origin)
        if auto_resume_source is not None:
            src_run = await svc._session.get(AgentRun, auto_resume_source)
            if src_run is not None:
                newer_run_id = (
                    await svc._session.execute(
                        select(AgentRun.id)
                        .where(
                            AgentRun.agent_session_id == session.id,
                            AgentRun.id != auto_resume_source,
                            or_(
                                col(AgentRun.created_at) > src_run.created_at,
                                and_(
                                    col(AgentRun.created_at) == src_run.created_at,
                                    col(AgentRun.id) > auto_resume_source,
                                ),
                            ),
                        )
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if newer_run_id is not None:
                    fresh_skip = await svc._session.get(AgentSessionQueuedMessage, entry.id)
                    if fresh_skip is not None:
                        await svc._session.delete(fresh_skip)
                        await svc._session.commit()
                    log.info(
                        "auto_resume_dispatch_skipped_superseded",
                        session_id=str(session.id),
                        source_run_id=str(auto_resume_source),
                        newer_run_id=str(newer_run_id),
                    )
                    continue

        page_context: PageContextCreateBlock | None = None
        if entry.page_context is not None:
            try:
                page_context = PageContextCreateBlock(**entry.page_context)
            except Exception:
                page_context = None
        attachment_ids: list[uuid.UUID] | None = None
        if entry.attachment_ids:
            try:
                attachment_ids = [uuid.UUID(str(a)) for a in entry.attachment_ids]
            except (ValueError, AttributeError, TypeError):
                attachment_ids = None
        # task-04（群链透传）：剥离入队时拼进的链标记行——剩余 prompt 走
        # 派发注入（daemon 看到的文本与即时注入轮一致），链 metadata 写入
        # 新 run 的 user_input 日志（turn_completed 互@检测读取）。
        dispatch_prompt, chain_metadata = _split_group_chain_marker(entry.prompt or "")
        # 群聊附件（FR-05 补遗）：群排队条目派发时的附件归属基准 = 实际
        # 发送者（链标记 sender_user_id——仅群链路条目携带，ql-20260903-007
        # 起入队侧写入 sender= 段；修复前入队的存量条目无该段 → None 回退
        # 属主语义；附件在发送时已过发送者归属校验并绑定群会话）。非群
        # 条目/无标记 → None 走会话属主既有语义。
        attachment_owner_user_id: uuid.UUID | None = None
        _chain_sender = (chain_metadata or {}).get("sender_user_id")
        if isinstance(_chain_sender, str) and _chain_sender:
            try:
                attachment_owner_user_id = uuid.UUID(_chain_sender)
            except (ValueError, AttributeError, TypeError):
                attachment_owner_user_id = None

        try:
            await svc._inject_into_session(
                session,
                prompt=dispatch_prompt,
                auto_resume_of=auto_resume_source,
                run_sender_user_id=entry.sender_user_id,
                agent_profile_id=entry.agent_profile_id,
                llm_provider_id=entry.llm_provider_id,
                attachment_ids=attachment_ids,
                attachment_owner_user_id=attachment_owner_user_id,
                page_context=page_context,
                turn_metadata=chain_metadata,
            )
        except AppError as exc:
            # 派发失败（daemon 离线 / 附件失效 / 配置失效等）：条目转 failed
            # 留队供重试。_inject_into_session 内部已 rollback 事务。
            entry.status = "failed"
            entry.error_msg = str(exc)
            entry.updated_at = datetime.now(UTC)
            svc._session.add(entry)
            await svc._session.commit()
            await svc._publish_session_event(
                session.id,
                {
                    "event": "queue_changed",
                    "session_id": str(session.id),
                    "queue_entry_id": str(entry.id),
                    "action": "failed",
                },
            )
            consecutive_failures += 1
            if consecutive_failures >= 2:
                # R-05/D-004：连续 2 条派发失败视为系统性故障，停止本轮
                # 循环，剩余 pending 不逐条转 failed 刷屏。
                return
            # 瞬态单点失败：继续下一条（该条已 failed 不再是队首 pending）。
            continue
        # 派发成功：删除排队行（turn 已落 AgentRun，队列不重复存史）。
        # _inject_into_session 内部已 commit；重新取行再删（identity map 里
        # 的旧对象可能已过期）。
        fresh = await svc._session.get(AgentSessionQueuedMessage, entry.id)
        if fresh is not None:
            await svc._session.delete(fresh)
            await svc._session.commit()
        await svc._publish_session_event(
            session.id,
            {
                "event": "queue_changed",
                "session_id": str(session.id),
                "queue_entry_id": str(entry.id),
                "action": "dispatched",
            },
        )
        consecutive_failures = 0
        # 继续下一轮：新 run 已活跃则 current_run 分支自然退出（串行不变式）。
        continue


async def dispatch_next_queued_message(session_id: uuid.UUID) -> None:
    """后台派发会话排队消息（ql-20260825-011，run 终态钩子调用）。

    独立 DB session（H1，对齐 run_sync._run_gate_decision_task 模式）——
    后台任务生命周期独立于触发它的 HTTP/WS 请求会话。异常 fail-loud 交
    `_fire_background_task` 的 done_callback 记日志，不影响已提交的 run
    终态。锁与「至多一个活跃 run」不变式由 dispatch_queued_messages 内部
    的会话行锁 + current_run 复查保证。
    """
    from app.core.db import get_session_factory

    session_factory = get_session_factory()
    async with session_factory() as db:
        svc = _svc.SessionService(db)
        await svc.dispatch_queued_messages(session_id)
