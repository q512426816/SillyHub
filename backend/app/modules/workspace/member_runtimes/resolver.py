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

    @staticmethod
    async def resolve_member_binding_or_none(
        session: AsyncSession,
        workspace_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        log_tag: str = "resolve_member_binding_unexpected_error",
    ) -> WorkspaceMemberRuntime | None:
        """Same as :meth:`resolve_member_binding` but return None on miss/error.

        收敛 placement + borrow_resolver 三处同款 try/except 脚手架（2026-07-27 结构优化）。
        MemberBindingNotFound → None（上层走借用兜底 / NoOnlineDaemonError）；
        意外异常 → log.warning(best-effort) + None，不阻断主流程。默认 log_tag 与
        placement 两处一致；borrow_resolver 自有路径传专属 tag 区分来源。
        """
        try:
            return await MemberBindingResolver.resolve_member_binding(
                session, workspace_id, actor_user_id
            )
        except MemberBindingNotFound:
            return None
        except Exception as exc:
            log.warning(
                log_tag,
                workspace_id=str(workspace_id),
                user_id=str(actor_user_id),
                error=str(exc),
            )
            return None


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

    # D-008@v1（task-07）：提前解析 workspace.default_agent，供自有解析 + 借用 helper
    # 共用同一 provider（与 placement._resolve_dispatch_runtime / _resolve_decide_runtime
    # 同语义，4 路一致 / R-01 反割裂）。写回始终用 default_agent（不接受 caller override）。
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
        # D-008@v1（task-07）：无自有 binding → 借用兜底，与 dispatch/decide 同语义。
        # helper 命中借用 runtime（lender daemon 的 runtime dict）即返回——写回到 lender
        # daemon 的 runtime（借用 lease 写回路径解析到 lender runtime，design §5 Phase 3）。
        # 未命中（无 DAEMON_BORROW / 无 shared lender）→ 抛原 DaemonClientNoActiveSession
        # reason=not_bound（文案不变）。懒导入避免与 borrow_resolver 互相 import 循环。
        from app.modules.agent.borrow_resolver import _resolve_borrowed_or_own_runtime

        rt, _borrowed, _lender = await _resolve_borrowed_or_own_runtime(
            session, workspace_id, user_id, target_provider
        )
        if rt is not None:
            return rt
        # 无 binding 行即真未绑定（legacy workspace.daemon_runtime_id fallback 已删，
        # D-005；不再回退，直接引导用户重绑）。
        await _raise_no_session(workspace_id, "未绑定守护进程，请重绑", reason="not_bound")

    daemon_id = binding.daemon_id
    if daemon_id is None:
        # 旧 binding 行尚未迁移 daemon_id—指引用户重绑（D-004 过渡期）。
        # 与 dispatch/decide 同：此分支不接入借用（stale binding 属配置问题）。
        await _raise_no_session(workspace_id, "未绑定守护进程，请重绑", reason="not_bound")

    did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id

    # daemon 实体必须在线且属于该 user。
    daemon = await query_daemon_online_by_id(session, did, user_id)
    if daemon is None:
        # D-008@v1（task-07）：自有 daemon 离线 → 借用兜底，与 dispatch/decide 同语义。
        # 命中借用 runtime 则返回；未命中 → 抛原 daemon_offline（文案不变）。
        from app.modules.agent.borrow_resolver import _resolve_borrowed_or_own_runtime

        rt, _borrowed, _lender = await _resolve_borrowed_or_own_runtime(
            session, workspace_id, user_id, target_provider
        )
        if rt is not None:
            return rt
        await _raise_no_session(
            workspace_id,
            "绑定的守护进程离线或不存在，请启动后重试",
            reason="daemon_offline",
        )

    rt = await query_runtime_by_daemon_and_provider(session, did, target_provider)
    if rt is not None:
        return rt

    # 无匹配 runtime → 报错并带 enabled providers 引导（D-008，不 fallback）。
    # 自有 daemon 在线但缺 default_agent provider：不借用另一台（与 dispatch 同，
    # 避免 silent fallback；优先让用户修 provider 配置）。
    enabled = await get_daemon_enabled_providers(session, did)
    if target_provider:
        msg = f"守护进程已启用 {enabled}，但未启用 default_agent '{target_provider}'"
        await _raise_no_session(workspace_id, msg, reason="provider_unavailable", enabled=enabled)
    msg = f"守护进程已启用 {enabled}，但未设置 default_agent，请在工作区设置中配置"
    await _raise_no_session(workspace_id, msg, reason="default_agent_unset", enabled=enabled)
