"""grants 授权查询三件套（task-02 / design §5 Phase 2 / §7 / D-006@v1）。

迁移后授权唯一判定源 = ``daemon_runtime_grants``（design §5 Phase 1），本模块
提供三条纯查询供下游统一切换（本卡零接线，调用方切换归 task-03/06/07）：

1. :func:`authorize_pinned_runtime` —— 会话钉定 runtime 的授权判定
   （task-03 session/service.py owner 短路之后调用）。**owner 分支归调用方**
   （design §5 Phase 2「owner 短路 → authorize_pinned_runtime」）：本函数只判
   platform_grant / workspace_grant，自有 runtime 由调用方先行短路走原路径，
   故本函数的 ``kind`` 不含 ``owner``。D-012@v1（验收审查 gap-2）：platform
   分支命中一律返回 ``None``——共享的是智能体而非裸 runtime，直接钉定
   pinned_runtime（不带共享档案）会绕过 task-05 强制（cwd/写约束/工具集），
   在此 404 封堵；共享 runtime 唯一入口=task-05 档案检测（其下发走
   ``pinned_skip_owner_check=True``，不经本函数）。
2. :func:`list_machines_shared_to_me` —— 「共享给我的」机器列表装配
   （task-07 machines/runtimes-page 响应 ``shared_to_me`` 数据源；task-13
   起每行附带 runtime 明细 ``runtimes``，会话创建按 runtime 粒度）。
   D-013@v1（验收审查 gap-1）：成员资格之上逐 grantee 工作区判
   ``daemon:borrow`` 权限（FR-01 GWT-3 双条件，口径同 authorize 的
   workspace 分支）。
3. :func:`resolve_granted_daemon_for_borrow` —— agent-run 借用回退解析
   （task-06 替换 ``resolve_shared_daemon_for_borrow``），SQL 语义逐条等价：
   enabled↔shared=TRUE、daemon_instance_id 非空（模型 NOT NULL 结构保证）、
   granted_by≠actor↔user_id<>actor、grantee_id=workspace_id↔同工作区成员、
   daemon 在线；provider 非空严格匹配否则取最近心跳在线 runtime。

三函数均不改任何写路径；grants 空表时 authorize/list 返回 None/空列表、
borrow 返回 None——存量行为零变化（design §9 兼容策略）。
"""

from __future__ import annotations

import uuid
from typing import Literal, NamedTuple

from sqlalchemy import Exists, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.auth.model import User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

log = get_logger(__name__)


class PlatformBinding(NamedTuple):
    """platform grant 的钉定绑定（design §7 / D-002@v2，契约保留位）。

    D-012@v2 起 authorize_pinned_runtime 不再有 platform 分支（授权统一 workspace 判定）
    （直传钉定封堵），本类型不再由 authorize 产出——task-05 档案检测命中后的
    强制覆写（cwd=source_workspace.root_path + 写约束 [writable_dir]）由
    session/service 的 ``_PlatformSessionBinding`` 承载；保留为 design §7
    provides 契约位。
    """

    agent_profile_id: uuid.UUID
    source_workspace_id: uuid.UUID
    pinned_runtime_id: uuid.UUID
    writable_dir: str | None


class GrantAuthorization(NamedTuple):
    """authorize_pinned_runtime 的判定结果（provides 契约，字段名钦定）。

    - ``kind``：命中分支，类型上仅 "platform_grant" / "workspace_grant"——
      owner 短路归调用方，未授权一律返回 ``None``（调用方维持现有 404 语义）。
      D-012@v1 起 platform 分支命中也返回 ``None``（直传钉定封堵），实际仅
      产生 "workspace_grant"；"platform_grant" 枚举保留为契约位（design §7）。
    - ``platform_binding``：契约保留字段（design §7 PlatformBinding）；D-012@v1
      后 platform 授权不经本函数（唯一入口=task-05 档案检测），恒 ``None``。
    """

    kind: Literal["platform_grant", "workspace_grant"]
    grant_id: uuid.UUID
    lender_user_id: uuid.UUID
    platform_binding: PlatformBinding | None = None


class SharedMachineRuntimeRow(NamedTuple):
    """共享机器的 runtime 明细行（task-13 provides 契约，字段名钦定）。

    会话创建按 runtime 粒度（机器+引擎），机器级 grant 的视图需携带该机器的
    runtime 清单供前端锁 runtime_id / picker 第二步选引擎；``online`` 与机器级
    同口径（status == "online"，权威源 runtime.status）。
    """

    runtime_id: uuid.UUID
    provider: str | None
    online: bool


class SharedMachineRow(NamedTuple):
    """list_machines_shared_to_me 的行契约（provides，字段名钦定）。

    ``display_name`` = machine 别名（display_alias）回退 hostname；
    ``online`` 取机器权威在线源 daemon_instances.status（D-002）；
    ``runtimes`` = 该机器 daemon_runtimes 明细（task-13 契约补齐，按 provider
    升序稳定排序；0-runtime 机器为空 tuple）。
    """

    machine_id: uuid.UUID
    display_name: str
    lender_display_name: str | None
    source_workspace_id: uuid.UUID | None
    online: bool
    runtimes: tuple[SharedMachineRuntimeRow, ...] = ()


class BorrowResolution(NamedTuple):
    """resolve_granted_daemon_for_borrow 的三元组契约（provides，字段名钦定）。

    NamedTuple 兼容 design §7 的 tuple 形态解包与字段名访问；``runtime`` 为
    ORM 对象（user_id 即 lender，与原 runtime dict 的 lender 语义一致）。
    """

    runtime: DaemonRuntime
    lender_user_id: uuid.UUID
    grant_id: uuid.UUID


def _member_of_grantee_workspace(actor_user_id: uuid.UUID) -> Exists:
    """actor 在 grant 的 grantee 工作区的成员资格（EXISTS 子查询）。

    用 EXISTS 而非 JOIN：user_workspace_roles 复合 PK 允许同一用户在同一工作区
    持多角色，JOIN 会按角色数放大 grant 行；EXISTS 天然去重且命中
    ix_uwr_user / ix_uwr_workspace 索引。子查询自动关联外层 grants 行。
    """
    return exists().where(
        col(UserWorkspaceRole.workspace_id) == DaemonRuntimeGrant.grantee_id,
        col(UserWorkspaceRole.user_id) == actor_user_id,
    )


async def authorize_pinned_runtime(
    session: AsyncSession,
    *,
    actor_user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
) -> GrantAuthorization | None:
    """判定 actor 能否钉定 ``runtime_id`` 建会话（design §5 Phase 2 / §7）。

    判定顺序（owner 短路归调用方；D-012@v2 起单一路径）：

    1. **workspace_grant**：runtime 所属机器有 enabled workspace grant，且
       actor 是 grantee 工作区成员（user_workspace_roles），且持
       ``Permission.DAEMON_BORROW``（has_permission，含 platform_admin 短路，
       先例 borrow_resolver:103-110），且 daemon 在线，且 granted_by≠actor
       （永不「借用」自己共享的机器）。
    2. 未命中 → ``None``（调用方维持现有 404，不泄露存在性）。裸 platform
       grant 的 pinned_runtime 直用（无 workspace 授权、不带共享档案）同样
       落此默认拒绝（D-012 封堵目标不变）；带共享档案的 platform 会话唯一
       入口=task-05 档案检测（``pinned_skip_owner_check=True``，不经本函数）。

    Args:
        session: 数据库会话。
        actor_user_id: 会话创建者（owner 短路已由调用方完成）。
        runtime_id: 请求钉定的 runtime id。
        workspace_id: 会话工作区上下文（可为 None，如个人 quick-chat）；
            仅作 has_permission 的权限作用域，成员资格以 grant 的 grantee
            工作区为准。

    Returns:
        GrantAuthorization 或 None（runtime 不存在 / 未授权）。
    """
    # runtime 定位：行不存在或未挂机器（daemon_instance_id NULL 为迁移期遗留）
    # 一律 None——调用方 404 语义与现状逐字节一致（design §9）。
    runtime = (
        (await session.execute(select(DaemonRuntime).where(col(DaemonRuntime.id) == runtime_id)))
        .scalars()
        .first()
    )
    if runtime is None or runtime.daemon_instance_id is None:
        return None

    # ── D-012@v2（quick-5aaefe0e，用户实测 404）：授权统一走 workspace grant 判定 ──
    # v1 的 platform 分支「命中即 None」误伤门户正常形态——会话门户「选机器+选引擎」
    # 产出的请求就是无档案直传 runtime_id（preContext.runtimeId），若该 runtime 恰被
    # 平台共享智能体钉定（同机常见），早退把有效的 workspace 授权一并封死（180024
    # 实测 Runtime not found）。v2 语义：platform grant 不在本函数单独封堵——
    # 授权与否完全由 workspace 分支判定：有 workspace grant + 成员 + daemon:borrow
    # → 按借用会话放行（FR-02 正常语义，审计/借用标记照旧）；无任何授权 → None
    # （裸 platform runtime 直用仍 404，v1 的封堵目标由「默认拒绝」达成）。
    # task-05 档案路径不受影响（_detect_platform_profile_binding 命中走
    # pinned_skip_owner_check=True，不经本函数，强制项完整）。

    # ── workspace grant（权限 → 成员 → enabled → 在线 → 非本人）────────────
    # 权限闸先行（fail fast，三重校验顺序「权限 → shared → online」先例
    # borrow_resolver）；actor 行不存在视同无权限。
    user = await session.get(User, actor_user_id)
    if user is None:
        return None
    allowed = await has_permission(
        session,
        user=user,
        permission=Permission.DAEMON_BORROW,
        workspace_id=workspace_id,
    )
    if not allowed:
        return None

    workspace_grant = (
        (
            await session.execute(
                select(DaemonRuntimeGrant)
                .join(
                    DaemonInstance,
                    DaemonInstance.id == DaemonRuntimeGrant.daemon_instance_id,
                )
                .where(
                    col(DaemonRuntimeGrant.grantee_type) == "workspace",
                    col(DaemonRuntimeGrant.enabled).is_(True),
                    col(DaemonRuntimeGrant.granted_by_user_id) != actor_user_id,
                    col(DaemonRuntimeGrant.daemon_instance_id) == runtime.daemon_instance_id,
                    col(DaemonInstance.status) == "online",
                    _member_of_grantee_workspace(actor_user_id),
                )
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if workspace_grant is None:
        return None
    return GrantAuthorization(
        kind="workspace_grant",
        grant_id=workspace_grant.id,
        lender_user_id=workspace_grant.granted_by_user_id,
        platform_binding=None,
    )


async def list_machines_shared_to_me(
    session: AsyncSession,
    *,
    actor_user_id: uuid.UUID,
) -> list[SharedMachineRow]:
    """列出共享给 actor 的机器（design §5 Phase 2 / §7，task-07 数据源）。

    装配规则：workspace 类型 + enabled 的 grant，经 EXISTS 校验 actor 是
    grantee 工作区成员，**且在 grantee 工作区持 ``daemon:borrow`` 权限**
    （D-013@v1，验收审查 gap-1：FR-01 GWT-3 成员资格+权限双条件——逐
    grantee 工作区 has_permission 判定，口径同 authorize_pinned_runtime 的
    workspace 分支，无权限的 grant 行整行剔除）；join daemon_instances 取
    机器状态、join users 取 lender 显示名。platform grant 不进本列表
    （grantee_id=NULL 无成员资格语义，平台共享智能体走 shared-agents
    选择器，Non-Goal 不混排）。

    task-13：每行附带该机器的 runtime 明细（``runtimes``）——会话创建按
    runtime 粒度，前端锁 runtime_id / picker 选引擎需要机器→引擎清单。二次
    查询一次 IN 本页 machine_ids（N+1 规避，对齐 list_machines 先例），按
    provider 升序保证输出稳定可测。

    排序 hostname → machine_id → lender，保证分页/快照稳定可测。
    """
    actor = await session.get(User, actor_user_id)
    if actor is None:
        return []

    rows = (
        await session.execute(
            select(DaemonRuntimeGrant, DaemonInstance, User)
            .join(
                DaemonInstance,
                DaemonInstance.id == DaemonRuntimeGrant.daemon_instance_id,
            )
            .join(User, User.id == DaemonRuntimeGrant.granted_by_user_id)
            .where(
                col(DaemonRuntimeGrant.grantee_type) == "workspace",
                col(DaemonRuntimeGrant.enabled).is_(True),
                _member_of_grantee_workspace(actor_user_id),
            )
            .order_by(
                col(DaemonInstance.hostname),
                col(DaemonRuntimeGrant.daemon_instance_id),
                col(DaemonRuntimeGrant.granted_by_user_id),
            )
        )
    ).all()

    # ── D-013@v1（验收审查 gap-1）：daemon:borrow 权限过滤（FR-01 GWT-3）────
    # 成员资格之上逐 grantee 工作区判 daemon:borrow（has_permission 复用
    # authorize workspace 分支同源判定，含 platform_admin / 平台级角色短路）；
    # 无权限的 grant 行整行剔除——「可见」与「可借用」权限口径对齐，无权限
    # 成员不提前获知共享事实。platform_admin 恒持全权限（has_permission 首判
    # 短路），免逐工作区往返。
    if not actor.is_platform_admin:
        permitted_ws: set[uuid.UUID] = set()
        for grantee_id in {grant.grantee_id for grant, _inst, _user in rows}:
            if grantee_id is None:
                continue
            if await has_permission(
                session,
                user=actor,
                permission=Permission.DAEMON_BORROW,
                workspace_id=grantee_id,
            ):
                permitted_ws.add(grantee_id)
        rows = [row for row in rows if row[0].grantee_id in permitted_ws]

    # ── task-13：runtime 明细二次查询（IN machine_ids，一次往返）──────────────
    machine_ids = [instance.id for _grant, instance, _user in rows]
    runtimes_by_machine: dict[uuid.UUID, list[DaemonRuntime]] = {}
    if machine_ids:
        runtime_rows = (
            (
                await session.execute(
                    select(DaemonRuntime)
                    .where(col(DaemonRuntime.daemon_instance_id).in_(machine_ids))
                    .order_by(
                        col(DaemonRuntime.daemon_instance_id),
                        col(DaemonRuntime.provider),
                    )
                )
            )
            .scalars()
            .all()
        )
        for runtime in runtime_rows:
            runtimes_by_machine.setdefault(runtime.daemon_instance_id, []).append(runtime)

    return [
        SharedMachineRow(
            machine_id=grant.daemon_instance_id,
            display_name=(instance.display_alias or instance.hostname),
            lender_display_name=user.display_name,
            source_workspace_id=grant.grantee_id,
            online=instance.status == "online",
            runtimes=tuple(
                SharedMachineRuntimeRow(
                    runtime_id=runtime.id,
                    provider=runtime.provider,
                    online=runtime.status == "online",
                )
                for runtime in runtimes_by_machine.get(instance.id, [])
            ),
        )
        for grant, instance, user in rows
    ]


async def resolve_granted_daemon_for_borrow(
    session: AsyncSession,
    *,
    actor_user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    provider: str | None,
) -> BorrowResolution | None:
    """解析工作区共享 daemon 供借用派发（design §5 Phase 2 / §9 等价红线）。

    与原 ``resolve_shared_daemon_for_borrow``（member_runtimes/queries.py:171）
    SQL 语义逐条等价，仅数据源从 binding 换 grants 并额外携带 grant_id：

    ====================  ==============================  =========================
    原查询（wmr）          本查询（grants）                说明
    ====================  ==============================  =========================
    shared = TRUE          enabled = TRUE                  撤销=停用（软开关）
    daemon_id IS NOT NULL  daemon_instance_id NOT NULL     模型层结构保证
    user_id <> actor       granted_by_user_id <> actor     永不借自己
    wmr.workspace_id=:wid  grantee_id = :wid + actor 成员  同工作区（成员防御加固）
    di.status='online'     di.status='online'              lender daemon 可达
    ====================  ==============================  =========================

    provider 解析同派发链路（D-05）：非空严格匹配，None 取该机器最近心跳的
    在线 runtime（``last_heartbeat_at DESC NULLS LAST LIMIT 1``）。

    本函数只做数据解析不查权限——权限闸由调用方 helper（borrow_resolver）
    先行完成（fail fast，与原分工一致）。

    Returns:
        ``(runtime, lender_user_id, grant_id)``，或 None（无生效共享 / 离线 /
        无匹配 provider / actor 非成员 / 查询异常——异常吞掉返回 None 对齐
        原查询契约，调用方抛原 NoOnlineDaemonError）。
    """
    try:
        grant = (
            (
                await session.execute(
                    select(DaemonRuntimeGrant)
                    .join(
                        DaemonInstance,
                        DaemonInstance.id == DaemonRuntimeGrant.daemon_instance_id,
                    )
                    .where(
                        col(DaemonRuntimeGrant.grantee_type) == "workspace",
                        col(DaemonRuntimeGrant.grantee_id) == workspace_id,
                        col(DaemonRuntimeGrant.enabled).is_(True),
                        col(DaemonRuntimeGrant.granted_by_user_id) != actor_user_id,
                        col(DaemonInstance.status) == "online",
                        _member_of_grantee_workspace(actor_user_id),
                    )
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if grant is None:
            return None

        # provider 解析（与 query_runtime_by_daemon_and_provider 同语义改写为
        # ORM select；不复用原函数避免 task-06 薄壳化后出现模块互相 import 环）。
        runtime_stmt = (
            select(DaemonRuntime)
            .where(
                col(DaemonRuntime.daemon_instance_id) == grant.daemon_instance_id,
                col(DaemonRuntime.status) == "online",
            )
            .order_by(col(DaemonRuntime.last_heartbeat_at).desc().nulls_last())
            .limit(1)
        )
        if provider:
            runtime_stmt = runtime_stmt.where(col(DaemonRuntime.provider) == provider)
        runtime = (await session.execute(runtime_stmt)).scalars().first()
        if runtime is None:
            return None

        # runtime.user_id 即 lender（机器归属人=共享者），与原 dict["user_id"]
        # 语义一致；ORM Uuid(as_uuid=True) 两方言下均为 uuid.UUID，无需归一化。
        return BorrowResolution(
            runtime=runtime,
            lender_user_id=runtime.user_id,
            grant_id=grant.id,
        )
    except Exception as exc:  # 对齐原查询吞异常返回 None 契约（dispatch 回退兜底）
        log.warning(
            "resolve_granted_daemon_for_borrow_failed",
            workspace_id=str(workspace_id),
            actor_user_id=str(actor_user_id),
            provider=provider,
            error=str(exc),
        )
        return None
