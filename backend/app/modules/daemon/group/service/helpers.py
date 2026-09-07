"""group 子域共享基础（task-09 拆分，原 group/service.py 纯搬移段）。

内容：
- 群错误族（GroupChatNotFound 等 6 个 AppError 子类，404 不泄露存在性口径）；
- 群消息 DTO（GroupMemberTriggerRead / GroupChatPinnedRead 等 7 个读体 +
  ``_group_pinned_snapshot``——schema.py 不在拆分卡 allowed_paths，随服务落包）；
- 跨模块共享的参与者判定（get_group_chat_by_session / get_active_user_membership
  / resolve_shadow_member / get_group_accessible_session，session/file_artifacts/
  router 懒加载复用）+ 昵称校验三件套 + 成员上限常量；
- config_snapshot 组装（_build/_rebuild_config_snapshot，成员 chips 免 N+1）；
- 跨簇常量（SHADOW_DIRECT_SOURCE / GROUP_SESSION_PROVIDER / GROUP_CARRIER_
  SPEC_STRATEGY / GROUP_MEMBER_STAGE——mentions/messages/shadow 经
  from .helpers import 消费）+ 附件摘要/提示行 helper；
- GroupChatService 实例级共享 helper（权限两段式 / 行锁取群 / 成员查询 /
  项目口径 / audience 广播），第一参数传 service 实例（svc）。

D-007：``_gsvc`` 为包命名空间别名——被 patch 或定义于 ``__init__`` 的名字
（log 等）一律经 ``_gsvc.`` 延迟解析。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.group.service as _gsvc
from app.core.errors import AppError
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentSession,
)
from app.modules.agent.schema import (
    GroupChatRead,
    GroupMemberAgentConfig,
    GroupMemberRead,
)
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

# ── 护栏常量（design §9.3：首版保守值，execute 后按实测调）──────────────────
# 每群 agent 成员上限（会话闸共享同一机器，防群内扇出打满 SILLYHUB_MAX_
# ACTIVE_SESSIONS）。
GROUP_AGENT_MEMBER_LIMIT = 8
# 每群用户成员上限（同时防 agent_sessions:changed audience payload 膨胀，
# task-06 消费）。
GROUP_USER_MEMBER_LIMIT = 50
# @路由保留词（design §4.1：@全体/@all 广播触发词，成员昵称不可占用——
# 否则 @解析对「是成员还是广播」产生歧义）。
RESERVED_DISPLAY_NAMES = {"全体", "all"}

# 群会话 provider 占位值（AgentSession.provider NOT NULL；群时间线会话自身
# 不派发 daemon，仅作载体标记——影子会话才落成员真实 provider，task-03）。
GROUP_SESSION_PROVIDER = "group"


# 载体 run 的 spec_strategy 标记（§2：纯载体，无执行语义——区分影子轮的
# 'interactive' 与批量派发策略）。
GROUP_CARRIER_SPEC_STRATEGY = "group_carrier"
# 影子会话 interactive lease 的 stage（§4.3：prepare_interactive_dispatch
# stage 形参 → lease metadata.stage → claim payload → daemon 谓词）。
GROUP_MEMBER_STAGE = "group_member"


# quick 影子直聊（2026-09-02）：本轮 user_input metadata 的 source 标记——
# run_sync 投影判定锚（命中 → 整轮不投影，仅 [[GROUP]] 段例外）。
SHADOW_DIRECT_SOURCE = "shadow_direct"


# quick 群 P1 llm_provider 预检（2026-09-02）：agent 成员 ``llm_provider_id=None``
# 的非阻断提示文案——None=走机器本机默认 LLM 出口（可能可用），建群/加成员
# 不拦截，仅随响应 ``warnings`` 提示前端（向导/成员面板展示）。
_LLM_PROVIDER_MISSING_WARNING = (
    "成员「{member_name}」未指定模型，将使用机器本机默认 LLM 出口"
    "（若不可用请先在成员配置中切换模型）"
)


def _build_llm_provider_warnings(
    agent_members: Sequence[GroupMemberAgentConfig],
) -> list[str]:
    """agent 成员配置的模型缺失提示列表（llm_provider_id=None 逐成员一条）。"""
    return [
        _LLM_PROVIDER_MISSING_WARNING.format(member_name=cfg.display_name.strip())
        for cfg in agent_members
        if cfg.llm_provider_id is None
    ]


# ── 错误族（AppError 惯例：中文用户可见文案，UUID 进 details）────────────────


class GroupChatNotFound(AppError):
    """群不存在或无权访问（404 统一不泄露存在性，design §5.3 / constraints）。"""

    code = "HTTP_404_GROUP_CHAT_NOT_FOUND"
    http_status = 404


class GroupChatMemberNotFound(AppError):
    """群成员行不存在（或已移除/跨群，404 不泄露）。"""

    code = "HTTP_404_GROUP_MEMBER_NOT_FOUND"
    http_status = 404


class GroupChatForbidden(AppError):
    """群主专属操作越权（成员可见群但非群主且非 workspace admin → 403）。

    与 404 的分工：请求者已是群成员（群存在性对其已知），改设置/加删成员/
    解散的越权用 403 明确「看得到但动不了」；非成员一律 404。
    """

    code = "HTTP_403_GROUP_CHAT_FORBIDDEN"
    http_status = 403


class GroupChatInvalid(AppError):
    """群管理写操作校验失败（上限超出/昵称重复/引用不存在等，400）。"""

    code = "HTTP_400_GROUP_CHAT_INVALID"
    http_status = 400


class GroupMemberNoActiveRun(AppError):
    """打断目标成员当前无运行中任务（quick 群 P1，409 状态冲突语义）。"""

    code = "HTTP_409_GROUP_MEMBER_NO_ACTIVE_RUN"
    http_status = 409


class GroupMessageNotFound(AppError):
    """置顶目标消息不存在或不属于该群时间线（quick 群 P2，404 不泄露他群）。"""

    code = "HTTP_404_GROUP_MESSAGE_NOT_FOUND"
    http_status = 404


# ── 群消息 DTO（task-03；schema.py 不在本卡 allowed_paths，随服务落本模块——
#    路由层自带轻量 DTO 与 task-02 GroupChatListItemRead 同先例）────────────


class GroupMemberTriggerRead(BaseModel):
    """单成员触发结果（design §8 member.injected / member.mentioned）。

    quick 群 P2（2026-09-02）部分失败收集：触发失败的成员项带 ``error``
    （中文原因摘要，如「引擎不支持附件」「机器会话数已达上限」）——此时
    ``run_id`` 为 None、``shadow_session_id`` 可能为 None（影子未建即失败），
    前端按 ``error`` 非空判定失败并展示；成功项 ``error`` 恒 None。
    """

    member_id: uuid.UUID
    member_name: str
    shadow_session_id: uuid.UUID | None = None  # 失败且未建影子时为 None
    run_id: uuid.UUID | None = None  # 即时注入轮的 run；排队轮为 None
    queued: bool = False  # 忙轮排队（AgentSessionQueuedMessage）
    # quick（2026-09-02 群聊忙轮注入）：忙轮中途注入成功（消息已注入当前
    # 活跃轮 steering，run_id=该活跃 run）；queued=False 且 mid_turn=True。
    mid_turn: bool = False
    # quick 群 P2（2026-09-02）触发失败原因摘要（成功恒 None）。
    error: str | None = None


class GroupChatPinnedRead(BaseModel):
    """置顶消息快照读体（quick 群 P2，``settings_json.pinned`` 透出）。

    ``log_id``：群时间线 ``AgentRunLog`` 行 id（前端可定位原消息气泡）；
    ``pinned_by``/``pinned_at``：置顶操作者与时刻；``content``/``member_name``
    为置顶时的消息内容与发送者身份快照（发送者后续改名不影响已置顶快照）。
    """

    log_id: uuid.UUID
    pinned_by: uuid.UUID
    pinned_at: datetime
    content: str
    member_name: str


def _group_pinned_snapshot(group: AgentGroupChat) -> GroupChatPinnedRead | None:
    """``settings_json.pinned`` → 置顶快照读体（脏数据防御性回落 None）。

    pinned 由 ``pin_message`` 内部写入（键形态受控）；手改库/迁移残留的脏
    快照（缺字段/非 UUID）在读取侧兜底丢弃，不让列表/详情炸序列化——与
    ``_group_guardrail_settings`` 同款防御口径。
    """
    raw = (group.settings_json or {}).get("pinned")
    if not isinstance(raw, dict):
        return None
    try:
        return GroupChatPinnedRead.model_validate(raw)
    except ValidationError:
        _gsvc.log.warning("group_pinned_snapshot_invalid", group_id=str(group.id))
        return None


class GroupMessageSendRead(BaseModel):
    """``POST /group-chats/{id}/messages`` 响应（design §8 group.message.sent）。"""

    carrier_run_id: uuid.UUID
    log_id: uuid.UUID
    mentioned_member_ids: list[uuid.UUID] = Field(default_factory=list)
    mention_all: bool = False
    triggered: list[GroupMemberTriggerRead] = Field(default_factory=list)


class GroupDirectMessageRead(BaseModel):
    """``POST /group-chats/{gid}/members/{mid}/direct-message`` 响应（影子直聊）。

    ``run_id``：即时注入/忙轮中途注入的 run；排队轮为 None（``queued=True``）。
    ``carrier_run_id``：直聊载体 run——群时间线上**零日志行**（直聊内容不进群），
    仅 assistant 回复中的 ``[[GROUP]]`` 转发段投影行挂本 run（run_sync 桥接段）。
    """

    shadow_session_id: uuid.UUID
    run_id: uuid.UUID | None = None
    queued: bool = False
    mid_turn: bool = False
    carrier_run_id: uuid.UUID


class GroupMemberInterruptRead(BaseModel):
    """``POST /group-chats/{gid}/members/{mid}/interrupt`` 响应（quick 群 P1）。

    ``run_id``：被打断的活跃 run（=响应前查到的影子活跃轮）；``interrupted_by_name``
    为打断者群内昵称（admin 兜底放行时回落用户显示名）。
    """

    member_id: uuid.UUID
    display_name: str
    run_id: uuid.UUID | None = None
    interrupted_by_name: str


class GroupChatCreateRead(GroupChatRead):
    """建群响应体（quick 群 P1 llm_provider 预检）。

    ``warnings``：非阻断提示列表（agent 成员未指定模型走本机默认 LLM 出口）；
    其余读取路径（列表/详情）不带本字段。
    """

    warnings: list[str] = Field(default_factory=list)


class GroupMemberAddRead(GroupMemberRead):
    """加成员响应体（quick 群 P1 llm_provider 预检）：``warnings`` 同建群体。"""

    warnings: list[str] = Field(default_factory=list)


# ── 跨模块共享的参与者判定 helper（session/file_artifacts/router 懒加载复用）──


async def get_group_chat_by_session(
    db: AsyncSession,
    session_id: uuid.UUID,
) -> AgentGroupChat | None:
    """按群会话 id 取未软删的群聚合根（id==session_id 不变式下按权威 FK 列查）。"""
    stmt = select(AgentGroupChat).where(
        AgentGroupChat.session_id == session_id,
        AgentGroupChat.deleted_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_active_user_membership(
    db: AsyncSession,
    *,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentGroupMember | None:
    """取用户在该群的**未移除**用户成员行（design §5.3 成员表命中判定）。"""
    stmt = select(AgentGroupMember).where(
        AgentGroupMember.group_id == group_id,
        AgentGroupMember.member_type == "user",
        AgentGroupMember.user_id == user_id,
        AgentGroupMember.removed_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def resolve_shadow_member(
    db: AsyncSession,
    *,
    shadow_session_id: uuid.UUID,
) -> AgentGroupMember | None:
    """按影子会话反向指针定位成员行（§5.1：群↔影子唯一关联通道）。"""
    stmt = select(AgentGroupMember).where(AgentGroupMember.shadow_session_id == shadow_session_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_group_accessible_session(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    for_update: bool = False,
    allow_shadow_member_read: bool = False,
) -> AgentSession | None:
    """群会话（kind='group'）/ 影子会话（kind='group_member'）参与者判定。

    非群形态（kind='chat'）返回 None——调用方保持原属主校验路径**零改动**
    （design §5.3「单聊零改动铁律」的实现口径：本 helper 只在首查未命中时
    被调用，chat 热路径单查询不变）。

    判定（§5.3）：

    - ``group``：群成员表命中（user 成员未移除）→ 放行；否则 workspace
      admin（``has_permission`` 现有惯例，含 platform admin 短路）→ 放行；
      否则拒（调用方统一 404 不泄露存在性）。
    - ``group_member``（影子，§5.3「影子会话 API 不对外暴露——仅群桥接内部
      +admin debug」）：属主（群主，影子 user_id 同源）→ 放行；否则 workspace
      admin → 放行；否则拒。用户成员默认**不**经本判定触达影子会话。

    ``allow_shadow_member_read``（群聊体验 quick，2026-09-02）：影子日志
    **只读**放行开关——开启时影子分支额外放行「影子所属群的未移除用户成员」
    （经 ``shadow_session_id`` 反查成员行定位群，再查请求者用户成员行命中），
    供群成员独立时间线视图读 logs。仅读路径调用方显式开启
    （``get_agent_session_logs``）；写路径（``for_update=True``，
    ``_get_owned_session_for_update`` → inject/end 等）即使误传本开关也
    **不放行**普通成员（下方 ``not for_update`` 双保险）。
    """
    kind = (
        await db.execute(select(AgentSession.session_kind).where(AgentSession.id == session_id))
    ).scalar_one_or_none()
    if kind not in ("group", "group_member"):
        return None
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    if for_update:
        stmt = stmt.with_for_update()
    agent_session = (await db.execute(stmt)).scalar_one_or_none()
    if agent_session is None:
        return None

    if kind == "group":
        group = await get_group_chat_by_session(db, session_id)
        if group is None:
            return None
        if await get_active_user_membership(db, group_id=group.id, user_id=user_id) is not None:
            return agent_session
        user = await db.get(User, user_id)
        if user is not None and await has_permission(
            db,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return agent_session
        return None

    # 影子会话：属主（群主）或 workspace admin（admin debug）。
    if agent_session.user_id == user_id:
        return agent_session
    shadow_member = await resolve_shadow_member(db, shadow_session_id=session_id)
    if shadow_member is None:
        return None
    # 旁路封堵（2026-09-03-group-chat-archive-delete design §5.2 Grill X2）：
    # 裸 db.get 不过滤软删——delete_group 置位后成员仍可经影子会话解析读到
    # 已删群。改带过滤 select（照 get_group_chat_by_session 先例，deleted_at
    # IS NULL），已删群在此返回 None → 调用方统一 404。
    shadow_group = (
        await db.execute(
            select(AgentGroupChat).where(
                AgentGroupChat.id == shadow_member.group_id,
                AgentGroupChat.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if shadow_group is None:
        return None
    # 群聊体验 quick（2026-09-02）：影子日志只读放行——反查命中的群里，请求者
    # 是未移除用户成员即放行（成员独立时间线视图读 logs）。仅 allow 开关 +
    # 非 for_update（写路径）双条件下生效，见 docstring。
    if (
        allow_shadow_member_read
        and not for_update
        and await get_active_user_membership(db, group_id=shadow_group.id, user_id=user_id)
    ):
        return agent_session
    user = await db.get(User, user_id)
    if user is not None and await has_permission(
        db,
        user=user,
        permission=Permission.WORKSPACE_ADMIN,
        workspace_id=shadow_group.workspace_id,
    ):
        return agent_session
    return None


def _user_display_name(user: User) -> str:
    """用户成员默认昵称：display_name → username → 用户{id 前缀} 兜底。"""
    return (user.display_name or user.username or f"用户{user.id.hex[:8]}").strip()[:40]


def _validate_display_name(name: str) -> str:
    """昵称规范化 + 保留词校验（@路由无歧义，design §4.1）。"""
    normalized = name.strip()
    if not normalized:
        raise GroupChatInvalid("成员昵称不能为空。")
    if normalized in RESERVED_DISPLAY_NAMES:
        raise GroupChatInvalid(
            f"昵称「{normalized}」是群内保留词（@全体/@all 广播触发词），请换一个昵称。",
        )
    return normalized


def _ensure_display_name_available(
    name: str,
    *,
    active_names: set[str],
    removed_names: set[str],
) -> None:
    """昵称查重（P1 修复：查重口径对齐 DB 唯一约束的全量行语义）。

    ``uq_agent_group_members_group_display_name`` 按 (group_id, display_name)
    对**含已移除行**全量生效——只查 active 会让「移除「小码」后新建同名成员」
    INSERT 直撞约束变 500。占用来源分文案：在群成员占用（老语义）与已移除
    历史行占用（约束同样拦，但语义不同）。
    """
    if name in active_names:
        raise GroupChatInvalid(
            f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
            details={"display_name": name},
        )
    if name in removed_names:
        raise GroupChatInvalid(
            f"群内昵称「{name}」与已移除成员昵称冲突，请更换昵称后再试。",
            details={"display_name": name},
        )


def _attachment_summary_rows(rows: Sequence) -> list[dict[str, object]]:
    """附件行 → 时间线摘要（file_id/name/size/kind）。

    user_input 行 ``metadata_.attachments`` 与群频道 log 事件 payload 共用同一
    形态（前端 SSE 实时行与回放行消费同一结构）；kind 供前端区分图标。
    """
    return [{"file_id": str(r.id), "name": r.name, "size": r.bytes, "kind": r.kind} for r in rows]


def _attachment_prompt_lines(rows: Sequence) -> list[str]:
    """附件行 → agent prompt 提示行（``[附件] name (file_id)`` 逐附件一条）。"""
    return [f"[附件] {r.name} ({r.id})" for r in rows]


# ── config_snapshot 组装（成员列表 chips 免 N+1，design §3.3）─────────────────


def _build_config_snapshot(
    *,
    runtime: DaemonRuntime,
    instance: DaemonInstance | None,
    provider: str,
    profile: object | None,
    llm: object | None,
) -> dict:
    """agent 成员六要素冗余快照（machine_name/engine/model/profile_name 等）。

    ``profile`` / ``llm`` 参数化 object 防循环 import（调用方就近 import 的
    AgentProfile/LlmProvider 行）；仅取 name 展示字段。
    """
    machine_name = None
    if instance is not None:
        machine_name = instance.display_alias or instance.hostname
    if machine_name is None:
        machine_name = runtime.name or None
    snapshot: dict = {
        "machine_name": machine_name,
        "engine": provider,
        "runtime_id": str(runtime.id),
    }
    if profile is not None:
        snapshot["profile_name"] = getattr(profile, "name", None)
    if llm is not None:
        snapshot["model"] = getattr(llm, "name", None)
    return snapshot


async def _rebuild_config_snapshot(db: AsyncSession, member: AgentGroupMember) -> dict:
    """六要素变更后按成员行当前值重建快照（update_member 消费）。"""
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.llm_provider.model import LlmProvider

    runtime: DaemonRuntime | None = None
    instance: DaemonInstance | None = None
    if member.runtime_id is not None:
        row = (
            await db.execute(
                select(DaemonRuntime, DaemonInstance)
                .join(
                    DaemonInstance,
                    DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                    isouter=True,
                )
                .where(DaemonRuntime.id == member.runtime_id)
            )
        ).first()
        if row is not None:
            runtime, instance = row[0], row[1]
    profile = (
        await db.get(AgentProfile, member.agent_profile_id)
        if member.agent_profile_id is not None
        else None
    )
    llm = (
        await db.get(LlmProvider, member.llm_provider_id)
        if member.llm_provider_id is not None
        else None
    )
    base = (member.config_snapshot or {}).copy()
    if runtime is None:
        base.pop("machine_name", None)
        base.pop("runtime_id", None)
        base["engine"] = member.provider
        return base
    fresh = _build_config_snapshot(
        runtime=runtime,
        instance=instance,
        provider=member.provider or (member.config_snapshot or {}).get("engine") or "",
        profile=profile,
        llm=llm,
    )
    # workspace 锚变更同步进快照（chips 展示「工作区」维度时免查库）。
    if member.workspace_id is not None:
        fresh["workspace_id"] = str(member.workspace_id)
    return fresh


# ── GroupChatService 方法体下沉（第一参数 svc = service 实例，self→svc）───

# ── 权限（design §5.3）───────────────────────────────────────────────────


async def _require_group_member(svc, group: AgentGroupChat, user: User) -> AgentGroupMember | None:
    """两段式参与者判定：成员表命中 → workspace admin → 404（不泄露存在性）。

    返回成员行；admin 兜底放行时无成员行，返回 None（仅表达「有权」）。
    """
    membership = await get_active_user_membership(svc._session, group_id=group.id, user_id=user.id)
    if membership is not None:
        return membership
    if await has_permission(
        svc._session,
        user=user,
        permission=Permission.WORKSPACE_ADMIN,
        workspace_id=group.workspace_id,
    ):
        return None
    raise GroupChatNotFound(
        "群不存在或无权访问。",
        details={"group_id": str(group.id)},
    )


async def _require_group_owner(svc, group: AgentGroupChat, user: User) -> None:
    """群主专属操作门（§6.1：改设置/加删成员/解散=群主+workspace admin）。

    前置：调用方已过 ``_require_group_member``（非成员 404 先行）。
    """
    if group.created_by == user.id:
        return
    if await has_permission(
        svc._session,
        user=user,
        permission=Permission.WORKSPACE_ADMIN,
        workspace_id=group.workspace_id,
    ):
        return
    raise GroupChatForbidden(
        "只有群主或工作区管理员可以执行该操作。",
        details={"group_id": str(group.id)},
    )


async def _get_group(svc, group_id: uuid.UUID) -> AgentGroupChat:
    """取未软删的群聚合根（含已解散——解散群对成员仍可读，end 幂等）。"""
    group = (
        await svc._session.execute(
            select(AgentGroupChat).where(
                AgentGroupChat.id == group_id,
                AgentGroupChat.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if group is None:
        raise GroupChatNotFound(
            "群不存在或无权访问。",
            details={"group_id": str(group_id)},
        )
    return group


async def _get_group_locked(svc, group_id: uuid.UUID) -> AgentGroupChat:
    """带 FOR UPDATE 行锁取未软删的群聚合根（2026-09-03-group-chat-archive-delete design §5.1）。

    同 :meth:`_get_group` 查询口径（含已解散——解散群可归档/可删除）+
    ``.with_for_update()``：仅归档/取消归档/删除三方法使用，防并发双写
    （照会话先例 ``archive_session``/``delete_agent_session`` 的行锁取行，
    session/service.py:6672-6740 / 6527-6583）；其余路径零改动继续用
    无锁 :meth:`_get_group`。
    """
    group = (
        await svc._session.execute(
            select(AgentGroupChat)
            .where(
                AgentGroupChat.id == group_id,
                AgentGroupChat.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if group is None:
        raise GroupChatNotFound(
            "群不存在或无权访问。",
            details={"group_id": str(group_id)},
        )
    return group


# ── 查询 helper ──────────────────────────────────────────────────────────


async def _list_members(svc, group_id: uuid.UUID) -> list[AgentGroupMember]:
    """群成员全量（含已移除行——详情展示移除态；排序：在群优先，joined_at 升序）。"""
    stmt = (
        select(AgentGroupMember)
        .where(AgentGroupMember.group_id == group_id)
        .order_by(
            AgentGroupMember.removed_at.is_not(None),
            AgentGroupMember.joined_at,
            AgentGroupMember.id,
        )
    )
    return list((await svc._session.execute(stmt)).scalars().all())


async def _list_active_member_rows(svc, group_id: uuid.UUID) -> list[AgentGroupMember]:
    stmt = (
        select(AgentGroupMember)
        .where(
            AgentGroupMember.group_id == group_id,
            AgentGroupMember.removed_at.is_(None),
        )
        .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
    )
    return list((await svc._session.execute(stmt)).scalars().all())


async def _member_name_occupancy(
    svc,
    group_id: uuid.UUID,
    *,
    exclude_member_id: uuid.UUID | None = None,
) -> tuple[set[str], set[str]]:
    """昵称占用快照（active / removed 两组，P1 修复口径）。

    唯一约束 ``uq_agent_group_members_group_display_name`` 全量含已移除行，
    查重必须同口径（否则同名新增直撞约束 500）。``exclude_member_id``
    排除改名成员/复活行自身——成员改回或沿用自己原昵称合法（UPDATE 不
    撞自身行）。
    """
    rows = await svc._list_members(group_id)
    active_names: set[str] = set()
    removed_names: set[str] = set()
    for row in rows:
        if exclude_member_id is not None and row.id == exclude_member_id:
            continue
        if row.removed_at is None:
            active_names.add(row.display_name)
        else:
            removed_names.add(row.display_name)
    return active_names, removed_names


async def _get_member(svc, group_id: uuid.UUID, member_id: uuid.UUID) -> AgentGroupMember:
    member = (
        await svc._session.execute(
            select(AgentGroupMember).where(
                AgentGroupMember.id == member_id,
                AgentGroupMember.group_id == group_id,
            )
        )
    ).scalar_one_or_none()
    if member is None or member.removed_at is not None:
        raise GroupChatMemberNotFound(
            "群成员不存在或已移除。",
            details={"group_id": str(group_id), "member_id": str(member_id)},
        )
    return member


def _to_read(svc, group: AgentGroupChat, members: list[AgentGroupMember]) -> GroupChatRead:
    read = GroupChatRead.model_validate(group)
    read.members = [GroupMemberRead.model_validate(m) for m in members]
    # quick 群 P2：置顶快照透出（GroupChatRead.pinned 为 dict 形态，router
    # 层子类读体再收窄为 typed GroupChatPinnedRead）。
    pinned = _group_pinned_snapshot(group)
    read.pinned = pinned.model_dump(mode="json") if pinned is not None else None
    return read


# ── 项目口径 helper（quick 群 PPM 项目化）────────────────────────────────


async def _project_linked_workspace_ids(svc, project_id: uuid.UUID) -> set[uuid.UUID]:
    """项目关联工作区 id 集（link_service.list_by_project，过滤软删工作区）。"""
    from app.modules.workspace import link_service

    linked = await link_service.list_by_project(svc._session, ppm_project_id=project_id)
    return {w.workspace_id for w in linked}


async def _project_member_user_ids(svc, project_id: uuid.UUID) -> set[uuid.UUID]:
    """项目成员 user_id 集（PpmProjectMember.pm_project_id → user_id）。"""
    from app.modules.ppm.project.model import PpmProjectMember

    rows = (
        (
            await svc._session.execute(
                select(PpmProjectMember.user_id).where(PpmProjectMember.pm_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


async def _require_user_in_member_scope(svc, group: AgentGroupChat, target: User) -> None:
    """邀请人员范围校验：项目群=项目成员；存量群（project_id NULL）回退 workspace 范围。

    建群口径（create_group）：project_id 必填、建群者本人须为项目成员——
    本 helper 只服务加成员（add_member）与建群邀请（调用方自持集合）；
    存量群回退口径=目标用户在群工作区有任意 workspace 角色（含 platform
    admin 短路兜底）。
    """
    if group.project_id is not None:
        if target.id not in await svc._project_member_user_ids(group.project_id):
            raise GroupChatInvalid(
                "邀请的用户不是项目成员，无法加入群聊。",
                details={
                    "user_id": str(target.id),
                    "project_id": str(group.project_id),
                },
            )
        return
    # 存量群回退 workspace 成员范围（quick 前口径的宽松版：有角色即视为成员）。
    from app.modules.auth.model import UserWorkspaceRole

    row = await svc._session.execute(
        select(UserWorkspaceRole.user_id).where(
            UserWorkspaceRole.workspace_id == group.workspace_id,
            UserWorkspaceRole.user_id == target.id,
        )
    )
    if row.first() is not None:
        return
    if target.is_platform_admin:
        return
    raise GroupChatInvalid(
        "邀请的用户不是该工作区成员，无法加入群聊。",
        details={"user_id": str(target.id), "workspace_id": str(group.workspace_id)},
    )


async def _ensure_member_workspace_in_project(
    svc, group: AgentGroupChat, workspace_id: uuid.UUID
) -> None:
    """agent 成员 cwd 工作区校验：项目群须在项目关联工作区集内。

    存量群（project_id NULL）回退原逻辑——不校验（quick 前口径即直存）。
    """
    if group.project_id is None:
        return
    if workspace_id not in await svc._project_linked_workspace_ids(group.project_id):
        raise GroupChatInvalid(
            "agent 成员的工作区不在项目关联范围内。",
            details={
                "workspace_id": str(workspace_id),
                "project_id": str(group.project_id),
            },
        )
