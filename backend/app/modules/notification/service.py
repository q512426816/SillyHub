"""NotificationService：广播/定向/消解三类核心方法 + 通道抽象（task-02 / design §7.1）.

* ``NotificationChannel`` Protocol（D-003@v2）：落库后的旁路投递抽象，
  未来 IM/webhook 通道 append 进 ``channels`` 列表即可，不改 service。
* ``InAppChannel``：Redis publish 全局频道 ``notifications:new``；广播多行
  合并为一次 publish（payload 取首行通知摘要 + 收件人并集）。
* 幂等（D-009@v2）：service 是唯一检查方——同 ``(ref_type, ref_id, type)``
  且 ``read_at IS NULL`` 的行存在即跳过；``dedupe_key`` 仅审计列不参与检查。
* 事务（D-006@v1）：notify_broadcast / notify_user / resolve_pending /
  mark_read / mark_all_read 均在方法内独立 commit——触发点主事务回滚
  不影响已落库通知；投递全部 best-effort，任何通道失败不向上抛。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal, Protocol, runtime_checkable

from fastapi import status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import list_user_ids_with_permission
from app.modules.notification.events import publish_notifications_new
from app.modules.notification.model import Notification

log = get_logger(__name__)

NotificationType = Literal[
    "approval_pending",  # change 审核门待办产生（广播）
    "approval_result",  # change 审批动作结果（定向 owner）
    "permission_request",  # daemon 权限/对话审批请求（定向 owner）
    "permission_timeout",  # daemon 权限请求超时失效（定向 owner）
]


class NotificationNotFound(AppError):
    """通知不存在或非本人（越权）——中文文案由调用点传入。"""

    code = "HTTP_404_NOTIFICATION_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


@runtime_checkable
class NotificationChannel(Protocol):
    """投递通道抽象：落库后的旁路投递，全部 best-effort。"""

    async def deliver(self, rows: list[Notification]) -> None: ...


class InAppChannel:
    """站内通道：Redis publish 全局频道 ``notifications:new``.

    广播多行同事件合并为一次 publish——payload 取首行通知摘要，
    ``recipient_user_ids`` 为全部收件人并集，订阅方据此外推过滤。
    发布失败由 ``events.publish_notifications_new`` 兜底（仅 log.warning）。
    """

    async def deliver(self, rows: list[Notification]) -> None:
        if not rows:
            return
        first = rows[0]
        payload = {
            "recipient_user_ids": [str(r.recipient_user_id) for r in rows],
            "notification": {
                "id": str(first.id),
                "type": first.type,
                "title": first.title,
                "body": first.body,
                "link": first.link,
                "created_at": first.created_at.isoformat() if first.created_at else None,
            },
        }
        await publish_notifications_new(payload)


class NotificationService:
    """通知服务：写路径（广播/定向/消解）与读路径（列表/未读/已读）。"""

    def __init__(
        self,
        session: AsyncSession,
        channels: list[NotificationChannel] | None = None,
    ) -> None:
        self._session = session
        # channels 默认 [InAppChannel()]；未来 IM 通道 append 即可（D-003@v2）。
        self._channels: list[NotificationChannel] = (
            channels if channels is not None else [InAppChannel()]
        )

    # ── 写路径 ────────────────────────────────────────────────────────────

    async def notify_broadcast(
        self,
        *,
        workspace_id: uuid.UUID,
        permission: Permission,
        type: NotificationType,
        title: str,
        body: str | None,
        link: str | None,
        ref_type: str,
        ref_id: str,
        dedupe_key: str,
    ) -> int:
        """广播给工作区内持有 ``permission`` 的全员，返回落库行数。

        幂等（D-009@v2，service 为唯一检查方）：已存在「同
        ``(ref_type, ref_id, type)`` 且 ``read_at IS NULL``」的行 → 跳过
        返回 0，不落库不投递；``dedupe_key`` 仅审计列不参与检查。
        落库（方法内独立 commit）成功后才走 channels 投递；收件人集为空
        返回 0。
        """
        if await self._has_unresolved(ref_type, ref_id, type):
            log.info(
                "notify_broadcast_skipped_unresolved",
                ref_type=ref_type,
                ref_id=ref_id,
                type=type,
            )
            return 0

        recipient_ids = await list_user_ids_with_permission(
            self._session, workspace_id=workspace_id, permission=permission
        )
        if not recipient_ids:
            return 0

        rows = [
            Notification(
                workspace_id=workspace_id,
                recipient_user_id=uid,
                type=type,
                title=title,
                body=body,
                link=link,
                ref_type=ref_type,
                ref_id=ref_id,
                dedupe_key=dedupe_key,
            )
            for uid in recipient_ids
        ]
        self._session.add_all(rows)
        await self._session.commit()
        await self._deliver(rows)
        log.info(
            "notify_broadcast_delivered",
            ref_type=ref_type,
            ref_id=ref_id,
            type=type,
            recipients=len(rows),
        )
        return len(rows)

    async def notify_user(
        self,
        *,
        workspace_id: uuid.UUID,
        recipient_user_id: uuid.UUID,
        type: NotificationType,
        title: str,
        body: str | None,
        link: str | None,
        ref_type: str | None = None,
        ref_id: str | None = None,
        dedupe_key: str | None = None,
    ) -> bool:
        """定向单用户落库+投递；``recipient_user_id`` 为 None 时调用方跳过
        （owner 缺失场景，service 不强制）。"""
        row = Notification(
            workspace_id=workspace_id,
            recipient_user_id=recipient_user_id,
            type=type,
            title=title,
            body=body,
            link=link,
            ref_type=ref_type,
            ref_id=ref_id,
            dedupe_key=dedupe_key,
        )
        self._session.add(row)
        await self._session.commit()
        await self._deliver([row])
        log.info(
            "notify_user_delivered",
            type=type,
            recipient_user_id=str(recipient_user_id),
            ref_type=ref_type,
            ref_id=ref_id,
        )
        return True

    async def resolve_pending(
        self,
        *,
        ref_type: str,
        ref_id: str,
        types: tuple[str, ...] = ("approval_pending",),
    ) -> int:
        """待办消解（D-007@v1）：同 ref 的未读待办批量置 ``read_at=now``。

        方法内独立 commit（触发点事务已提交后调用，失败不回滚主流程，
        D-006@v1）。驳回/回退重跑同门时，消解后未消解检查不命中 → 允许
        再次插入（无唯一索引的根因，D-009@v2）。
        """
        now = datetime.now(UTC)
        result = await self._session.execute(
            update(Notification)
            .where(
                Notification.ref_type == ref_type,
                Notification.ref_id == ref_id,
                Notification.type.in_(types),
                Notification.read_at.is_(None),
            )
            .values(read_at=now)
        )
        await self._session.commit()
        count = int(result.rowcount or 0)
        log.info(
            "resolve_pending_done",
            ref_type=ref_type,
            ref_id=ref_id,
            resolved=count,
        )
        return count

    # ── 读路径 ────────────────────────────────────────────────────────────

    async def list_for_user(
        self,
        *,
        user_id: uuid.UUID,
        limit: int = 20,
        offset: int = 0,
        unread_only: bool = False,
    ) -> tuple[list[Notification], int]:
        """本人通知列表（``created_at DESC``）+ 总数，供分页。"""
        conditions = [Notification.recipient_user_id == user_id]
        if unread_only:
            conditions.append(Notification.read_at.is_(None))

        rows = (
            (
                await self._session.execute(
                    select(Notification)
                    .where(*conditions)
                    .order_by(Notification.created_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            )
            .scalars()
            .all()
        )

        total = (
            await self._session.execute(
                select(func.count()).select_from(Notification).where(*conditions)
            )
        ).scalar_one()
        return list(rows), int(total)

    async def unread_count(self, *, user_id: uuid.UUID) -> int:
        """本人未读数（徽标轮询/首载）。"""
        count = (
            await self._session.execute(
                select(func.count())
                .select_from(Notification)
                .where(
                    Notification.recipient_user_id == user_id,
                    Notification.read_at.is_(None),
                )
            )
        ).scalar_one()
        return int(count)

    async def mark_read(self, *, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification:
        """单条标记已读；非本人或不存在 → raise NotificationNotFound。"""
        row = (
            await self._session.execute(
                select(Notification).where(
                    Notification.id == notification_id,
                    Notification.recipient_user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotificationNotFound("通知不存在或无权访问")
        if row.read_at is None:
            row.read_at = datetime.now(UTC)
            await self._session.commit()
            await self._session.refresh(row)
        return row

    async def mark_all_read(self, *, user_id: uuid.UUID) -> int:
        """全部已读，返回更新行数。"""
        result = await self._session.execute(
            update(Notification)
            .where(
                Notification.recipient_user_id == user_id,
                Notification.read_at.is_(None),
            )
            .values(read_at=datetime.now(UTC))
        )
        await self._session.commit()
        return int(result.rowcount or 0)

    # ── 内部 ──────────────────────────────────────────────────────────────

    async def _has_unresolved(self, ref_type: str, ref_id: str, type: str) -> bool:
        """幂等存在性检查：同 (ref_type, ref_id, type) 且未读的行是否存在。"""
        existing = (
            await self._session.execute(
                select(Notification.id)
                .where(
                    Notification.ref_type == ref_type,
                    Notification.ref_id == ref_id,
                    Notification.type == type,
                    Notification.read_at.is_(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return existing is not None

    async def _deliver(self, rows: list[Notification]) -> None:
        """逐通道 best-effort 投递：任何通道异常仅 log.warning 不上抛（D-006@v1）。"""
        for channel in self._channels:
            try:
                await channel.deliver(rows)
            except Exception:
                log.warning(
                    "notification_channel_deliver_failed",
                    channel=type(channel).__name__,
                    rows=len(rows),
                )
