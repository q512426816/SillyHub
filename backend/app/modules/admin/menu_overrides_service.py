"""Menu override service.

Backend business layer of ``/api/menu-overrides`` (change
``2026-09-18-web-menu-management`` task-04). ``menu_overrides`` holds
global display overrides (label / sort_order / hidden) with no role or
user dimension (D-002@v1). ``menu_key`` is NOT validated against the
frontend registry — orphan rows are tolerated and ignored by the
frontend merge layer (R-01).

Audit logging is explicit (upsert / delete both emit
``menu_override.*`` rows into ``audit_logs``), mirroring the
roles_service pattern: the generic SQLAlchemy hook in
:mod:`app.core.audit_hooks` is not wired into the production lifespan,
so we write AuditLog directly. ``menu_overrides`` is display
configuration, not permission data — ``invalidate_all_permissions`` is
intentionally NOT called after writes.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.modules.admin.model import MenuOverride
from app.modules.admin.schema import MenuOverrideRead, MenuOverrideUpsert
from app.modules.workflow.model import AuditLog


def _to_read(override: MenuOverride) -> MenuOverrideRead:
    """ORM → 读 DTO。对外字段名 ``label`` 与列名 ``label_override`` 不同名，
    ``from_attributes`` 不会自动命中，必须显式构造映射。"""
    return MenuOverrideRead(
        menu_key=override.menu_key,
        label=override.label_override,
        sort_order=override.sort_order,
        hidden=override.hidden,
    )


class MenuOverrideService:
    """菜单覆盖的 list / upsert / delete 业务底座（task-05 三端点共用）。

    权限闸在 router 层，本类只管业务规则；构造模式对齐 RoleService
    （session + actor_id）。
    """

    def __init__(self, session: AsyncSession, actor_id: uuid.UUID) -> None:
        self._session = session
        self._actor_id = actor_id

    def _audit(
        self,
        *,
        action: str,
        override: MenuOverride,
        details: dict | None = None,
    ) -> None:
        self._session.info.setdefault(
            "audit_context",
            {
                "actor_id": self._actor_id,
                "workspace_id": None,
            },
        )
        self._session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self._actor_id,
                action=action,
                resource_type="menu_override",
                resource_id=override.id,
                details_json=json.dumps(
                    {"menu_key": override.menu_key, **(details or {})},
                    default=str,
                    ensure_ascii=False,
                ),
                timestamp=datetime.now(UTC),
            )
        )

    async def list_overrides(self) -> list[MenuOverrideRead]:
        """全量覆盖，按 ``menu_key`` 升序（稳定排序）；只读路径 GET 共用。"""
        rows = (
            (
                await self._session.execute(
                    select(MenuOverride).order_by(col(MenuOverride.menu_key).asc())
                )
            )
            .scalars()
            .all()
        )
        return [_to_read(row) for row in rows]

    async def upsert_override(
        self, menu_key: str, payload: MenuOverrideUpsert
    ) -> MenuOverrideRead:
        """按 ``menu_key`` 建行或整行覆盖写。

        PUT 全量语义：``None`` 落 NULL 表示清除该维度回代码默认
        （label / sort_order 落 NULL，hidden 回 False）。全 null 的
        upsert 保留行不删行——整行删除是 delete_override 的语义
        （接口定义：DELETE = 该菜单全部恢复默认）。
        """
        # 防御校验：DTO 层已拦 422（task-02 Field 约束），此处为直连
        # service 的调用方兜底，文案中文（error-message-l10n）。
        if payload.label is not None and not 1 <= len(payload.label) <= 30:
            raise AppError(
                "菜单显示名长度须为 1 到 30 个字符。",
                code="HTTP_400_MENU_LABEL_INVALID",
                http_status=http_status.HTTP_400_BAD_REQUEST,
                details={"menu_key": menu_key, "label": payload.label},
            )
        if payload.sort_order is not None and not 0 <= payload.sort_order <= 999:
            raise AppError(
                "菜单排序值须在 0 到 999 之间。",
                code="HTTP_400_MENU_SORT_ORDER_INVALID",
                http_status=http_status.HTTP_400_BAD_REQUEST,
                details={"menu_key": menu_key, "sort_order": payload.sort_order},
            )

        override = (
            (
                await self._session.execute(
                    select(MenuOverride)
                    .where(col(MenuOverride.menu_key) == menu_key)
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        created = override is None
        if override is None:
            override = MenuOverride(menu_key=menu_key)
            self._session.add(override)

        # 三维度整体落库：null = 清除回默认，hidden 未提供即回 False
        override.label_override = payload.label
        override.sort_order = payload.sort_order
        override.hidden = payload.hidden if payload.hidden is not None else False

        await self._session.flush()
        self._audit(
            action="menu_override.upserted",
            override=override,
            details={
                "created": created,
                "label": override.label_override,
                "sort_order": override.sort_order,
                "hidden": override.hidden,
            },
        )
        await self._session.commit()
        await self._session.refresh(override)
        return _to_read(override)

    async def delete_override(self, menu_key: str) -> None:
        """按 ``menu_key`` 整行删除（该菜单全部恢复默认）。

        行不存在时幂等 no-op（对应端点 204 语义），不写审计——
        无变更即无审计记录，对齐 roles_service「未命中不落审计」惯例。
        """
        override = (
            (
                await self._session.execute(
                    select(MenuOverride)
                    .where(col(MenuOverride.menu_key) == menu_key)
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if override is None:
            return
        self._audit(
            action="menu_override.deleted",
            override=override,
            details={
                "label": override.label_override,
                "sort_order": override.sort_order,
                "hidden": override.hidden,
            },
        )
        await self._session.delete(override)
        await self._session.commit()
