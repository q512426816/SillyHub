"""平台共享智能体 CRUD + 五重创建校验（task-04 / design §5 Phase 3）。

会话模式照 ``workspace/member_runtimes/service.py`` 先例：模块级 async 函数、
``AsyncSession`` 作首参、service 直接读写 task-01 的 ``DaemonRuntimeGrant`` 表
（platform 行 = grantee_type="platform" + grantee_id=None + 四绑定列非空 +
enabled 默认 true）。

五重创建校验（全部 4xx 拒绝，顺序照任务卡）：
1. pinned_runtime 存在且属当前管理员 user_id 名下且在线（D-003@v1）；
2. writable_dir 非空且 ⊆ 该 runtime 的 allowed_roots（D-002@v2，路径归一化
   比较——Windows 兼容：分隔符统一 ``/``、去尾斜杠、大小写折叠）；
3. source_workspace 存在且未软删；
4. 档案存在且 visibility=platform；非 platform 时仅显式 promote_visibility=true
   才升级并在响应提示（R-05 禁止静默升级私有档案为全员可见）；
5. 同 daemon_instance + platform 类型不重复（D-008@v1 唯一约束防重复；SQLite
   下 NULLS NOT DISTINCT 被方言忽略退化普通 UNIQUE（NULL≠NULL 不拦截），故
   service 层先做应用级查重，IntegrityError 兜底转 409）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.grants.schema import (
    SharedAgentActiveView,
    SharedAgentCreateRequest,
)
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace

log = get_logger(__name__)


# ── 领域错误（对齐 change_write_router 的本包错误定义风格）──────────────────


class SharedAgentGrantNotFound(AppError):
    """patch/delete 目标行不存在或非 platform 行 → 404（不向本端点暴露 workspace 行）。"""

    code = "HTTP_404_SHARED_AGENT_NOT_FOUND"
    http_status = 404


class SharedAgentRuntimeNotFound(AppError):
    code = "HTTP_404_SHARED_AGENT_RUNTIME_NOT_FOUND"
    http_status = 404


class SharedAgentProfileNotFound(AppError):
    code = "HTTP_404_SHARED_AGENT_PROFILE_NOT_FOUND"
    http_status = 404


class SharedAgentWorkspaceNotFound(AppError):
    code = "HTTP_404_SHARED_AGENT_WORKSPACE_NOT_FOUND"
    http_status = 404


class SharedAgentRuntimeNotOwned(AppError):
    """D-003@v1：共享智能体只能钉定管理员自己名下的 runtime → 403。"""

    code = "HTTP_403_SHARED_AGENT_RUNTIME_NOT_OWNED"
    http_status = 403


class SharedAgentWritableDirInvalid(AppError):
    """D-002@v2：writable_dir 为空 / 越出 runtime.allowed_roots → 400。"""

    code = "HTTP_400_SHARED_AGENT_WRITABLE_DIR_INVALID"
    http_status = 400


class SharedAgentPromoteRequired(AppError):
    """R-05：档案非 platform 可见且未显式 promote_visibility=true → 400。"""

    code = "HTTP_400_SHARED_AGENT_PROMOTE_REQUIRED"
    http_status = 400


class SharedAgentRuntimeOffline(AppError):
    """D-003@v1：钉定 runtime 当前不在线（状态冲突）→ 409。"""

    code = "HTTP_409_SHARED_AGENT_RUNTIME_OFFLINE"
    http_status = 409


class SharedAgentRuntimeNoInstance(AppError):
    """runtime 未绑定守护进程实体（迁移期 nullable 过渡残留）→ 409，无法落 grant 行。"""

    code = "HTTP_409_SHARED_AGENT_RUNTIME_NO_INSTANCE"
    http_status = 409


class SharedAgentDuplicate(AppError):
    """D-008@v1：同 daemon + platform 类型 + 同管理员已有共享行 → 409。"""

    code = "HTTP_409_SHARED_AGENT_DUPLICATE"
    http_status = 409


# ── 路径归一化（writable_dir ⊆ allowed_roots 比较，Windows 兼容）────────────


def _norm_path_key(path: str) -> str:
    """路径归一化比较键：统一分隔符 / 去尾斜杠 / 折叠重复斜杠 / 大小写折叠。

    Windows 兼容（CLAUDE.md 规则 13）：盘符与路径大小写不敏感、``\\`` 与 ``/``
    等价。POSIX 侧大小写折叠只是放宽创建期校验——真正写强制在会话链路
    （task-05 overlay ∩ daemon.allowed_roots + daemon 沙箱 fail-closed），此处
    不承担最终防线。存库保留原始字符串，归一化仅用于比较。
    """
    s = path.strip().replace("\\", "/")
    while "//" in s:
        s = s.replace("//", "/")
    return s.rstrip("/").casefold()


def _is_within(child: str, parent: str) -> bool:
    """child 是否 ⊆ parent（归一化后相等或按路径段前缀包含）。

    段边界保护：``/tmp/abc123`` 不算 ⊆ ``/tmp/abc``（前缀必须是完整段）。
    """
    c = _norm_path_key(child)
    p = _norm_path_key(parent)
    if not p:
        # parent 归一化后为根（如 "/"）：任何绝对路径都落在其下。
        return c.startswith("/") or c == ""
    return c == p or c.startswith(p + "/")


def _writable_dir_within_roots(writable_dir: str, allowed_roots: list[str] | None) -> bool:
    """writable_dir ⊆ 任一 allowed_root 即通过（roots 为空列表 = 不允许任何写目录）。"""
    if not writable_dir or not writable_dir.strip():
        return False
    return any(_is_within(writable_dir, root) for root in allowed_roots or [])


# ── 内部工具 ────────────────────────────────────────────────────────────────


async def _get_platform_grant(session: AsyncSession, grant_id: uuid.UUID) -> DaemonRuntimeGrant:
    """取 platform 行；不存在 / 非 platform 行统一 404（workspace 行不经本端点管理）。"""
    grant = await session.get(DaemonRuntimeGrant, grant_id)
    if grant is None or grant.grantee_type != "platform":
        raise SharedAgentGrantNotFound(
            f"共享智能体 '{grant_id}' 不存在。",
            details={"grant_id": str(grant_id)},
        )
    return grant


# ── 创建（五重校验）────────────────────────────────────────────────────────


async def create_shared_agent(
    session: AsyncSession,
    *,
    admin_user_id: uuid.UUID,
    payload: SharedAgentCreateRequest,
) -> tuple[DaemonRuntimeGrant, bool]:
    """创建平台共享智能体行。返回 ``(grant, visibility_promoted)``。

    五重校验全过才落行；档案升级与 grant 写入同一事务（单 commit），失败整体
    回滚（不会出现「档案升了 platform 但 grant 没建」的半状态）。
    """
    # ── 校验 1：runtime 存在 + 属管理员自己名下 + 在线（D-003@v1）──────────
    runtime = await session.get(DaemonRuntime, payload.pinned_runtime_id)
    if runtime is None:
        raise SharedAgentRuntimeNotFound(
            f"守护进程 runtime '{payload.pinned_runtime_id}' 不存在。",
            details={"pinned_runtime_id": str(payload.pinned_runtime_id)},
        )
    if runtime.user_id != admin_user_id:
        raise SharedAgentRuntimeNotOwned(
            "平台共享智能体只能钉定你自己名下的守护进程 runtime。",
            details={"pinned_runtime_id": str(payload.pinned_runtime_id)},
        )
    if (runtime.status or "") != "online":
        raise SharedAgentRuntimeOffline(
            f"守护进程 runtime 当前不在线（status={runtime.status}），无法共享。",
            details={"pinned_runtime_id": str(payload.pinned_runtime_id)},
        )
    if runtime.daemon_instance_id is None:
        raise SharedAgentRuntimeNoInstance(
            "该 runtime 未绑定守护进程实体，无法创建共享授权行。",
            details={"pinned_runtime_id": str(payload.pinned_runtime_id)},
        )

    # ── 校验 2：writable_dir 非空且 ⊆ runtime.allowed_roots（D-002@v2）──────
    if not _writable_dir_within_roots(payload.writable_dir, runtime.allowed_roots):
        raise SharedAgentWritableDirInvalid(
            "共享输出目录必须位于该 runtime 的 allowed_roots 内。",
            details={
                "writable_dir": payload.writable_dir,
                "allowed_roots": runtime.allowed_roots or [],
            },
        )

    # ── 校验 3：source_workspace 存在且未软删 ─────────────────────────────
    workspace = await session.get(Workspace, payload.source_workspace_id)
    if workspace is None or workspace.deleted_at is not None:
        raise SharedAgentWorkspaceNotFound(
            f"源码工作区 '{payload.source_workspace_id}' 不存在或已删除。",
            details={"source_workspace_id": str(payload.source_workspace_id)},
        )

    # ── 校验 4：档案存在 + visibility 非 platform 须显式 promote（R-05）─────
    profile = await session.get(AgentProfile, payload.agent_profile_id)
    if profile is None:
        raise SharedAgentProfileNotFound(
            f"智能体档案 '{payload.agent_profile_id}' 不存在。",
            details={"agent_profile_id": str(payload.agent_profile_id)},
        )
    promoted = False
    if profile.visibility != AgentProfileVisibility.PLATFORM:
        if not payload.promote_visibility:
            raise SharedAgentPromoteRequired(
                "该档案不是平台可见（platform）档案；如需共享给全体用户，"
                "请显式传 promote_visibility=true 升级档案可见性。",
                details={
                    "agent_profile_id": str(payload.agent_profile_id),
                    "current_visibility": str(profile.visibility),
                },
            )
        profile.visibility = AgentProfileVisibility.PLATFORM
        session.add(profile)
        promoted = True

    # ── 校验 5：同 daemon + platform + 同管理员不重复（D-008@v1）────────────
    dup = (
        (
            await session.execute(
                select(DaemonRuntimeGrant)
                .where(col(DaemonRuntimeGrant.grantee_type) == "platform")
                .where(col(DaemonRuntimeGrant.grantee_id).is_(None))
                .where(col(DaemonRuntimeGrant.daemon_instance_id) == runtime.daemon_instance_id)
                .where(col(DaemonRuntimeGrant.granted_by_user_id) == admin_user_id)
            )
        )
        .scalars()
        .first()
    )
    if dup is not None:
        raise SharedAgentDuplicate(
            "该守护进程上你已创建过平台共享智能体，请勿重复创建。",
            details={
                "daemon_instance_id": str(runtime.daemon_instance_id),
                "existing_grant_id": str(dup.id),
            },
        )

    grant = DaemonRuntimeGrant(
        daemon_instance_id=runtime.daemon_instance_id,
        grantee_type="platform",
        grantee_id=None,
        granted_by_user_id=admin_user_id,
        agent_profile_id=payload.agent_profile_id,
        source_workspace_id=payload.source_workspace_id,
        pinned_runtime_id=payload.pinned_runtime_id,
        writable_dir=payload.writable_dir,
        enabled=True,
    )
    session.add(grant)
    try:
        await session.commit()
    except IntegrityError as exc:
        # 兜底：应用级查重与插入之间的竞态由 PG 唯一约束拦截（NULLS NOT DISTINCT，
        # D-008@v1）；SQLite 测试方言不拦 NULL 重复，靠上方查重覆盖。
        await session.rollback()
        raise SharedAgentDuplicate(
            "该守护进程上你已创建过平台共享智能体，请勿重复创建。",
            details={"daemon_instance_id": str(runtime.daemon_instance_id)},
        ) from exc
    await session.refresh(grant)
    if promoted:
        log.info(
            "shared_agent_profile_promoted",
            grant_id=str(grant.id),
            agent_profile_id=str(payload.agent_profile_id),
        )
    return grant, promoted


# ── 管理端查询 / 写操作 ─────────────────────────────────────────────────────


async def list_shared_agents(session: AsyncSession) -> list[DaemonRuntimeGrant]:
    """管理端全量列表（含停用行），按创建时间稳定排序。"""
    stmt = (
        select(DaemonRuntimeGrant)
        .where(col(DaemonRuntimeGrant.grantee_type) == "platform")
        .order_by(col(DaemonRuntimeGrant.created_at), col(DaemonRuntimeGrant.id))
    )
    return list((await session.execute(stmt)).scalars().all())


async def set_shared_agent_enabled(
    session: AsyncSession,
    *,
    grant_id: uuid.UUID,
    enabled: bool,
) -> DaemonRuntimeGrant:
    """PATCH：仅改 enabled（停用 = 撤销共享但不删行，语义对齐 enabled 软开关）。"""
    grant = await _get_platform_grant(session, grant_id)
    grant.enabled = enabled
    grant.updated_at = datetime.now(UTC)
    session.add(grant)
    await session.commit()
    await session.refresh(grant)
    return grant


async def delete_shared_agent(session: AsyncSession, *, grant_id: uuid.UUID) -> None:
    """DELETE：物理删行（对齐任务卡「delete（物理删）」；审计行无 FK 不受影响）。"""
    grant = await _get_platform_grant(session, grant_id)
    await session.delete(grant)
    await session.commit()


# ── active 公共摘要 ─────────────────────────────────────────────────────────


async def list_active_shared_agents(session: AsyncSession) -> list[SharedAgentActiveView]:
    """生效摘要：enabled 的 platform 行 + 档案显示字段 + 钉定 runtime 在线状态。

    LEFT JOIN 容错：grants 的绑定列无 FK 硬约束（task-01 模型按 design §8 多态
    无 FK），档案/runtime 行缺失时 display_name/provider 落 None、runtime_online
    落 False（管理员可见降级行，R-04 前端据此提示离线/异常）。
    """
    stmt = (
        select(DaemonRuntimeGrant, AgentProfile, DaemonRuntime)
        .outerjoin(AgentProfile, col(AgentProfile.id) == DaemonRuntimeGrant.agent_profile_id)
        .outerjoin(DaemonRuntime, col(DaemonRuntime.id) == DaemonRuntimeGrant.pinned_runtime_id)
        .where(col(DaemonRuntimeGrant.grantee_type) == "platform")
        .where(col(DaemonRuntimeGrant.enabled).is_(True))
        .order_by(col(DaemonRuntimeGrant.created_at), col(DaemonRuntimeGrant.id))
    )
    rows = (await session.execute(stmt)).all()
    views: list[SharedAgentActiveView] = []
    for grant, profile, runtime in rows:
        views.append(
            SharedAgentActiveView(
                id=grant.id,
                agent_profile_id=grant.agent_profile_id,
                display_name=getattr(profile, "name", None),
                provider=getattr(profile, "provider", None),
                runtime_online=(runtime is not None and (runtime.status or "") == "online"),
            )
        )
    return views
