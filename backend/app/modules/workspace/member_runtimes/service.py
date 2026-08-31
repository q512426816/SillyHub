"""Workspace member runtime binding CRUD (change 2026-07-01-collaborative-workspace)."""

from __future__ import annotations

import os
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.workspace.member_runtimes.exceptions import MemberBindingNotFound
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

log = get_logger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# 绑定自动并入 allowed_roots（quick ql-20260831-018-dc1a 体验修）
#
# 语义：owner 直绑自己的守护进程时，工作区 root_path 自动并入该 daemon 全部
# runtime 的 allowed_roots——「绑定即可写」，免去先去守护进程页手动配可写目录。
# 共享/借用绑定（daemon.user_id != user_id）不自动加：allowed_roots 是机器主人
# 授予的物理写边界，借用人绑定只是引用，无权自扩。
# ────────────────────────────────────────────────────────────────────────────


def _is_absolute_path_form(p: str) -> bool:
    """绝对路径形态判定（绝对 / ``~`` 开头），口径同 update_allowed_roots 校验。"""
    return p.startswith("~") or p.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", p) is not None


def _root_covers_path(root: str, path: str) -> bool:
    """边界敏感前缀包含：path 等于 root 或位于 root+分隔符 之下。

    Windows 形态（含反斜杠/盘符）大小写不敏感、POSIX 形态敏感——比较口径对齐
    agent/placement.py::path_definitively_outside_roots 的跨平台规则。该函数是
    「可判定越界」语义，与本次「已覆盖」判定不同，不便直接复用，按同规则实现。
    """

    def _win_form(s: str) -> bool:
        return "\\" in s or (len(s) >= 2 and s[0].isalpha() and s[1] == ":")

    win = _win_form(root) or _win_form(path)

    def _norm(s: str) -> str:
        n = os.path.normpath(s)
        n = n.replace("/", "\\") if win else n.replace("\\", "/")
        return n.casefold() if win else n

    norm_root = _norm(root)
    norm_path = _norm(path)
    sep = "\\" if win else "/"
    return norm_path == norm_root or norm_path.startswith(norm_root + sep)


async def _merge_workspace_root_into_owned_daemon_roots(
    session: AsyncSession,
    *,
    daemon: DaemonInstance,
    root_path: str,
) -> list[DaemonRuntime]:
    """把工作区 root_path 并入 daemon 全部 runtime 的 allowed_roots（只写不 commit）。

    - 写 ``runtime.allowed_roots``（派发 effective_roots 与 daemon 心跳 per-runtime
      同步的实际生效源）；不写 instance 级——daemon register 按本机 config 覆盖
      回写 instance.allowed_roots，写了也会被冲掉。
    - 只增不减：非空原值保留后追加；空值（legacy per-runtime 下沉前）先物化
      instance 兜底再追加，绝不收窄现有白名单。
    - 幂等：root_path 已被某条绝对根覆盖（边界敏感 + Windows 大小写不敏感）则
      跳过；``~`` 根 backend 无法展开、不参与前缀覆盖判定，但**精确等值**视为
      已覆盖——重复保存同一路径不二次追加（否则每次 PUT 都会多一条重复项，
      DB JSON 与 policy_update 载荷单调膨胀；追加本身在 daemon 侧同名根幂等
      无害，此判定只为防堆积）。
    - 相对路径（非绝对 / ``~`` 开头）防御性跳过，不阻断绑定本身。
    - 返回被修改的 runtime 行；随调用方（upsert_my_binding）的单次 commit 一并
      落库，commit 后由调用方 best-effort 推送 ``policy_update``。
    """
    if not _is_absolute_path_form(root_path):
        log.debug("binding_root_path_not_absolute_skip_merge", root_path=root_path)
        return []
    runtimes = list(
        (
            await session.execute(
                select(DaemonRuntime).where(
                    col(DaemonRuntime.daemon_instance_id) == daemon.id,
                )
            )
        )
        .scalars()
        .all()
    )
    merged: list[DaemonRuntime] = []
    now = datetime.now(UTC)
    for rt in runtimes:
        current = list(rt.allowed_roots or [])
        if not current:
            # legacy 空值：物化 instance 机器级兜底，语义对齐派发侧回退链
            # （agent/service.py::_apply_profile_to_lease 的 runtime→instance 回退）。
            current = list(daemon.allowed_roots or [])
        if any(
            r == root_path or (not r.startswith("~") and _root_covers_path(r, root_path))
            for r in current
        ):
            continue
        rt.allowed_roots = [*current, root_path]
        rt.updated_at = now
        merged.append(rt)
    return merged


async def _push_policy_updates_for_merged_runtimes(
    daemon_id: uuid.UUID,
    runtimes: list[DaemonRuntime],
) -> None:
    """合并落库后 best-effort 推送 policy_update（对齐 PUT allowed-roots 路由行为）。

    在线 daemon 秒级热更新，避免「绑定后立刻开会话、PolicyCache 未同步导致
    写被拒」的窗口；推送失败仅告警不阻断绑定——离线/异常由 daemon 下一次心跳
    全量 resync 兜底收敛（R-07 语义）。``version`` 从 runtime.updated_at 派生
    epoch 毫秒、单调递增，daemon 侧据此丢弃乱序旧推送（与 daemon/router.py
    _derive_policy_version 同口径，本模块不 import router 私有函数、就地同语义实现）。
    """
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    for rt in runtimes:
        ts = rt.updated_at if rt.updated_at is not None else datetime.now(UTC)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        version = int(ts.timestamp() * 1000)
        try:
            hub = get_daemon_ws_hub()
            await hub.send_policy_update(
                daemon_id,
                list(rt.allowed_roots or []),
                version,
                payload_runtime_id=rt.id,
            )
        except Exception:
            log.warning(
                "binding_allowed_roots_policy_push_failed",
                runtime_id=str(rt.id),
                daemon_id=str(daemon_id),
                exc_info=True,
            )


async def get_my_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> WorkspaceMemberRuntime | None:
    """Return the member's binding row, or None if not configured."""
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    return row


async def upsert_my_binding(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    daemon_id: uuid.UUID | None,
    root_path: str,
    path_source: str,
) -> tuple[WorkspaceMemberRuntime, bool]:
    """Upsert a member's binding row. Returns ``(row, created)``.

    Change 2026-07-03-daemon-entity-binding task-09 (D-004): the binding
    target is ``daemon_id`` (FK→daemon_instances) instead of ``runtime_id``.
    ``runtime_id`` column is preserved nullable but NOT written by this
    function — it retains legacy snapshot data only.

    Raises ``AppError(403)`` if ``daemon_id`` is set but belongs to a
    different user AND is not an enabled workspace-granted online daemon
    (quick-18951370 共享绑定放宽；防跨工作区/跨用户劫持语义不变).

    quick ql-20260831-018-dc1a（体验修）：owner 直绑（daemon 归属本人）时自动把
    ``root_path`` 并入该 daemon 全部 runtime 的 ``allowed_roots``（只增不减、幂等，
    同事务落库 + commit 后 best-effort 推送 policy_update）；共享/借用绑定不自动
    加——allowed_roots 是机器主人授予的物理写边界，借用人不得自扩。
    """
    merged_runtimes: list[DaemonRuntime] = []
    if daemon_id is not None:
        daemon = await session.get(DaemonInstance, daemon_id)
        # quick-18951370（共享绑定）：owner 直绑（原路径零变化）；非 owner 放宽为
        # 「本工作区有 enabled workspace grant 且 daemon 在线」即可绑——业务成员
        # 无自有 daemon 时可直接选用成员共享的守护进程（bind 是引用不是属权）。
        # 无 grant / 离线维持 403（防跨工作区/跨用户劫持语义不变）。
        if daemon is None:
            raise AppError(
                "该守护进程不存在，无法使用。",
                code="daemon_not_owned",
                http_status=403,
            )
        if daemon.user_id != user_id:
            from app.modules.daemon.grants.model import DaemonRuntimeGrant

            shared_ok = (
                (
                    await session.execute(
                        select(DaemonRuntimeGrant).where(
                            col(DaemonRuntimeGrant.daemon_instance_id) == daemon_id,
                            col(DaemonRuntimeGrant.grantee_type) == "workspace",
                            col(DaemonRuntimeGrant.grantee_id) == workspace_id,
                            col(DaemonRuntimeGrant.enabled).is_(True),
                        )
                    )
                )
                .scalars()
                .first()
            )
            if shared_ok is None or daemon.status != "online":
                raise AppError(
                    "该守护进程不属于当前用户，且不是本工作区的在线共享守护进程，无法使用。",
                    code="daemon_not_owned",
                    http_status=403,
                )
        elif daemon.user_id == user_id:
            # owner 直绑：自动并入可写目录（共享绑定走上方 user_id != user_id 分支，
            # 不会到达这里——安全边界由分支结构保证）。
            merged_runtimes = await _merge_workspace_root_into_owned_daemon_roots(
                session,
                daemon=daemon,
                root_path=root_path,
            )

    existing = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    now = datetime.now(UTC)
    if existing:
        # Edit path (D-007): only the editable binding columns change.
        # init_synced_at / init_synced_spec_version are NOT touched here — they
        # are written exclusively by the init-lease complete path (task-07).
        # Changing one's daemon/path must not reset initialization state.
        existing.daemon_id = daemon_id
        existing.root_path = root_path
        existing.path_source = path_source
        existing.updated_at = now
        await session.commit()
        await session.refresh(existing)
        if merged_runtimes and daemon_id is not None:
            await _push_policy_updates_for_merged_runtimes(daemon_id, merged_runtimes)
        return existing, False

    # Create path: init_synced_* start NULL (uninitialized) and remain so until
    # the member's first `init` lease completes (task-07 / task-09 migration).
    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        daemon_id=daemon_id,
        root_path=root_path,
        path_source=path_source,
        init_synced_at=None,
        init_synced_spec_version=None,
        created_at=now,
        updated_at=now,
    )
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    if merged_runtimes and daemon_id is not None:
        await _push_policy_updates_for_merged_runtimes(daemon_id, merged_runtimes)
    return binding, True


async def list_my_bindings(
    session: AsyncSession,
    user_id: uuid.UUID,
) -> list[WorkspaceMemberRuntime]:
    """Return the caller's binding rows across ALL workspaces.

    遗留 1（daemon-entity-binding）：工作区列表卡片不再依赖 ``workspace.daemon_runtime_id``
    （新工作区该列为 NULL），改为按 daemon 实体展示。批量端点一次性拉取当前用户
    在所有工作区的 member binding，前端按 workspace_id 索引，避免列表 N 次请求。
    """
    stmt = select(WorkspaceMemberRuntime).where(col(WorkspaceMemberRuntime.user_id) == user_id)
    return list((await session.execute(stmt)).scalars().all())


async def list_member_bindings(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> list[WorkspaceMemberRuntime]:
    """Return all binding rows for a workspace (owner/admin)."""
    stmt = (
        select(WorkspaceMemberRuntime)
        .where(col(WorkspaceMemberRuntime.workspace_id) == workspace_id)
        .order_by(col(WorkspaceMemberRuntime.user_id))
    )
    return list((await session.execute(stmt)).scalars().all())


# ────────────────────────────────────────────────────────────────────────────
# Daemon 共享标记（change 2026-07-25-daemon-borrow-for-business task-04）
# D-003@v1 / FR-01 / FR-02：lender 把自己的 daemon 标为本工作空间共享，
# 业务/管理人员（business_member）即可借用跑 agent 读源码。撤销 = shared=False，
# 不删 binding 行（lender 配置的 daemon + 路径保留，可随时再标 shared）。
# 默认 false：现有「自带 daemon」binding 行为零回归，仅显式调用端点才置位。
#
# change 2026-08-28-daemon-agent-share task-06（design §5 Phase 2.3 / §9 / R-07）：
# 开关端点改**同事务双写**——``shared`` 列保留为 UI 缓存（不再参与任何鉴权），
# 授权唯一判定源切 ``daemon_runtime_grants``：开 = upsert enabled workspace grant，
# 关/撤销 = 置对应 grant ``enabled=False``（软开关，行保留）。单次 commit 落两处，
# 任一写失败整体回滚（R-07 双写一致性）。
# ────────────────────────────────────────────────────────────────────────────


async def _apply_workspace_grant_toggle(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    lender_user_id: uuid.UUID,
    daemon_id: uuid.UUID | None,
    enabled: bool,
) -> None:
    """开关共享时同步 grants 授权行（task-06 双写的 grants 侧，不 commit）。

    定位唯一键 ``(daemon_instance_id, grantee_type='workspace', grantee_id=workspace_id,
    granted_by_user_id=lender)``（design §8 唯一约束，同工作区多 lender 各自一行）：

    - ``enabled=True``：无行则建（workspace 类型、无 platform 绑定列），有行则复活
      （撤销后重新开共享复用同一行，audit 链 grant_id 稳定）。
    - ``enabled=False``：有行才置 False（软开关，行保留对齐撤销语义）；无行不动。

    ``daemon_id`` 为 NULL（binding 未绑 daemon）时**不开 grant 且不查表**——grants
    授权对象是 daemon 机器，无 daemon 无授权可言（对齐迁移跳过 daemon_id NULL 行，
    design §5 Phase 1 / Grill B-03），``shared`` 列照写保持原行为。

    只写不 commit：与 ``shared`` 列写同处一个事务，由调用方单次 commit 落两处（R-07）。
    """
    if daemon_id is None:
        return

    grant = (
        (
            await session.execute(
                select(DaemonRuntimeGrant).where(
                    col(DaemonRuntimeGrant.daemon_instance_id) == daemon_id,
                    col(DaemonRuntimeGrant.grantee_type) == "workspace",
                    col(DaemonRuntimeGrant.grantee_id) == workspace_id,
                    col(DaemonRuntimeGrant.granted_by_user_id) == lender_user_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if enabled:
        if grant is None:
            session.add(
                DaemonRuntimeGrant(
                    daemon_instance_id=daemon_id,
                    grantee_type="workspace",
                    grantee_id=workspace_id,
                    granted_by_user_id=lender_user_id,
                    enabled=True,
                )
            )
        else:
            grant.enabled = True
            grant.updated_at = datetime.now(UTC)
    elif grant is not None:
        grant.enabled = False
        grant.updated_at = datetime.now(UTC)


async def set_my_binding_shared(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    shared: bool,
) -> WorkspaceMemberRuntime:
    """标记/撤销当前成员自己 binding 的 daemon 共享状态（FR-01 / D-003@v1）。

    lender（开发人员）把自己的 daemon 标为本工作空间共享，业务/管理人员即可
    借用。binding 行必须已存在（先 PUT /my-binding 配 daemon + 路径），否则
    复用既有 ``MemberBindingNotFound``（409）——前端按 code 引导先配置。
    端点无 user_id 路径参数，server 钉死 ``user_id`` → 仅能改自己 binding。

    task-06 同事务双写（R-07）：``shared`` 列（UI 缓存）+ grants 授权行（鉴权源）
    在同一事务内写、单次 commit——开共享 = upsert enabled grant，撤销 = grant
    ``enabled=False``；任一失败两处都不落。``binding.daemon_id`` 为 NULL 时只写
    ``shared`` 列不开 grant（无 daemon 可授权，对齐迁移跳过策略）。
    """
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, user_id))
    if row is None:
        raise MemberBindingNotFound(workspace_id=workspace_id, user_id=user_id)
    # quick-4a55e2dc（防共享的共享）：quick-18951370 放宽绑定后 binding 可指向
    # 他人共享的 daemon（借用绑定）——借用者不得以自己名义再开 workspace grant，
    # 否则原 lender 撤销（自己那行 grant disabled）后借用者的 grant 仍在，
    # 撤销语义被击穿。仅 daemon 归属本人时才允许开/关共享授权。
    if row.daemon_id is not None:
        daemon = await session.get(DaemonInstance, row.daemon_id)
        if daemon is None or daemon.user_id != user_id:
            raise AppError(
                "只能共享自己名下的守护进程；当前绑定的是他人共享的守护进程（借用），不能再次共享。",
                code="daemon_not_owned",
                http_status=403,
            )
    row.shared = shared
    row.updated_at = datetime.now(UTC)
    # grants 侧同事务写（helper 只写不 commit，随下方 commit 一并落库/回滚）。
    await _apply_workspace_grant_toggle(
        session,
        workspace_id=workspace_id,
        lender_user_id=user_id,
        daemon_id=row.daemon_id,
        enabled=shared,
    )
    await session.commit()
    await session.refresh(row)
    return row


async def list_shared_daemons(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """owner 查工作空间所有共享 daemon（FR-02 / D-003@v1）。

    task-06 数据源切 ``daemon_runtime_grants``（design §5 Phase 2.3——鉴权唯一
    判定源）：workspace 类型 + enabled 的 grant，JOIN ``daemon_instances`` 拿在线
    状态 + hostname，供 owner 决定是否撤销。``daemon_id`` NULL 的旧行不再出现
    （grants 不为无 daemon 的 binding 建行，对齐迁移跳过策略）；``shared`` 列
    不再参与查询（UI 缓存，单侧漂移不影响列表正确性——design §9）。

    每行额外携带 ``grant_id``（task-06 provides SharedDaemonsGrantField，撤销
    追溯锚点；design §6「grant_id … consumer=shared-daemons 管理列表」）。
    返回 dict 列表（service 层不引入 pydantic），router 转 SharedDaemonView。
    """
    stmt: Select[Any] = (
        select(
            col(DaemonRuntimeGrant.id).label("grant_id"),
            col(DaemonRuntimeGrant.granted_by_user_id).label("lender_user_id"),
            col(DaemonRuntimeGrant.daemon_instance_id).label("daemon_id"),
            col(DaemonInstance.status).label("daemon_status"),
            col(DaemonInstance.hostname).label("daemon_hostname"),
        )
        .join(DaemonInstance, DaemonInstance.id == DaemonRuntimeGrant.daemon_instance_id)
        .where(col(DaemonRuntimeGrant.grantee_type) == "workspace")
        .where(col(DaemonRuntimeGrant.grantee_id) == workspace_id)
        .where(col(DaemonRuntimeGrant.enabled).is_(True))
        .order_by(col(DaemonRuntimeGrant.granted_by_user_id))
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "grant_id": r.grant_id,
            "lender_user_id": r.lender_user_id,
            "daemon_id": r.daemon_id,
            "daemon_status": r.daemon_status,
            "daemon_hostname": r.daemon_hostname,
        }
        for r in rows
    ]


async def revoke_shared(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
) -> WorkspaceMemberRuntime:
    """owner 撤销某成员 daemon 的共享（FR-02 / D-003@v1）。

    设 ``shared=False``，**不删 binding 行**（lender 配置的 daemon + 路径保留，
    可随时再标 shared）。target 无 binding → ``MemberBindingNotFound``（409）。

    task-06 同事务双写（R-07）：对应 workspace grant 置 ``enabled=False``
    （软开关行保留），撤销后借用立即失效（鉴权只读 grants）。
    """
    row = await session.get(WorkspaceMemberRuntime, (workspace_id, target_user_id))
    if row is None:
        raise MemberBindingNotFound(workspace_id=workspace_id, user_id=target_user_id)
    row.shared = False
    row.updated_at = datetime.now(UTC)
    await _apply_workspace_grant_toggle(
        session,
        workspace_id=workspace_id,
        lender_user_id=target_user_id,
        daemon_id=row.daemon_id,
        enabled=False,
    )
    await session.commit()
    await session.refresh(row)
    return row
