"""Borrow resolver — unified own-or-borrowed runtime resolution helper.

Change 2026-07-25-daemon-borrow-for-business task-05 / D-002@v1 / D-008@v1 / FR-04。

``_resolve_borrowed_or_own_runtime`` 是 4 路派发 resolver 的统一入口（D-008）：

  - ``RunPlacementService._resolve_dispatch_runtime``（agent/placement.py:690-807，主派发）
  - ``RunPlacementService._resolve_decide_runtime``（agent/placement.py:855-944，决策预检）
  - ``resolve_runtime_for_writeback``（workspace/member_runtimes/resolver.py:59-150，写回）
  - ``RunPlacementService._get_online_runtime``（agent/placement.py:408，interactive quick-chat）

收敛到单一 helper 避免「decide 通过但 dispatch 报错」语义割裂（R-01，重现当年 D-007）。
两步语义：

  1. 先查 actor 自己的 member binding → 有在线自有 daemon 就返回（零回归原路径，
     design §9 兼容策略；自有 daemon 路径完全不变）。
  2. 无在线自有 daemon → DAEMON_BORROW 权限闸 → resolve_shared_daemon_for_borrow
     → 返回借用 runtime + lender_user_id。

三重校验顺序：权限 → shared → online（权限不通过不查 shared daemon，fail fast）。
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.workspace.member_runtimes.queries import (
    query_daemon_online_by_id,
    query_runtime_by_daemon_and_provider,
    resolve_shared_daemon_for_borrow,
)
from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

log = get_logger(__name__)


async def _resolve_borrowed_or_own_runtime(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    provider: str | None,
) -> tuple[dict | None, bool, uuid.UUID | None]:
    """Resolve an online runtime for dispatch, borrowing when the actor has no own.

    Change 2026-07-25-daemon-borrow-for-business task-05 / D-002@v1 / D-008@v1。
    actor 有在线自有 daemon 走原路径（零回归），无则回退借用工作空间共享 daemon
    （业务/管理人员场景，design §5 Phase 3）。

    解析步骤：
      1. **自有路径（零回归）**：查 actor 的 member binding
         （:func:`MemberBindingResolver.resolve_member_binding`）→ ``daemon_id`` 非空
         + daemon 在线 + 属于 actor + 有匹配 provider 的在线 runtime → 返回
         ``(runtime_dict, False, None)``。runtime dict shape 与 placement 现有
         ``{id, user_id, provider, status, daemon_instance_id}``（placement.py:793）
         一致，调用方零改造消费。
      2. **借用路径**：无在线自有 daemon → 校验 actor 有 ``DAEMON_BORROW`` 权限
         （:func:`has_permission`，含 ``platform_admin`` 短路）→ 调
         :func:`resolve_shared_daemon_for_borrow` 解析 shared+online lender daemon →
         返回 ``(runtime_dict, True, lender_user_id)``。

    三重校验顺序（design §5 Phase 3 / D-008）：**权限 → shared → online**。权限闸在
    本函数内、shared/online 查询之前完成；shared + online 在
    :func:`resolve_shared_daemon_for_borrow` 的单条 SQL 内一并校验。

    无在线自有 daemon 且（无 ``DAEMON_BORROW`` 或 无共享/离线 lender）→ 返回
    ``(None, False, None)``，让调用方抛原 ``NoOnlineDaemonError``（不改错误文案，
    design §9 兼容策略）。

    Args:
        session: 数据库会话。
        workspace_id: 工作空间 id（借用边界 = 工作空间成员资格，design §3 非目标）。
        user_id: 操作者 user_id（actor；自有 binding 用此查，借用查询用此排除自己）。
        provider: 期望 provider（claude/codex/...）；``None`` 取任意在线 runtime。

    Returns:
        ``(runtime_dict, borrowed, lender_user_id)``：
          - 自有命中：``(runtime, False, None)``；
          - 借用命中：``(runtime, True, lender_user_id)``（``runtime["user_id"]`` == lender）；
          - 未命中：``(None, False, None)``（调用方抛原 NoOnlineDaemonError）。
    """
    # ── Step 1: 自有路径（零回归原路径，design §9）─────────────────────────
    # 与 _resolve_dispatch_runtime 的自有分支同语义，但**不抛 NoOnlineDaemonError**：
    # 任何缺失（无 binding / daemon_id None / 离线 / 无匹配 runtime）都返回 None，
    # 让上层落到借用回退。自有 daemon 不需要 DAEMON_BORROW 权限。
    own_runtime = await _resolve_own_online_runtime(session, workspace_id, user_id, provider)
    if own_runtime is not None:
        return (own_runtime, False, None)

    # ── Step 2: 借用路径（权限 → shared → online，三重校验）─────────────────
    # 2a. 权限闸：actor 必须有 DAEMON_BORROW（business_member 角色或 platform_admin
    # 短路）。无权限 → 直接返回 None（零回归：未授 business_member 的现有用户行为不变，
    # 调用方抛原 NoOnlineDaemonError）。
    user = await session.get(User, user_id)
    if user is None:
        # actor user_id 在 users 表不存在（不应发生）→ 不借用，让调用方抛错。
        return (None, False, None)
    allowed = await has_permission(
        session,
        user=user,
        permission=Permission.DAEMON_BORROW,
        workspace_id=workspace_id,
    )
    if not allowed:
        return (None, False, None)

    # 2b. shared + online 闸：resolve_shared_daemon_for_borrow 单条 SQL 内一并校验
    # （shared=TRUE AND daemon_id IS NOT NULL AND user_id<>actor AND
    # daemon_instances.status='online'）+ provider 解析。命中即借用。
    borrowed_runtime = await resolve_shared_daemon_for_borrow(
        session, workspace_id, user_id, provider
    )
    if borrowed_runtime is None:
        return (None, False, None)

    # runtime dict 的 user_id 即 lender（daemon 归属人 = 共享者）。规范化为 uuid.UUID
    # 供调用方写审计 / lease metadata。SQLite 返回 CHAR(32) hex，PG 返回 uuid.UUID。
    lender_uid_raw = borrowed_runtime.get("user_id")
    if lender_uid_raw is None:
        # daemon_runtime.user_id 列 NOT NULL，此处仅防御性兜底。
        return (None, False, None)
    lender_user_id = (
        lender_uid_raw if isinstance(lender_uid_raw, uuid.UUID) else uuid.UUID(str(lender_uid_raw))
    )
    return (borrowed_runtime, True, lender_user_id)


async def _resolve_own_online_runtime(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    provider: str | None,
) -> dict | None:
    """Step 1 sub-helper: resolve the actor's own online daemon runtime.

    与 ``RunPlacementService._resolve_dispatch_runtime``（placement.py:690-807）的
    自有分支同语义（binding → daemon online + 属于 actor → provider runtime），但
    **不抛 NoOnlineDaemonError**——任何缺失都返回 ``None``，让上层 helper 落到借用
    回退。不查权限（自有 daemon 路径不需要 ``DAEMON_BORROW``）。

    Returns:
        actor 自有的在线 runtime dict，或 ``None``（无 binding / daemon_id None /
        离线 / 不属于 actor / 无匹配 provider 的在线 runtime）。
    """
    binding = await MemberBindingResolver.resolve_member_binding_or_none(
        session, workspace_id, user_id, log_tag="borrow_resolver_own_binding_unexpected_error"
    )
    if binding is None:
        return None

    daemon_id = binding.daemon_id
    if daemon_id is None:
        # 旧 binding 行未迁移 daemon_id（D-004 过渡期）→ 当作无自有 daemon。
        return None
    did = daemon_id if isinstance(daemon_id, uuid.UUID) else uuid.UUID(str(daemon_id))

    # daemon 必须在线且属于 actor（与派发链路同一查询 / D-004）。
    daemon = await query_daemon_online_by_id(session, did, user_id)
    if daemon is None:
        return None

    # 匹配 provider 的在线 runtime；provider=None 取该 daemon 上最近心跳的在线 runtime。
    return await query_runtime_by_daemon_and_provider(session, did, provider)
