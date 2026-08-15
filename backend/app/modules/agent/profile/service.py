"""AgentProfile 配置层服务（CRUD + 三级 visibility + 兜底链 + 交集计算）。

Change ``2026-08-02-agent-profile-layer`` task-03 / design §4（配置三层交集）/§8
（兜底链）。本模块是 profile 域的纯服务层，不碰 HTTP——router（task-04）负责
参数翻译与依赖注入。

设计要点（与 design / decisions 对齐）：

* **三级 visibility（D-009）**：``private`` 仅 owner 可见可用；``workspace`` 该
  workspace 成员可见；``platform`` 全平台可见但**仅 admin 可建/改**。鉴权复用
  现有 RBAC：admin 判定走 ``User.is_platform_admin``（auth/rbac.py has_permission
  的短路条件），workspace member 判定走 ``user_workspace_roles`` 表存在性查询。
* **软约束兜底链 resolve_profile（§8/D-005）**：run 显式 → workspace 默认 → 平台
  默认（按 provider 选 is_system_default 预置档案）→ None。**不硬阻断**：任一档
  缺失/不可见即向下一档回退，全无返回 None（dispatch 走原路径，design §5 不变量）。
* **effective_allowed_roots（§4/D-013）**：backend 算 ``daemon ∩ overlay`` 下推。
  overlay 为空 → 返回 daemon 原值；非空 → 服务端校验 overlay⊆daemon，**超集抛
  AppError**（agent 只能收紧不能放宽）。
* **不存密钥（design §10 红线 / D-004）**：本服务不读写任何 API Key / MCP 凭证，
  凭证留 ``LlmProvider(user_id)`` 与 daemon 本地。
* **version（D-003）**：每次 update +1；create/copy 起始 1。

异常风格沿用项目 ``AppError`` 模式（``app.core.errors``）。本任务 allowed_paths
仅 service.py，故 profile 专属错误类（404/403/400）定义在本模块内，router 直接
import 即可（task-04）。
"""

from __future__ import annotations

import uuid
from typing import Any, NamedTuple

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.auth.model import User, UserWorkspaceRole
from app.modules.workspace.model import Workspace

# ────────────────────────────────────────────────────────────────────────────
# Profile 专属错误（定义在 service 内，因 task-03 allowed_paths 仅 service.py）
# ────────────────────────────────────────────────────────────────────────────


class AgentProfileNotFound(AppError):
    """档案不存在（或已删除）。"""

    code = "HTTP_404_AGENT_PROFILE_NOT_FOUND"
    http_status = 404


class AgentProfilePermissionDenied(AppError):
    """actor 对该档案无可见/可改权限（三级 visibility 校验失败）。"""

    code = "HTTP_403_AGENT_PROFILE_PERMISSION_DENIED"
    http_status = 403


class AgentProfileOverlayTooWide(AppError):
    """``allowed_roots_overlay`` 超出 daemon 物理沙箱（D-013，agent 只能收紧）。

    details 携带越界路径，便于前端/接口定位。
    """

    code = "HTTP_400_AGENT_PROFILE_OVERLAY_TOO_WIDE"
    http_status = 400

    def __init__(self, message: str, *, extra_roots: list[str]) -> None:
        super().__init__(message, details={"extra_roots": extra_roots})


# ────────────────────────────────────────────────────────────────────────────
# 可更新字段白名单（update 校验用）。visibility/workspace_id 的敏感改动另作 guard。
# ────────────────────────────────────────────────────────────────────────────

_ALLOWED_UPDATE_KEYS: frozenset[str] = frozenset(
    {
        "name",
        "provider",
        "model",
        "system_prompt",
        "tool_policy_id",
        "llm_provider_id",
        "mcp_refs",
        "skill_refs",
        "allowed_roots_overlay",
        "visibility",
        "workspace_id",
    }
)


def _normalize_provider(provider: str | None) -> str | None:
    """归一化 provider 字符串，对齐平台预置档案与 workspace.default_agent 命名差异。

    预置档案 provider 为 ``claude`` / ``codex``（迁移 seed），而 workspace
    .default_agent / dispatch target_provider 习惯写 ``claude_code``。本函数把
    ``claude_code`` / ``claude-code`` 归一为 ``claude``，``codex`` 保持不变，使
    resolve_profile 第三档能稳定命中预置档案。其它值原样返回。
    """
    if provider is None:
        return None
    lowered = provider.lower()
    if lowered in ("claude_code", "claude-code"):
        return "claude"
    return lowered


class VisibleProfile(NamedTuple):
    """``list_visible_all`` 的返回项：可见档案 + 归属工作区名（展示用）。

    跨工作区聚合视图（design §7.1）需要展示「档案属于哪个工作区」，而
    :class:`AgentProfile` 本身只存 ``workspace_id``。本结构由 service 批量 join
    workspace 表填名后返回，避免 router 层 N+1 查询。
    """

    profile: AgentProfile
    workspace_name: str | None


class AgentProfileService:
    """AgentProfile 配置层服务。

    构造接收一个 :class:`AsyncSession`（对齐 ``RunPlacementService(session)``
    范式）。所有方法假设调用方已认证 actor；本服务只负责 visibility 鉴权与数据
    读写，不签发 token、不读 request。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ────────────────────────────────────────────────────────────────────────
    # 内部鉴权 helper
    # ────────────────────────────────────────────────────────────────────────

    async def _is_workspace_member(self, *, user_id: uuid.UUID, workspace_id: uuid.UUID) -> bool:
        """``True`` iff ``user_id`` 在 ``workspace_id`` 持有任意角色行。

        复用 RBAC 表 ``user_workspace_roles`` 的存在性判定（与
        :func:`app.modules.auth.rbac.collect_permissions` 同表）。任何角色行即视为
        member——visibility 校验只关心「是否成员」不关心具体角色权限粒度。
        """
        stmt = (
            select(col(UserWorkspaceRole.user_id))
            .where(col(UserWorkspaceRole.user_id) == user_id)
            .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first() is not None

    def _can_read(self, profile: AgentProfile, *, actor: User) -> bool:
        """三级 visibility 读可见性判定（D-009）。

        注：``AgentProfileVisibility`` 为 ``StrEnum``，DB 经 SA 列读回的是裸字符串
        （SQLModel 不在 ORM load 路径做强转），故比较用 ``==`` 不用 ``is``——StrEnum
        成员与其 ``.value`` 字符串 ``==`` 成立。
        """
        if actor.is_platform_admin:
            return True
        if profile.visibility == AgentProfileVisibility.PLATFORM.value:
            # 全平台可见
            return True
        if profile.visibility == AgentProfileVisibility.WORKSPACE.value:
            # workspace_id 必须非空且 actor 是其成员——成员判定异步，由调用处做；
            # 本函数只做同步能判的部分（owner 短路），成员判定返回 need_member 标记。
            # 成员判定在 caller 用 _is_workspace_member 补。
            return profile.owner_user_id == actor.id
        # PRIVATE
        return profile.owner_user_id == actor.id

    async def _can_read_async(self, profile: AgentProfile, *, actor: User) -> bool:
        """读可见性判定的异步版（WORKSPACE 级补一次成员查询）。"""
        if self._can_read(profile, actor=actor):
            return True
        # _can_read 已过滤 admin / platform / owner 短路；剩 WORKSPACE 非 owner 分支
        if (
            profile.visibility == AgentProfileVisibility.WORKSPACE.value
            and profile.workspace_id is not None
        ):
            return await self._is_workspace_member(
                user_id=actor.id, workspace_id=profile.workspace_id
            )
        return False

    async def _can_modify(self, profile: AgentProfile, *, actor: User) -> bool:
        """三级 visibility 改权限判定。

        * platform / is_system_default：仅 admin（平台预置档案全平台只读，仅 admin
          可改/删）。
        * workspace：owner 或该 workspace 成员。
        * private：仅 owner。
        * admin 短路：platform_admin 一律放行（与 rbac.has_permission 一致）。
        """
        if actor.is_platform_admin:
            return True
        if profile.visibility == AgentProfileVisibility.PLATFORM.value or profile.is_system_default:
            return False
        if profile.visibility == AgentProfileVisibility.WORKSPACE.value:
            if profile.owner_user_id == actor.id:
                return True
            if profile.workspace_id is not None:
                return await self._is_workspace_member(
                    user_id=actor.id, workspace_id=profile.workspace_id
                )
            return False
        # PRIVATE
        return profile.owner_user_id == actor.id

    async def _assert_can_modify(self, profile: AgentProfile, *, actor: User) -> None:
        if not await self._can_modify(profile, actor=actor):
            raise AgentProfilePermissionDenied(
                "当前用户无权修改该 agent 档案。",
                details={"profile_id": str(profile.id)},
            )

    async def _load_visible(self, *, profile_id: uuid.UUID, actor: User) -> AgentProfile | None:
        """加载并校验读可见性；不可见/不存在均返回 None（供兜底链软回退用）。"""
        profile = await self._session.get(AgentProfile, profile_id)
        if profile is None:
            return None
        if not await self._can_read_async(profile, actor=actor):
            return None
        return profile

    # ────────────────────────────────────────────────────────────────────────
    # CRUD
    # ────────────────────────────────────────────────────────────────────────

    async def create(
        self,
        *,
        name: str,
        visibility: AgentProfileVisibility,
        provider: str,
        actor: User,
        workspace: Workspace | None = None,
        model: str | None = None,
        system_prompt: str | None = None,
        tool_policy_id: uuid.UUID | None = None,
        llm_provider_id: uuid.UUID | None = None,
        mcp_refs: list[str] | None = None,
        skill_refs: list[str] | None = None,
        allowed_roots_overlay: list[str] | None = None,
    ) -> AgentProfile:
        """新建档案。visibility 决定 workspace_id 归属与建案权：

        * ``platform``：仅 admin 可建，workspace_id=None。
        * ``workspace``：actor 必须是 ``workspace`` 的成员，workspace_id=workspace.id。
        * ``private``：任何已认证 actor 可建（owner=actor），workspace_id=None。

        新档案 ``is_system_default`` 恒为 False（预置档案仅 seed/startup 产生，
        task-01/task-11），``version`` 起始 1。
        """
        # 建案权鉴权（传入的 visibility 是枚举成员，与 .value 比较兼容）
        if visibility == AgentProfileVisibility.PLATFORM:
            if not actor.is_platform_admin:
                raise AgentProfilePermissionDenied(
                    "仅平台管理员可以创建平台级可见的 agent 档案。",
                )
            ws_id: uuid.UUID | None = None
        elif visibility == AgentProfileVisibility.WORKSPACE:
            if workspace is None:
                raise AgentProfilePermissionDenied(
                    "创建工作区级档案时必须指定所属工作区。",
                )
            if not await self._is_workspace_member(user_id=actor.id, workspace_id=workspace.id):
                raise AgentProfilePermissionDenied(
                    "仅工作区成员可以创建工作区级 agent 档案。",
                    details={"workspace_id": str(workspace.id)},
                )
            ws_id = workspace.id
        else:  # PRIVATE
            ws_id = None

        profile = AgentProfile(
            name=name,
            owner_user_id=actor.id,
            workspace_id=ws_id,
            visibility=visibility,
            provider=provider,
            model=model,
            system_prompt=system_prompt,
            tool_policy_id=tool_policy_id,
            llm_provider_id=llm_provider_id,
            mcp_refs=list(mcp_refs) if mcp_refs else [],
            skill_refs=list(skill_refs) if skill_refs else [],
            allowed_roots_overlay=list(allowed_roots_overlay) if allowed_roots_overlay else None,
            version=1,
            is_system_default=False,
        )
        self._session.add(profile)
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def list(
        self,
        *,
        actor: User,
        workspace: Workspace | None = None,
    ) -> list[AgentProfile]:
        """列出 actor 可见的档案。

        可见集合 = 平台全档 ∪（给定 workspace 时：该 ws 的 workspace 级档案且 actor
        是其成员）∪ actor 自己的 private 档案。不给 ``workspace`` 时不返回任何
        workspace 级档案（它们归属于具体 workspace，跨 ws 不可见）。
        """
        clauses = [
            col(AgentProfile.visibility) == AgentProfileVisibility.PLATFORM.value,
            and_(
                col(AgentProfile.visibility) == AgentProfileVisibility.PRIVATE.value,
                col(AgentProfile.owner_user_id) == actor.id,
            ),
        ]
        if workspace is not None and await self._is_workspace_member(
            user_id=actor.id, workspace_id=workspace.id
        ):
            clauses.append(
                and_(
                    col(AgentProfile.visibility) == AgentProfileVisibility.WORKSPACE.value,
                    col(AgentProfile.workspace_id) == workspace.id,
                )
            )

        stmt = select(AgentProfile).where(or_(*clauses)).order_by(col(AgentProfile.name).asc())
        rows = (await self._session.execute(stmt)).scalars().all()
        return list(rows)

    async def list_visible_all(self, *, actor: User) -> list[VisibleProfile]:
        """列出 actor 跨工作区可见的全部档案（聚合视图用，design §7.1 / D-004）。

        可见集合 = actor 自己的所有 private（跨 ws，``owner_user_id=actor``）∪ actor
        所属各工作区的 workspace 级档 ∪ 全部 platform 级档 ∪ 系统预置档。

        与 :meth:`list` 的关键差异：**不拼 ws clause**，而是查全表后逐档用
        :meth:`_can_read_async` 判定。owner-left-ws 边界（R-07）下，WORKSPACE 级档
        对 owner 仍可见（``_can_read`` 对 owner 短路，不查成员，与 :meth:`get`
        一致）；而 :meth:`list` 的 ws clause 拼接法按成员过滤，owner 离开后该档
        不在其可见集内。

        platform/系统预置档按 id 去重（防御同一物理档被多次命中）。``workspace_name``
        批量预取（单次 ``IN`` 查询）避免 N+1。

        **不读写任何密钥**（design §10 红线）；纯加法，不改现有 CRUD 契约。
        """
        stmt = select(AgentProfile).order_by(col(AgentProfile.name).asc())
        rows = (await self._session.execute(stmt)).scalars().all()

        seen: set[uuid.UUID] = set()
        visible: list[AgentProfile] = []
        for profile in rows:
            if profile.id in seen:
                continue
            if await self._can_read_async(profile, actor=actor):
                seen.add(profile.id)
                visible.append(profile)

        # 批量预取 workspace 名映射（避免逐档 N+1）
        ws_ids: set[uuid.UUID] = {p.workspace_id for p in visible if p.workspace_id is not None}
        name_map: dict[uuid.UUID, str] = {}
        if ws_ids:
            ws_stmt = select(Workspace.id, Workspace.name).where(col(Workspace.id).in_(ws_ids))
            for wid, wname in (await self._session.execute(ws_stmt)).all():
                name_map[wid] = wname

        return [
            VisibleProfile(
                profile=p,
                workspace_name=(
                    name_map.get(p.workspace_id) if p.workspace_id is not None else None
                ),
            )
            for p in visible
        ]

    async def get(self, *, profile_id: uuid.UUID, actor: User) -> AgentProfile:
        """取单档。不存在 → 404；存在但不可见 → 403。"""
        profile = await self._session.get(AgentProfile, profile_id)
        if profile is None:
            raise AgentProfileNotFound(
                "指定的 agent 档案不存在或已被删除。",
                details={"profile_id": str(profile_id)},
            )
        if not await self._can_read_async(profile, actor=actor):
            raise AgentProfilePermissionDenied(
                "当前用户无权查看该 agent 档案。",
                details={"profile_id": str(profile_id)},
            )
        return profile

    async def update(
        self,
        *,
        profile_id: uuid.UUID,
        actor: User,
        fields: dict[str, Any],
    ) -> AgentProfile:
        """部分更新。仅 ``_ALLOWED_UPDATE_KEYS`` 内字段生效；每次更新 ``version += 1``。

        改权限沿用 :meth:`_can_modify`。若把 ``visibility`` 改为 ``platform`` 或把
        ``workspace_id`` 改到别的 workspace，额外要求 admin（防越权提权到平台级 /
        跨 ws 移动）。未知字段抛 ``ValueError``（防 router 拼错键静默丢弃）。
        """
        unknown = set(fields) - _ALLOWED_UPDATE_KEYS
        if unknown:
            raise ValueError(f"unknown_agent_profile_fields:{sorted(unknown)}")

        profile = await self.get(profile_id=profile_id, actor=actor)
        await self._assert_can_modify(profile, actor=actor)

        # 提权守卫：目标 visibility=platform 必须由 admin 操作。
        target_visibility = fields.get("visibility")
        if target_visibility is AgentProfileVisibility.PLATFORM and not actor.is_platform_admin:
            raise AgentProfilePermissionDenied(
                "仅平台管理员可以将档案可见范围改为平台级。",
                details={"profile_id": str(profile_id)},
            )
        # 跨 workspace 移动同样要求 admin（防成员把档案挪到自己 ws 外）。
        target_ws_id = fields.get("workspace_id")
        if (
            target_ws_id is not None
            and target_ws_id != profile.workspace_id
            and not actor.is_platform_admin
        ):
            raise AgentProfilePermissionDenied(
                "仅平台管理员可以在工作区之间移动 agent 档案。",
                details={"profile_id": str(profile_id)},
            )

        # 应用字段。StrEnum 列存 String，直接赋枚举成员会经 model 落 .value。
        for key, value in fields.items():
            setattr(profile, key, value)

        profile.version = int(profile.version) + 1
        await self._session.commit()
        await self._session.refresh(profile)
        return profile

    async def delete(self, *, profile_id: uuid.UUID, actor: User) -> None:
        """删除。改权限同 update（platform/系统默认仅 admin；private 仅 owner；
        workspace owner 或成员）。系统默认档案被删后由 startup hook 补种（task-11）。"""
        profile = await self.get(profile_id=profile_id, actor=actor)
        await self._assert_can_modify(profile, actor=actor)
        await self._session.delete(profile)
        await self._session.commit()

    async def copy(
        self,
        *,
        profile_id: uuid.UUID,
        actor: User,
        name: str | None = None,
        visibility: AgentProfileVisibility | None = None,
        workspace: Workspace | None = None,
    ) -> AgentProfile:
        """复制源档案内容到 actor 名下的新档案（Non-Goals：复制替代 N:N 活引用共享）。

        源档案经 :meth:`get` 读校验（须可见）。新档案 owner=actor、
        ``is_system_default=False``、``version=1``；默认 ``private`` + 无 workspace，
        调用方可指定 ``visibility`` / ``workspace``（建案权经 :meth:`create` 复用）。
        复制内容：provider/model/system_prompt/tool_policy_id/mcp_refs/skill_refs/
        allowed_roots_overlay（不复制 name/owner/workspace/visibility/version）。
        """
        source = await self.get(profile_id=profile_id, actor=actor)
        return await self.create(
            name=name or f"{source.name}（副本）",
            visibility=visibility or AgentProfileVisibility.PRIVATE,
            provider=source.provider,
            actor=actor,
            workspace=workspace,
            model=source.model,
            system_prompt=source.system_prompt,
            tool_policy_id=source.tool_policy_id,
            llm_provider_id=source.llm_provider_id,
            mcp_refs=list(source.mcp_refs),
            skill_refs=list(source.skill_refs),
            allowed_roots_overlay=list(source.allowed_roots_overlay)
            if source.allowed_roots_overlay
            else None,
        )

    # ────────────────────────────────────────────────────────────────────────
    # 软约束兜底链（design §8 / D-005）
    # ────────────────────────────────────────────────────────────────────────

    async def resolve_profile(
        self,
        *,
        run_profile_id: uuid.UUID | None,
        workspace: Workspace,
        actor: User,
        default_provider: str | None = None,
    ) -> AgentProfile | None:
        """解析 dispatch 使用的 AgentProfile，四级兜底（不硬阻断）：

        1. ``run_profile_id`` 显式指定 → 加载（须可见），命中即返回。
        2. 否则 ``workspace.default_agent_profile_id`` → 加载（须可见），命中即返回。
        3. 否则按 provider 选平台预置档案（``is_system_default=True`` 且
           ``visibility=platform``），provider 归一化后匹配（见 :func:`_normalize_provider`）。
        4. 全无 → 返回 None（dispatch 回退 ``workspace.default_agent`` 原路径）。

        任一档「不存在 / 不可见」均向下一档回退（软约束，design §8 / D-005）。
        ``default_provider`` 优先于 ``workspace.default_agent`` 作为第三档 provider
        来源（dispatch 解析出的 target_provider 直接传入更精确）。
        """
        # 1. run 显式
        if run_profile_id is not None:
            hit = await self._load_visible(profile_id=run_profile_id, actor=actor)
            if hit is not None:
                return hit

        # 2. workspace 默认档案
        if workspace.default_agent_profile_id is not None:
            hit = await self._load_visible(
                profile_id=workspace.default_agent_profile_id, actor=actor
            )
            if hit is not None:
                return hit

        # 3. 平台预置档案（按 provider）
        provider = _normalize_provider(default_provider or workspace.default_agent)
        if provider is not None:
            stmt = (
                select(AgentProfile)
                .where(col(AgentProfile.is_system_default).is_(True))
                .where(col(AgentProfile.visibility) == AgentProfileVisibility.PLATFORM.value)
                .where(col(AgentProfile.provider) == provider)
                .limit(1)
            )
            row = (await self._session.execute(stmt)).scalars().first()
            if row is not None:
                return row

        # 4. 全无 → None
        return None

    # ────────────────────────────────────────────────────────────────────────
    # effective_allowed_roots（design §4 / D-013）——纯函数
    # ────────────────────────────────────────────────────────────────────────

    @staticmethod
    def compute_effective_allowed_roots(
        daemon_allowed_roots: list[str],
        profile_overlay: list[str] | None,
    ) -> list[str]:
        """``effective = daemon.allowed_roots ∩ profile.allowed_roots_overlay``。

        * ``profile_overlay`` 为 None 或空 → 返回 ``daemon_allowed_roots`` 原值
          （不叠加 overlay，design §4）。
        * 非空 → 服务端校验 ``overlay ⊆ daemon_allowed_roots``；存在越界路径（超集）
          抛 :class:`AgentProfileOverlayTooWide`（agent 只能收紧不能放宽，D-013）。
        * 校验通过返回交集（按 daemon 顺序保留），即 overlay 在 daemon 范围内的子集。
        """
        if not profile_overlay:
            return list(daemon_allowed_roots)
        daemon_set: set[str] = set(daemon_allowed_roots)
        overlay_set: set[str] = set(profile_overlay)
        extra = sorted(overlay_set - daemon_set)
        if extra:
            raise AgentProfileOverlayTooWide(
                "档案目录白名单超出了守护进程允许的访问范围（agent 只能收紧"
                "不能放宽），请移除越界路径后重试。",
                extra_roots=extra,
            )
        # overlay ⊆ daemon 已证；交集按 daemon 顺序保留（= overlay 的有序投影）。
        return [r for r in daemon_allowed_roots if r in overlay_set]
