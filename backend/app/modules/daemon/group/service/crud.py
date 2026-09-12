"""group 子域群 CRUD（task-09 拆分，design §6.1 / §8 / 归档删除 §5.1-5.2）。

建群（项目口径 + 六要素校验 + 初始成员单事务）/ 列表 / 详情 / 改设置 /
解散（影子 end 收口链 + 群频道 session_ended 广播）/ 归档 / 取消归档 /
软删 + 置顶消息（settings_json.pinned 快照）/ 已读位点与成员运行态兜底
（``get_member_shadow_running``）。方法体下沉自 GroupChatService，第一参数
传 service 实例（svc）。
"""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import select

from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.schema import (
    GroupChatCreate,
    GroupChatRead,
    GroupChatUpdate,
    GroupMemberUserCreate,
)
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

from .helpers import (
    GROUP_AGENT_MEMBER_LIMIT,
    GROUP_SESSION_PROVIDER,
    GROUP_USER_MEMBER_LIMIT,
    GroupChatCreateRead,
    GroupChatInvalid,
    GroupChatPinnedRead,
    GroupMessageNotFound,
    _build_config_snapshot,
    _build_llm_provider_warnings,
    _user_avatar_map,
    _user_display_name,
    _validate_display_name,
)
from .settings import _merge_group_settings_json
from .typing_presence import _publish_group_channel_event

# ── quick 群 P2 常量（2026-09-02：置顶快照 / 触发失败原因摘要）────────────────

# 置顶消息内容快照截断长度（settings_json.pinned.content——完整原文仍在群时间
# 线行，快照供列表/详情横幅展示，超长截断）。
GROUP_PINNED_PREVIEW_CHARS = 200

# ── GroupChatService 方法体下沉（第一参数 svc = service 实例，self→svc）───

# ── 建群 / 列表 / 详情 / 改设置 / 解散 ────────────────────────────────────


async def create_group(svc, user: User, payload: GroupChatCreate) -> GroupChatCreateRead:
    """建群（design §8 group.created）：群会话 + 群行 + 初始成员（单事务）。

    校验（全部前置，无半成品落库）：项目存在且有关联工作区（群 workspace
    由项目关联集推导——显式传入须在集内，未传取首个）；建群者为项目成员；
    上限（用户 50 含建群者 / agent 8）；用户成员存在且为项目成员；agent
    成员六要素引用存在且 cwd 工作区在项目关联集内；昵称唯一（用户与 agent
    共用命名空间）+ 保留词。

    quick 群 PPM 项目化口径：``project_id`` 必填落群行；项目删除后存量群
    project_id 被 SET NULL，成员邀请范围回退 workspace 口径（add_member）。
    quick 群 P1 llm_provider 预检：agent 成员未指定模型不阻断（本机默认
    可能可用），随响应 ``warnings`` 提示。
    """
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.llm_provider.model import LlmProvider
    from app.modules.ppm.project.model import PpmProjectMaintenance
    from app.modules.workspace import link_service
    from app.modules.workspace.model import Workspace
    from app.modules.workspace.service import WorkspaceService

    # ── 项目口径：存在 → 关联工作区 → workspace 推导 ─────────────────────
    project = await svc._session.get(PpmProjectMaintenance, payload.project_id)
    if project is None:
        raise GroupChatInvalid(
            "目标项目不存在，无法在该项目下建群。",
            details={"project_id": str(payload.project_id)},
        )
    linked = await link_service.list_by_project(svc._session, ppm_project_id=project.id)
    if not linked:
        raise GroupChatInvalid(
            "该项目未关联工作区，请先在项目中关联。",
            details={"project_id": str(project.id)},
        )
    linked_ids = {w.workspace_id for w in linked}
    if payload.workspace_id is not None:
        if payload.workspace_id not in linked_ids:
            raise GroupChatInvalid(
                "指定的工作区不在项目关联范围内。",
                details={
                    "workspace_id": str(payload.workspace_id),
                    "project_id": str(project.id),
                },
            )
        workspace_id = payload.workspace_id
    else:
        workspace_id = linked[0].workspace_id
    workspace = await svc._session.get(Workspace, workspace_id)
    if workspace is None:
        # link_service 已过滤软删工作区，这里防御 FK 竞态（软删发生在两查之间）。
        raise GroupChatInvalid(
            "目标工作区不存在，无法在该工作区下建群。",
            details={"workspace_id": str(workspace_id)},
        )
    WorkspaceService.ensure_writable(workspace)

    # 建群者本人须为项目成员（群主是群的锚点人，不适用邀请豁免）。
    project_member_ids = await svc._project_member_user_ids(project.id)
    if user.id not in project_member_ids:
        raise GroupChatInvalid(
            "建群者需为项目成员。",
            details={"project_id": str(project.id), "user_id": str(user.id)},
        )

    # ── 上限（design §9.3）───────────────────────────────────────────────
    if len(payload.user_members) + 1 > GROUP_USER_MEMBER_LIMIT:
        raise GroupChatInvalid(
            f"群用户成员上限为 {GROUP_USER_MEMBER_LIMIT}（含建群者），当前邀请数已超出。",
            details={"user_members": len(payload.user_members)},
        )
    if len(payload.agent_members) > GROUP_AGENT_MEMBER_LIMIT:
        raise GroupChatInvalid(
            f"群 agent 成员上限为 {GROUP_AGENT_MEMBER_LIMIT}，当前配置数已超出。",
            details={"agent_members": len(payload.agent_members)},
        )

    # ── 引用存在性（批量 IN 查，免逐个 N+1）──────────────────────────────
    invited_ids = [m.user_id for m in payload.user_members]
    invited_users: dict[uuid.UUID, User] = {}
    if invited_ids:
        # P1 修复：入参一致性前置 400——重复 user_id 落库会撞
        # (group_id, user_id) 部分唯一索引；建群者下方自动落成员行，
        # 邀请自己 = 同一 user_id 双 INSERT，同样撞索引变 500。
        if user.id in invited_ids:
            raise GroupChatInvalid(
                "建群者自动加入群聊，无需邀请自己。",
                details={"user_id": str(user.id)},
            )
        duplicate_ids = {str(uid) for uid, cnt in Counter(invited_ids).items() if cnt > 1}
        if duplicate_ids:
            raise GroupChatInvalid(
                "重复邀请同一用户，无法建群。",
                details={"duplicate_user_ids": sorted(duplicate_ids)},
            )
        rows = (
            (await svc._session.execute(select(User).where(User.id.in_(invited_ids))))
            .scalars()
            .all()
        )
        invited_users = {row.id: row for row in rows}
        missing = [str(uid) for uid in invited_ids if uid not in invited_users]
        if missing:
            raise GroupChatInvalid(
                "邀请的用户不存在，无法加入群聊。",
                details={"missing_user_ids": missing},
            )
        # quick 群 PPM 项目化：邀请人员范围=项目成员（建群者已在上方单查）。
        outside = [str(uid) for uid in invited_ids if uid not in project_member_ids]
        if outside:
            raise GroupChatInvalid(
                "邀请的用户不是项目成员，无法加入群聊。",
                details={"user_ids": outside, "project_id": str(project.id)},
            )

    runtime_ids = [m.runtime_id for m in payload.agent_members]
    runtimes: dict[uuid.UUID, tuple[DaemonRuntime, DaemonInstance | None]] = {}
    if runtime_ids:
        rt_rows = (
            await svc._session.execute(
                select(DaemonRuntime, DaemonInstance)
                .join(
                    DaemonInstance,
                    DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                    isouter=True,
                )
                .where(DaemonRuntime.id.in_(runtime_ids))
            )
        ).all()
        runtimes = {rt.id: (rt, inst) for rt, inst in rt_rows}
        missing_rt = [str(rid) for rid in runtime_ids if rid not in runtimes]
        if missing_rt:
            raise GroupChatInvalid(
                "agent 成员绑定的机器不存在，请检查六要素配置。",
                details={"missing_runtime_ids": missing_rt},
            )

    # agent 成员 cwd 工作区（六要素②）须在项目关联工作区集内（quick 口径）；
    # 团队能力引擎门控（quick 群成员团队能力）：daemon 主控 5 工具仅对
    # provider=claude 注入（isMainAgentSession 谓词），非 Claude 开启 → 400。
    for cfg in payload.agent_members:
        if cfg.workspace_id is not None and cfg.workspace_id not in linked_ids:
            raise GroupChatInvalid(
                "agent 成员的工作区不在项目关联范围内。",
                details={
                    "workspace_id": str(cfg.workspace_id),
                    "project_id": str(project.id),
                },
            )
        if cfg.team_enabled and cfg.provider != "claude":
            raise GroupChatInvalid(
                f"agent 成员「{cfg.display_name}」的团队能力仅支持 Claude 引擎。",
                details={
                    "display_name": cfg.display_name,
                    "provider": cfg.provider,
                },
            )

    profile_ids = [m.agent_profile_id for m in payload.agent_members if m.agent_profile_id]
    profiles: dict[uuid.UUID, AgentProfile] = {}
    if profile_ids:
        profile_rows = (
            (
                await svc._session.execute(
                    select(AgentProfile).where(AgentProfile.id.in_(profile_ids))
                )
            )
            .scalars()
            .all()
        )
        profiles = {p.id: p for p in profile_rows}
        missing_p = [str(pid) for pid in profile_ids if pid not in profiles]
        if missing_p:
            raise GroupChatInvalid(
                "agent 成员绑定的智能体方案不存在。",
                details={"missing_agent_profile_ids": missing_p},
            )

    llm_ids = [m.llm_provider_id for m in payload.agent_members if m.llm_provider_id]
    llms: dict[uuid.UUID, LlmProvider] = {}
    if llm_ids:
        llm_rows = (
            (await svc._session.execute(select(LlmProvider).where(LlmProvider.id.in_(llm_ids))))
            .scalars()
            .all()
        )
        llms = {row.id: row for row in llm_rows}
        missing_l = [str(lid) for lid in llm_ids if lid not in llms]
        if missing_l:
            raise GroupChatInvalid(
                "agent 成员绑定的模型（LLM 供应商）不存在。",
                details={"missing_llm_provider_ids": missing_l},
            )

    # ── 昵称解析 + 唯一性（用户与 agent 共用命名空间，design §3.3）────────
    names: dict[str, str] = {}
    resolved_user_members: list[tuple[User, str, GroupMemberUserCreate]] = []
    owner_name = _validate_display_name(_user_display_name(user))
    names[owner_name] = str(user.id)
    for invite in payload.user_members:
        target = invited_users[invite.user_id]
        name = _validate_display_name(invite.display_name or _user_display_name(target))
        if name in names:
            raise GroupChatInvalid(
                f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                details={"display_name": name},
            )
        names[name] = str(target.id)
        resolved_user_members.append((target, name, invite))
    for cfg in payload.agent_members:
        name = _validate_display_name(cfg.display_name)
        if name in names:
            raise GroupChatInvalid(
                f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                details={"display_name": name},
            )
        names[name] = cfg.runtime_id.hex

    # ── 落库：群会话（kind='group'，无 lease）+ 群行 + 成员行 ─────────────
    now = datetime.now(UTC)
    group_session = AgentSession(
        id=uuid.uuid4(),
        user_id=user.id,  # 计量归属=群主（design §9.2）
        runtime_id=None,
        lease_id=None,
        provider=GROUP_SESSION_PROVIDER,
        status="active",  # design §8 group.created：无 daemon 握手，直接活跃
        title=payload.title,
        workspace_id=workspace.id,
        turn_count=0,
        created_at=now,
        session_kind="group",
    )
    svc._session.add(group_session)
    await svc._session.flush()

    group = AgentGroupChat(
        id=group_session.id,  # id==session_id 不变式（design §3.2）
        session_id=group_session.id,
        workspace_id=workspace.id,
        project_id=project.id,  # quick 群 PPM 项目化
        title=payload.title,
        created_by=user.id,
        agent_cross_mention=payload.agent_cross_mention,
        cross_mention_depth=payload.cross_mention_depth,
        context_window=payload.context_window,
        consensus_mode=payload.consensus_mode,
        consensus_timeout_seconds=payload.consensus_timeout_seconds,
        created_at=now,
    )
    svc._session.add(group)
    await svc._session.flush()

    members: list[AgentGroupMember] = [
        # 建群者自身落用户成员行（§5.3 参与者制：群主=成员）。
        AgentGroupMember(
            group_id=group.id,
            member_type="user",
            display_name=owner_name,
            user_id=user.id,
            invited_by=user.id,
            joined_at=now,
        )
    ]
    for target, name, invite in resolved_user_members:
        members.append(
            AgentGroupMember(
                group_id=group.id,
                member_type="user",
                display_name=name,
                avatar=invite.avatar,  # quick 成员头像（None=未自定义）
                user_id=target.id,
                invited_by=user.id,
                joined_at=now,
            )
        )
    for cfg in payload.agent_members:
        rt, inst = runtimes[cfg.runtime_id]
        profile = profiles.get(cfg.agent_profile_id) if cfg.agent_profile_id else None
        llm = llms.get(cfg.llm_provider_id) if cfg.llm_provider_id else None
        members.append(
            AgentGroupMember(
                group_id=group.id,
                member_type="agent",
                display_name=cfg.display_name.strip(),
                avatar=cfg.avatar,  # quick 成员头像（None=未自定义）
                runtime_id=cfg.runtime_id,
                workspace_id=cfg.workspace_id or workspace.id,
                provider=cfg.provider,
                llm_provider_id=cfg.llm_provider_id,
                agent_profile_id=cfg.agent_profile_id,
                team_enabled=cfg.team_enabled,  # quick 群成员团队能力
                shadow_status="none",  # design §8 group.member.added
                invited_by=user.id,
                joined_at=now,
                config_snapshot=_build_config_snapshot(
                    runtime=rt,
                    instance=inst,
                    provider=cfg.provider,
                    profile=profile,
                    llm=llm,
                ),
            )
        )
    for m in members:
        svc._session.add(m)

    await svc._session.commit()
    await svc._session.refresh(group)
    refreshed = await svc._list_members(group.id)
    # user 成员平台头像回落（D-002）：建群响应成员同样回落（一次 select-in）。
    avatar_by_user_id = await _user_avatar_map(svc, refreshed)
    # task-06（§5.3 audience）：建群信号带全部用户成员 id（邀请者即时收到
    # 列表刷新——群会话不进其 /sessions 列表，刷新信号是唯一入口）。
    await svc._publish_group_sessions_changed(group, "created")
    return GroupChatCreateRead.model_validate(
        {
            **svc._to_read(group, refreshed, avatar_by_user_id=avatar_by_user_id).model_dump(
                mode="json"
            ),
            # quick 群 P1 llm_provider 预检：非阻断提示（不拦截建群）。
            "warnings": _build_llm_provider_warnings(payload.agent_members),
        }
    )


async def list_groups(svc, user: User, *, archived: bool | None = False) -> list[GroupChatRead]:
    """当前用户=群成员（未移除用户成员行）的群列表（design §6.1）。

    成员摘要经成员行 + ``config_snapshot`` 冗余直出（免 N+1：按群 IN
    批量取成员）。``online_member_ids``/最后消息摘要由 router 层占位
    （task-06 填充）。

    ``archived`` 三态（2026-09-03-group-chat-archive-delete design §5.3，
    口径照会话先例 session/service.py:6002/6065-6072）：False（默认）→ 仅
    未归档；True → 仅已归档（归档视图）；None → 不过滤（admin debug 兜底）。
    **service 默认 False = HTTP 默认 False**（router Query(default=False)）——
    有意分会话侧的默认 None（曾致桌面端不传参泄漏已归档行，ql-20260831-015
    教训前移）：listGroupChats 的无参消费点（桌面/移动端群分区、群面板
    presence）「忘了传参」天然只见未归档群，防泄漏默认前移到本层。
    """
    stmt = (
        select(AgentGroupChat)
        .join(
            AgentGroupMember,
            (AgentGroupMember.group_id == AgentGroupChat.id)
            & (AgentGroupMember.member_type == "user")
            & (AgentGroupMember.user_id == user.id)
            & AgentGroupMember.removed_at.is_(None),
        )
        .where(AgentGroupChat.deleted_at.is_(None))
    )
    if archived is True:
        stmt = stmt.where(AgentGroupChat.archived_at.isnot(None))
    elif archived is False:
        stmt = stmt.where(AgentGroupChat.archived_at.is_(None))
    stmt = stmt.order_by(AgentGroupChat.created_at.desc(), AgentGroupChat.id.desc())
    groups = list((await svc._session.execute(stmt)).scalars().all())
    if not groups:
        return []
    group_ids = [g.id for g in groups]
    member_rows = (
        (
            await svc._session.execute(
                select(AgentGroupMember)
                .where(
                    AgentGroupMember.group_id.in_(group_ids),
                    AgentGroupMember.removed_at.is_(None),
                )
                .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
            )
        )
        .scalars()
        .all()
    )
    by_group: dict[uuid.UUID, list[AgentGroupMember]] = {}
    for row in member_rows:
        by_group.setdefault(row.group_id, []).append(row)
    # user 成员平台头像回落（D-002）：跨群一次批量预取（免逐群 N+1）。
    avatar_by_user_id = await _user_avatar_map(svc, member_rows)
    return [
        svc._to_read(g, by_group.get(g.id, []), avatar_by_user_id=avatar_by_user_id) for g in groups
    ]


async def get_group(svc, group_id: uuid.UUID, user: User) -> GroupChatRead:
    """群详情（成员完整列表含六要素 + shadow_status，design §6.1）。"""
    group = await svc._get_group(group_id)
    await svc._require_group_member(group, user)
    members = await svc._list_members(group.id)
    return svc._to_read(group, members, avatar_by_user_id=await _user_avatar_map(svc, members))


async def get_member_shadow_running(svc, group_id: uuid.UUID) -> dict[uuid.UUID, bool]:
    """群详情成员运行态兜底（群聊运行态可见 quick，2026-09-02）。

    agent 成员查影子会话活跃 run（谓词同 ``_get_shadow_active_run``：
    ACTIVE_RUN_STATUSES 单一词表）——True=该成员影子正在跑轮，是前端
    typing 事件丢失/SSE 迟连时的兜底可见信号；影子未建/已终态/用户成员
    恒 False。逐成员 LIMIT 1 查询（成员上限 50，可接受）。
    """
    rows = await svc._list_active_member_rows(group_id)
    running: dict[uuid.UUID, bool] = {}
    for member in rows:
        running[member.id] = (
            member.member_type == "agent"
            and member.shadow_session_id is not None
            and await svc._get_shadow_active_run(member.shadow_session_id) is not None
        )
    return running


async def update_group(
    svc,
    group_id: uuid.UUID,
    user: User,
    payload: GroupChatUpdate,
) -> GroupChatRead:
    """改群设置（群主/workspace admin；None=不改，design §6.1）。"""
    group = await svc._get_group(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法修改设置。",
            details={"group_id": str(group.id)},
        )
    if payload.title is not None:
        group.title = payload.title
    if payload.agent_cross_mention is not None:
        group.agent_cross_mention = payload.agent_cross_mention
    if payload.cross_mention_depth is not None:
        group.cross_mention_depth = payload.cross_mention_depth
    if payload.context_window is not None:
        group.context_window = payload.context_window
    # 2026-09-10-group-agent-direct-chat（D-002）：汇总收口模式两字段局部更新。
    if payload.consensus_mode is not None:
        group.consensus_mode = payload.consensus_mode
    if payload.consensus_timeout_seconds is not None:
        group.consensus_timeout_seconds = payload.consensus_timeout_seconds
    if payload.settings_json is not None:
        # quick 群 P1（2026-09-02）互@护栏群级可配：settings_json.guardrails
        # 子键写入（字段级合并；非法键/范围外值 400 中文）。
        group.settings_json = _merge_group_settings_json(group.settings_json, payload.settings_json)
    svc._session.add(group)
    await svc._session.commit()
    await svc._session.refresh(group)
    members = await svc._list_members(group.id)
    # task-06（§5.3 audience）：设置变更信号（群列表标题/开关投影刷新）。
    await svc._publish_group_sessions_changed(group, "status_changed")
    return svc._to_read(group, members, avatar_by_user_id=await _user_avatar_map(svc, members))


async def end_group(svc, group_id: uuid.UUID, user: User) -> GroupChatRead:
    """解散群（design §8 group.ended，幂等）。

    收口链：全部有影子的成员 end 影子（既有 end_session 链 + 影子队列
    pending 行删除）→ 群会话置 ended（无 lease，直接 ORM 收口）→ 群行
    ended_at + agent 成员 shadow_status='ended' → 群频道广播
    ``session_ended``（群 SSE 只认该事件收流，P1 修复）。

    ql-20260903-020：①取群改 ``_get_group_locked``（FOR UPDATE）——与
    send/update/delete 并发时不再交错双写（照归档/删除先例）；②影子 end
    失败（AppError/意外异常均 best-effort）的成员**不**置
    shadow_status='ended'（防状态口径漂移——影子实际未终止，留待 sweep
    收敛），群终态照常落库（不再留半死群）。
    """
    group = await svc._get_group_locked(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        # 幂等：重复解散直接回读（rollback 释放 FOR UPDATE 行锁后重取，
        # 防 ORM expire 属性访问触发同步惰性加载）。
        await svc._session.rollback()
        group = await svc._get_group(group_id)
        members = await svc._list_members(group.id)
        return svc._to_read(group, members, avatar_by_user_id=await _user_avatar_map(svc, members))

    active_members = await svc._list_active_member_rows(group.id)
    ended_member_ids: set[uuid.UUID] = set()
    for member in active_members:
        if member.member_type == "agent":
            shadow_ended = await svc._end_member_shadow(
                member, owner_user_id=group.created_by, reason="group_ended"
            )
            if shadow_ended:
                ended_member_ids.add(member.id)

    now = datetime.now(UTC)
    group_session = await svc._session.get(AgentSession, group.session_id)
    if group_session is not None and group_session.status not in ("ended", "failed"):
        group_session.status = "ended"
        group_session.ended_at = now
        group_session.last_active_at = now
        svc._session.add(group_session)
    group.ended_at = now
    svc._session.add(group)
    for member in active_members:
        if member.member_type == "agent" and member.id in ended_member_ids:
            member.shadow_status = "ended"  # design §8 group.ended
            svc._session.add(member)
        # 影子 end 失败的成员保持原 shadow_status（影子实际未终止，
        # 留待 sweep 按 runtime 离线/超时收敛），不伪造 ended 口径。
    await svc._session.commit()
    await svc._session.refresh(group)
    members = await svc._list_members(group.id)
    # P1 修复（照 lease_service/sweep 的 session_ended 先例 + SSE 生成器
    # 消费字段）：群会话终态落库后向群频道广播 session_ended——群 SSE
    # 生成器只认该事件收流，不发则已连客户端永远 keepalive（前端解散
    # 收口死路径 + presence 死群恒在线）。幂等早退路径不重发（首末已发）。
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "session_ended",
            "session_id": str(group.session_id),
            "status": "ended",
            "reason": "group_ended",
        },
    )
    # task-06（§5.3 audience / §8 group.ended）：解散信号全员可见（列表把
    # 已解散群折叠/移出）。
    await svc._publish_group_sessions_changed(group, "status_changed")
    return svc._to_read(group, members, avatar_by_user_id=await _user_avatar_map(svc, members))


# ── 归档/取消归档/删除（2026-09-03-group-chat-archive-delete design §5.1/§5.2）──


async def archive_group(svc, group_id: uuid.UUID, user: User) -> None:
    """归档群（design §5.1，照会话先例 ``archive_session`` 镜像，
    session/service.py:6672-6740）。

    群主/workspace admin 置 ``archived_at``（默认群列表隐藏，已归档视图
    可查可恢复）。幂等：已归档重复调用无操作（rollback 释放 FOR UPDATE
    行锁后早退，不悬挂事务）。已解散群**可归档**（解散群仍占列表位，
    归档是收纳解散群的主场景，design §5.1）；软删群在取群处已 404。
    ``archived_at`` ⊥ ``deleted_at`` ⊥ ``ended_at``（design §2 正交性）。
    """
    group = await svc._get_group_locked(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.archived_at is not None:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：已归档
    group.archived_at = datetime.now(UTC)
    await svc._session.commit()
    # design §5.4：归档已落库（列表按 archived_at IS NULL 过滤），发布列表
    # 变更信号（audience=全部用户成员）——已连 SSE 客户端秒级看到该群从
    # 默认列表消失、归档视图出现。
    await svc._publish_group_sessions_changed(group, "status_changed")


async def unarchive_group(svc, group_id: uuid.UUID, user: User) -> None:
    """取消归档群（design §5.1，照会话先例 ``unarchive_session`` 镜像，
    session/service.py:6711-6740）。

    群主/workspace admin 清除 ``archived_at``（群回默认列表视图）。
    幂等：未归档重复调用无操作（rollback 释放行锁后早退），与
    :meth:`archive_group` 对称。
    """
    group = await svc._get_group_locked(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.archived_at is None:
        await svc._session.rollback()  # 释放 FOR UPDATE 行锁（幂等早退不悬挂事务）
        return  # 幂等：未归档
    group.archived_at = None
    await svc._session.commit()
    # design §5.4：取消归档已落库（行回默认列表视图），发布列表变更信号——
    # 与 archive_group 对称，SSE 客户端秒级看到该群重新出现。
    await svc._publish_group_sessions_changed(group, "status_changed")


async def delete_group(svc, group_id: uuid.UUID, user: User) -> None:
    """删除群=软删（design §5.2，照会话先例 ``delete_agent_session`` 镜像，
    session/service.py:6527-6583）。

    未解散群先复用 :meth:`end_group` 完整收口链（end 全部影子会话 + 影子
    队列 pending 清理 + 群时间线会话置 ended + 群行 ended_at + 群频道
    ``session_ended`` 广播——design §5.2 实现取舍：**不重写**
    ``_end_group_for_delete`` 私有方法，end_group 即目标语义且幂等，已解散
    直接回读）；随后对群行 + 群时间线会话双置 ``deleted_at``（行/run 历史
    保留审计，list/get 端点过滤隐藏）。两段 commit 间的「ended-未删」半态
    由 end_group 幂等重试收敛；删除本身未落库前无半态。幂等边界：已删群
    在取群处已 404。删除后成员视角一切读路径 404（属主经影子会话读日志的
    旁路由 ``get_group_accessible_session`` 的 deleted_at 过滤封堵，design
    §5.2 Grill X2；群主属主 logs 审计只读口径照会话侧现状保留）。
    """
    group = await svc._get_group_locked(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    # 复用收口链（同 user 二次权限判定幂等通过；内部 commit 结束当前事务
    # 并释放首轮行锁——影子 end 的 WS 投递失败已由其内部 warning 吞掉，
    # 不阻断软删，与会话侧分层容错同构：内层 best-effort、外层事务性）。
    await svc.end_group(group_id, user)
    # 重新行锁取最新行：expire_on_commit=False 下内存对象不自动刷新，
    # 显式重读拿到 end_group 落库后的 ended 态终值。
    group = await svc._get_group_locked(group_id)
    now = datetime.now(UTC)
    # 群时间线会话软删置位（严格镜像 delete_agent_session:6578 对会话行的
    # 软删置位——封堵属主经 GET /sessions/{id} 直读群时间线的旁路）。
    group_session = await svc._session.get(AgentSession, group.session_id)
    if group_session is not None:
        group_session.deleted_at = now
        svc._session.add(group_session)
    group.deleted_at = now
    svc._session.add(group)
    await svc._session.commit()
    # design §5.4：软删已落库（列表被 deleted_at IS NULL 过滤），发布列表
    # 删除信号（audience=全部用户成员）——前端 invalidate 重拉后该群消失。
    await svc._publish_group_sessions_changed(group, "deleted")


# ── 置顶消息（quick 群 P2，2026-09-02：settings_json.pinned）──────────────


async def _get_timeline_row(
    svc, group: AgentGroupChat, log_id: uuid.UUID
) -> tuple[AgentRunLog, str]:
    """查群时间线消息行（须属本群时间线）+ 身份快照标签（置顶/引用回复共用）。

    行源同 ``_load_group_context_lines``：``user_input`` 行（用户消息）与
    投影行（``channel='stdout'`` 且带成员身份 metadata）都命中；身份标签
    从 metadata 取（用户行 ``sender_member_name`` / 投影行 ``member_name``），
    缺失回退 run.user_id 查成员表 display_name →「成员」（与背景摘要同款
    兜底链）。跨群 log / 不存在 → 404 ``GroupMessageNotFound``。

    群 P2 第二波起两个消费方：``pin_message``（置顶快照）与
    ``send_group_message``（``reply_to_log_id`` 引用回复快照）——校验口径
    单源，勿在调用方另查。
    """
    row = (
        await svc._session.execute(
            select(AgentRunLog, AgentRun.user_id)
            .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
            .where(
                AgentRunLog.id == log_id,
                AgentRun.agent_session_id == group.session_id,
            )
        )
    ).first()
    if row is None:
        raise GroupMessageNotFound(
            "消息不存在或不属于该群。",
            details={"group_id": str(group.id), "log_id": str(log_id)},
        )
    log_row, run_user_id = row[0], row[1]
    meta = log_row.metadata_ or {}
    member_name = (
        meta.get("sender_member_name")
        if log_row.channel == "user_input"
        else meta.get("member_name")
    )
    if not member_name and run_user_id is not None:
        members = await svc._list_members(group.id)
        member_name = next(
            (
                m.display_name
                for m in members
                if m.member_type == "user" and m.user_id == run_user_id
            ),
            None,
        )
    return log_row, member_name or "成员"


async def pin_message(
    svc,
    group_id: uuid.UUID,
    user: User,
    log_id: uuid.UUID,
) -> GroupChatPinnedRead:
    """置顶一条群消息（quick 群 P2：群主/admin；一次一条，新置顶覆盖旧的）。

    快照落 ``settings_json.pinned``（复用 settings_json 零迁移）——内容截
    ``GROUP_PINNED_PREVIEW_CHARS``、身份快照取置顶时点值（发送者后续改名
    不影响）；置顶成功群频道发系统行（ephemeral，照打断提示先例）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法置顶消息。",
            details={"group_id": str(group.id)},
        )
    log_row, member_name = await svc._get_timeline_row(group, log_id)
    pinned = GroupChatPinnedRead(
        log_id=log_row.id,
        pinned_by=user.id,
        pinned_at=datetime.now(UTC),
        content=(log_row.content_redacted or "").strip()[:GROUP_PINNED_PREVIEW_CHARS],
        member_name=member_name,
    )
    settings = dict(group.settings_json or {})
    settings["pinned"] = pinned.model_dump(mode="json")
    group.settings_json = settings
    svc._session.add(group)
    await svc._session.commit()
    await svc._session.refresh(group)

    operator_name = membership.display_name if membership is not None else _user_display_name(user)
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "channel": "system",
            "content": f"{operator_name} 置顶了一条消息",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )
    return pinned


async def unpin_message(svc, group_id: uuid.UUID, user: User) -> None:
    """取消置顶（quick 群 P2：群主/admin；无置顶时幂等 204）。

    系统行仅在确有置顶被取消时发（幂等重放不重复提示）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法操作置顶消息。",
            details={"group_id": str(group.id)},
        )
    if (group.settings_json or {}).get("pinned") is None:
        return  # 幂等：无置顶直接收口（不发系统行）。
    settings = dict(group.settings_json or {})
    settings.pop("pinned", None)
    group.settings_json = settings
    svc._session.add(group)
    await svc._session.commit()

    operator_name = membership.display_name if membership is not None else _user_display_name(user)
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "channel": "system",
            "content": f"{operator_name} 取消了置顶消息",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )
