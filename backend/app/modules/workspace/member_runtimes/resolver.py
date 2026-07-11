"""``MemberBindingResolver`` — single dispatch-time entry for per-member binding.

``resolve_runtime_for_writeback`` — 写回链路共享 runtime 解析（D-001@v1 /
D-004@v1，2026-07-05-daemon-client-change-binding-fix task-01）。
"""

from __future__ import annotations

import uuid
from typing import NoReturn

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.workspace.member_runtimes.exceptions import MemberBindingNotFound
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

log = get_logger(__name__)


class MemberBindingResolver:
    """Lookup a member's binding row at dispatch time."""

    @staticmethod
    async def resolve_member_binding(
        session: AsyncSession,
        workspace_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> WorkspaceMemberRuntime:
        """Return the binding row for ``(workspace_id, actor_user_id)``.

        Raises :class:`MemberBindingNotFound` (409) when no row exists.
        """
        row = await session.get(WorkspaceMemberRuntime, (workspace_id, actor_user_id))
        if row is None:
            raise MemberBindingNotFound(workspace_id=workspace_id, user_id=actor_user_id)
        return row


async def _raise_no_session(
    workspace_id: uuid.UUID,
    message: str,
    *,
    reason: str,
    enabled: list[str] | None = None,
) -> NoReturn:
    """统一抛 ``DaemonClientNoActiveSession``（AppError HTTP 400，code
    DAEMON_CLIENT_NO_SESSION）。reason 区分场景（§6），enabled 携带引导信息。
    """
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession

    details: dict = {"workspace_id": str(workspace_id), "reason": reason}
    if enabled is not None:
        details["enabled_providers"] = enabled
    raise DaemonClientNoActiveSession(message, details=details)


async def resolve_runtime_for_writeback(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    """Resolve an online runtime for writeback dispatch (D-001@v1).

    与 ``RunPlacementService._resolve_dispatch_runtime`` 同语义，但不接受 caller
    provider override（写回始终用 ``workspace.default_agent``）。复用
    :mod:`workspace.member_runtimes.queries` 的三个共享查询（D-004@v1）。

    解析顺序（2026-07-10-remove-server-local-workspace-mode 起 daemon-client 唯一）：
    1. per-member binding 行存在 → daemon_id + workspace.default_agent 现算。
    2. 无 binding 行 → 直接报 ``not_bound``（legacy ``workspaces.daemon_runtime_id``
       fallback 已删，D-005：不再回退到 workspace 级别 runtime id）。

    所有失败均抛 ``DaemonClientNoActiveSession``（AppError HTTP 400，
    code ``DAEMON_CLIENT_NO_SESSION``），``details.reason`` 区分场景（§6）：
    ``not_bound`` / ``daemon_offline`` / ``default_agent_unset`` /
    ``provider_unavailable``。**不偷偷 fallback** 到其他 provider（与派发 D-008 一致）。

    Returns:
        runtime dict（与 placement 同 shape：``id`` / ``user_id`` / ``provider`` /
        ``status`` / ``daemon_instance_id``）。调用方用 ``id`` 填 ``runtime_id``。
    """
    from app.modules.workspace.member_runtimes.queries import (
        get_daemon_enabled_providers,
        query_daemon_online_by_id,
        query_runtime_by_daemon_and_provider,
    )

    # ------------------------------------------------------------------
    # per-member binding（唯一链路）
    # ------------------------------------------------------------------
    try:
        binding = await MemberBindingResolver.resolve_member_binding(session, workspace_id, user_id)
    except MemberBindingNotFound:
        binding = None
    except Exception as exc:
        log.warning(
            "writeback_resolve_member_binding_unexpected_error",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            error=str(exc),
        )
        binding = None

    if binding is None:
        # 无 binding 行即真未绑定（legacy workspace.daemon_runtime_id fallback 已删，
        # D-005；不再回退，直接引导用户重绑）。
        await _raise_no_session(workspace_id, "未绑定守护进程，请重绑", reason="not_bound")

    daemon_id = binding.daemon_id
    if daemon_id is None:
        # 旧 binding 行尚未迁移 daemon_id—指引用户重绑（D-004 过渡期）。
        await _raise_no_session(workspace_id, "未绑定守护进程，请重绑", reason="not_bound")

    did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id

    # daemon 实体必须在线且属于该 user。
    daemon = await query_daemon_online_by_id(session, did, user_id)
    if daemon is None:
        await _raise_no_session(
            workspace_id,
            "绑定的守护进程离线或不存在，请启动后重试",
            reason="daemon_offline",
        )

    # 写回始终用 workspace.default_agent（不接受 caller override，D-001@v1）。
    ws_data = (
        (
            await session.execute(
                text("SELECT default_agent FROM workspaces WHERE id = :id"),
                {"id": workspace_id.hex},
            )
        )
        .mappings()
        .first()
    )
    target_provider = ws_data["default_agent"] if ws_data else None

    rt = await query_runtime_by_daemon_and_provider(session, did, target_provider)
    if rt is not None:
        return rt

    # 无匹配 runtime → 报错并带 enabled providers 引导（D-008，不 fallback）。
    enabled = await get_daemon_enabled_providers(session, did)
    if target_provider:
        msg = f"守护进程已启用 {enabled}，但未启用 default_agent '{target_provider}'"
        await _raise_no_session(workspace_id, msg, reason="provider_unavailable", enabled=enabled)
    msg = f"守护进程已启用 {enabled}，但未设置 default_agent，请在工作区设置中配置"
    await _raise_no_session(workspace_id, msg, reason="default_agent_unset", enabled=enabled)
