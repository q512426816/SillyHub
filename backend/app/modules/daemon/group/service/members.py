"""group 子域成员管理（task-09 拆分，design §6.1 / §8）。

加成员（用户邀请复活语义 / agent 六要素）/ 六要素热切换（update_member +
_hot_switch_shadow_config：模型组切换轮 / 机器组影子重建）/ 移除 / 重置记忆
+ 影子会话 end 子链（``_end_member_shadow``：end 影子 + 影子队列 pending
清理，解散/移除/重置共用）。方法体下沉自 GroupChatService，第一参数传
service 实例（svc）。

D-007：SessionService 为本命名空间 patch 目标，一律 ``_gsvc.SessionService``
延迟解析。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select

import app.modules.daemon.group.service as _gsvc
from app.core.errors import AppError
from app.modules.agent.model import (
    AgentGroupMember,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.agent.schema import (
    GroupMemberCreate,
    GroupMemberRead,
    GroupMemberUpdate,
)
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

from .helpers import (
    GROUP_AGENT_MEMBER_LIMIT,
    GROUP_USER_MEMBER_LIMIT,
    GroupChatInvalid,
    GroupMemberAddRead,
    _apply_user_avatar_fallback,
    _build_config_snapshot,
    _build_llm_provider_warnings,
    _ensure_display_name_available,
    _rebuild_config_snapshot,
    _user_display_name,
    _validate_display_name,
)

# ── GroupChatService 方法体下沉（第一参数 svc = service 实例，self→svc）───

# ── 影子会话 end 子链（解散/移除 agent 成员/reset-memory 共用）────────────


async def _end_member_shadow(
    svc,
    member: AgentGroupMember,
    *,
    owner_user_id: uuid.UUID,
    reason: str,
) -> bool:
    """end 成员影子会话 + 清理影子队列 pending 行（design §8）。

    ``shadow_session_id`` 为空直接跳过（幂等，视为成功）；非空则先删影子
    队列 pending 行（design §8 group.member.removed「防终态后静默丢弃」——
    先删保证 end 链异常时队列也不残留），再走既有 ``end_session`` 链
    （user_id=群主，影子 user_id 同源——服务身份路径先例）。

    ql-20260903-020：end 失败 best-effort 降级且**扩大到意外异常**——原实现
    只捕 AppError，DB 抖动等非 AppError 会带着「此前成员影子已逐个 commit」
    的半途状态把整个解散请求打 500，留下 ended_at 未写的半死群（群还活着、
    成员影子已终止）。意外异常 rollback 复位事务态后继续（后续成员/群收口
    仍可写库），返回 False 由调用方决定 shadow_status 口径。

    Returns:
        True = 影子存在且已终止；False = 无影子（无事发生）或 end 尝试失败
        （已记日志）。end_group 据此只给真终止的成员置 shadow_status='ended'。
    """
    if member.shadow_session_id is None:
        return False
    shadow_session_id = member.shadow_session_id
    await svc._session.execute(
        delete(AgentSessionQueuedMessage).where(
            AgentSessionQueuedMessage.agent_session_id == shadow_session_id,
            AgentSessionQueuedMessage.status == "pending",
        )
    )
    await svc._session.commit()
    try:
        await _gsvc.SessionService(svc._session).end_session(
            shadow_session_id,
            owner_user_id,
            reason=reason,
        )
    except AppError as exc:
        _gsvc.log.warning(
            "group_member_shadow_end_failed",
            group_id=str(member.group_id),
            member_id=str(member.id),
            shadow_session_id=str(shadow_session_id),
            code=exc.code,
        )
        return False
    except Exception:
        # ql-20260903-020：意外异常同样 best-effort（见 docstring）——rollback
        # 复位事务态，日志带栈定位，不阻断解散/移除收口。
        await svc._session.rollback()
        _gsvc.log.warning(
            "group_member_shadow_end_unexpected_error",
            group_id=str(member.group_id),
            member_id=str(member.id),
            shadow_session_id=str(shadow_session_id),
            reason=reason,
            exc_info=True,
        )
        return False
    return True


# ── 成员管理（design §6.1 / §8）─────────────────────────────────────────


async def add_member(
    svc,
    group_id: uuid.UUID,
    user: User,
    payload: GroupMemberCreate,
) -> GroupMemberAddRead:
    """加成员（群主/workspace admin）：用户邀请或 agent 成员六要素配置。

    quick 群 P1 llm_provider 预检：agent 成员未指定模型不阻断，随响应
    ``warnings`` 提示（同建群体）。
    """
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.llm_provider.model import LlmProvider

    if (payload.user is None) == (payload.agent is None):
        raise GroupChatInvalid(
            "成员写体二选一：user（邀请用户）或 agent（六要素配置）。",
        )
    group = await svc._get_group(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法添加成员。",
            details={"group_id": str(group.id)},
        )
    active_members = await svc._list_active_member_rows(group.id)
    active_user_count = sum(1 for m in active_members if m.member_type == "user")
    active_agent_count = sum(1 for m in active_members if m.member_type == "agent")

    now = datetime.now(UTC)
    if payload.user is not None:
        if active_user_count + 1 > GROUP_USER_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群用户成员上限为 {GROUP_USER_MEMBER_LIMIT}，无法继续添加。",
            )
        target = await svc._session.get(User, payload.user.user_id)
        if target is None:
            raise GroupChatInvalid(
                "邀请的用户不存在，无法加入群聊。",
                details={"user_id": str(payload.user.user_id)},
            )
        # quick 群 PPM 项目化：邀请范围=项目成员（存量群 project_id NULL
        # 回退 workspace 成员范围，见 helper）。
        await svc._require_user_in_member_scope(group, target)
        # 复活语义先行（部分唯一索引 uq_agent_group_members_group_user 按
        # (group_id, user_id) 恒占位）：已移除用户再次邀请走原行复活，不撞
        # 索引（design §3.3 UNIQUE(group_id, user_id)）；在群用户重复邀请
        # 的 400 语义先于昵称冲突判定（昵称常与本人现名相同，先查成员行
        # 才能给出准确文案）。
        revived = (
            await svc._session.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.group_id == group.id,
                    AgentGroupMember.user_id == target.id,
                )
            )
        ).scalar_one_or_none()
        if revived is not None and revived.removed_at is None:
            raise GroupChatInvalid(
                "该用户已是群成员，无法重复邀请。",
                details={"user_id": str(target.id)},
            )
        # P1 修复：查重含已移除行（DB 唯一约束全量生效）；复活行自身
        # 占位除外——被复活用户沿用/改回原昵称合法（UPDATE 不撞自身行）。
        active_names, removed_names = await svc._member_name_occupancy(
            group.id, exclude_member_id=revived.id if revived is not None else None
        )
        name = _validate_display_name(payload.user.display_name or _user_display_name(target))
        _ensure_display_name_available(name, active_names=active_names, removed_names=removed_names)
        if revived is not None:
            revived.removed_at = None
            revived.display_name = name
            if payload.user.avatar is not None:
                revived.avatar = payload.user.avatar  # quick 成员头像（None=不改）
            revived.invited_by = user.id
            revived.joined_at = now
            svc._session.add(revived)
            await svc._session.commit()
            await svc._session.refresh(revived)
            # task-06（§5.3 audience / §8 group.member.added）。
            await svc._publish_group_sessions_changed(group, "status_changed")
            revived_read = GroupMemberAddRead.model_validate(revived)
            # user 成员平台头像回落（D-002）：target 已在作用域，免额外查询。
            _apply_user_avatar_fallback([revived_read], {target.id: target.avatar})
            return revived_read
        member = AgentGroupMember(
            group_id=group.id,
            member_type="user",
            display_name=name,
            avatar=payload.user.avatar,  # quick 成员头像（None=未自定义）
            user_id=target.id,
            invited_by=user.id,
            joined_at=now,
        )
        svc._session.add(member)
        await svc._session.commit()
        await svc._session.refresh(member)
        # task-06（§5.3 audience / §8 group.member.added）：新成员即时进
        # 自己的刷新受众（否则要等下一次任意群事件才看到群）。
        await svc._publish_group_sessions_changed(group, "status_changed")
        member_read = GroupMemberAddRead.model_validate(member)
        # user 成员平台头像回落（D-002）：target 已在作用域，免额外查询。
        _apply_user_avatar_fallback([member_read], {target.id: target.avatar})
        return member_read

    assert payload.agent is not None
    cfg = payload.agent
    if active_agent_count + 1 > GROUP_AGENT_MEMBER_LIMIT:
        raise GroupChatInvalid(
            f"群 agent 成员上限为 {GROUP_AGENT_MEMBER_LIMIT}，无法继续添加。",
        )
    rt_row = (
        await svc._session.execute(
            select(DaemonRuntime, DaemonInstance)
            .join(
                DaemonInstance,
                DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                isouter=True,
            )
            .where(DaemonRuntime.id == cfg.runtime_id)
        )
    ).first()
    if rt_row is None:
        raise GroupChatInvalid(
            "agent 成员绑定的机器不存在，请检查六要素配置。",
            details={"runtime_id": str(cfg.runtime_id)},
        )
    runtime, instance = rt_row[0], rt_row[1]
    # agent 成员 cwd 工作区须在项目关联工作区集内（存量群回退原逻辑不校验）；
    # 团队能力引擎门控（建群同口径）：仅 Claude 可开。
    if cfg.workspace_id is not None:
        await svc._ensure_member_workspace_in_project(group, cfg.workspace_id)
    if cfg.team_enabled and cfg.provider != "claude":
        raise GroupChatInvalid(
            f"agent 成员「{cfg.display_name}」的团队能力仅支持 Claude 引擎。",
            details={"provider": cfg.provider},
        )
    profile: AgentProfile | None = None
    if cfg.agent_profile_id is not None:
        profile = await svc._session.get(AgentProfile, cfg.agent_profile_id)
        if profile is None:
            raise GroupChatInvalid(
                "agent 成员绑定的智能体方案不存在。",
                details={"agent_profile_id": str(cfg.agent_profile_id)},
            )
    llm: LlmProvider | None = None
    if cfg.llm_provider_id is not None:
        llm = await svc._session.get(LlmProvider, cfg.llm_provider_id)
        if llm is None:
            raise GroupChatInvalid(
                "agent 成员绑定的模型（LLM 供应商）不存在。",
                details={"llm_provider_id": str(cfg.llm_provider_id)},
            )
    # P1 修复：同上——agent 成员昵称查重含已移除行（防撞全量唯一约束）。
    active_names, removed_names = await svc._member_name_occupancy(group.id)
    name = _validate_display_name(cfg.display_name)
    _ensure_display_name_available(name, active_names=active_names, removed_names=removed_names)
    member = AgentGroupMember(
        group_id=group.id,
        member_type="agent",
        display_name=name,
        avatar=cfg.avatar,  # quick 成员头像（None=未自定义）
        runtime_id=cfg.runtime_id,
        workspace_id=cfg.workspace_id or group.workspace_id,
        provider=cfg.provider,
        llm_provider_id=cfg.llm_provider_id,
        agent_profile_id=cfg.agent_profile_id,
        team_enabled=cfg.team_enabled,  # quick 群成员团队能力
        shadow_status="none",
        invited_by=user.id,
        joined_at=now,
        config_snapshot=_build_config_snapshot(
            runtime=runtime,
            instance=instance,
            provider=cfg.provider,
            profile=profile,
            llm=llm,
        ),
    )
    svc._session.add(member)
    await svc._session.commit()
    await svc._session.refresh(member)
    # task-06（§5.3 audience）：agent 成员变更同样广播（成员 chips 刷新）。
    await svc._publish_group_sessions_changed(group, "status_changed")
    # quick 群 P1 llm_provider 预检：未指定模型非阻断提示（同建群体）。
    added = GroupMemberAddRead.model_validate(member)
    added.warnings = _build_llm_provider_warnings([cfg])
    return added


async def update_member(
    svc,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User,
    payload: GroupMemberUpdate,
) -> GroupMemberRead:
    """改成员（群主/workspace admin）：改昵称 / agent 成员六要素。

    六要素热切换（task-04，design §4.5）：模型组（provider/llm_provider/
    agent_profile）变更且影子存在 → 影子三列同步 + SESSION_SWITCH_CONFIG
    服务身份下发（下轮边界生效）；机器组（runtime/workspace）变更且影子
    存在 → end 影子 + ``shadow_status='pending'``（下次触发懒重建，记忆
    重置）。config_snapshot 同步更新（§3.3 冗余）。
    """
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.llm_provider.model import LlmProvider

    group = await svc._get_group(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法修改成员。",
            details={"group_id": str(group.id)},
        )
    member = await svc._get_member(group.id, member_id)

    if member.member_type != "agent" and (
        payload.runtime_id is not None
        or payload.workspace_id is not None
        or payload.provider is not None
        or payload.llm_provider_id is not None
        or payload.agent_profile_id is not None
        or payload.team_enabled is not None
    ):
        raise GroupChatInvalid(
            "用户成员不支持修改六要素配置（仅 agent 成员可配置）。",
            details={"member_id": str(member.id)},
        )

    # quick 成员头像：用户与 agent 成员共用（None=不改，非六要素维度）。
    if payload.avatar is not None:
        member.avatar = payload.avatar

    # task-04（design §4.5）：六要素 diff 基线——变更前的三组维度值
    # （模型组 provider/llm_provider_id/agent_profile_id 走热切换；机器组
    # runtime_id/workspace_id 走影子重建；team_enabled 归机器组——stage 随
    # lease 建时定，复用轮改不掉）。
    old_config = {
        "runtime_id": member.runtime_id,
        "workspace_id": member.workspace_id,
        "provider": member.provider,
        "llm_provider_id": member.llm_provider_id,
        "agent_profile_id": member.agent_profile_id,
        "team_enabled": member.team_enabled,
    }

    # quick-6966fcee 存量自愈：早期影子建行带 config.manual_approval=False
    # （审批不进群旧设计）——影子已挂完整 SessionPanel 可作答，此处幂等
    # 修正（复用任何成员 PATCH 路径触达；不重建影子、记忆无损）。
    # quick-bfec20a6 修正自愈语义：quick-6966fcee 只把 False 删成 None，
    # 但 permission_service 闸门 `is not True` 对 None 同样拒——自愈必须
    # 显式落 True 才真正放开弹窗（与建行 config 同形，含 ask_user_only）。
    # config=None（JSON null 建行 / 自愈删空）同样命中，一并修。
    if (
        member.shadow_session_id is not None
        and isinstance(
            member_config := (await svc._session.get(AgentSession, member.shadow_session_id)),
            AgentSession,
        )
        and (
            member_config.config is None
            or (
                isinstance(member_config.config, dict)
                and member_config.config.get("manual_approval") is not True
            )
        )
    ):
        healed = dict(member_config.config) if isinstance(member_config.config, dict) else {}
        healed.update({"manual_approval": True, "ask_user_only": True})
        member_config.config = healed
        svc._session.add(member_config)
        _gsvc.log.info(
            "group_shadow_manual_approval_healed",
            group_id=str(group_id),
            member_id=str(member_id),
            session_id=str(member.shadow_session_id),
        )

    if payload.display_name is not None:
        name = _validate_display_name(payload.display_name)
        if name != member.display_name:
            # P1 修复：查重含已移除行（DB 唯一约束全量生效，UPDATE 同样
            # 撞约束）；排除改名成员自身行（其余 active/removed 行全算占用）。
            active_names, removed_names = await svc._member_name_occupancy(
                group.id, exclude_member_id=member.id
            )
            _ensure_display_name_available(
                name, active_names=active_names, removed_names=removed_names
            )
            member.display_name = name

    snapshot_dirty = False
    if member.member_type == "agent":
        if payload.runtime_id is not None and payload.runtime_id != member.runtime_id:
            if await svc._session.get(DaemonRuntime, payload.runtime_id) is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的机器不存在，请检查六要素配置。",
                    details={"runtime_id": str(payload.runtime_id)},
                )
            member.runtime_id = payload.runtime_id
            snapshot_dirty = True
        if payload.workspace_id is not None and payload.workspace_id != member.workspace_id:
            # quick 群 PPM 项目化：cwd 工作区切换须落在项目关联工作区集内
            # （存量群 project_id NULL 回退原逻辑不校验）。
            await svc._ensure_member_workspace_in_project(group, payload.workspace_id)
            member.workspace_id = payload.workspace_id
            snapshot_dirty = True
        if payload.provider is not None and payload.provider != member.provider:
            member.provider = payload.provider
            snapshot_dirty = True
        if (
            payload.llm_provider_id is not None
            and payload.llm_provider_id != member.llm_provider_id
        ):
            if await svc._session.get(LlmProvider, payload.llm_provider_id) is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的模型（LLM 供应商）不存在。",
                    details={"llm_provider_id": str(payload.llm_provider_id)},
                )
            member.llm_provider_id = payload.llm_provider_id
            snapshot_dirty = True
        if (
            payload.agent_profile_id is not None
            and payload.agent_profile_id != member.agent_profile_id
        ):
            if await svc._session.get(AgentProfile, payload.agent_profile_id) is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的智能体方案不存在。",
                    details={"agent_profile_id": str(payload.agent_profile_id)},
                )
            member.agent_profile_id = payload.agent_profile_id
            snapshot_dirty = True
        # 团队能力开关（quick 群成员团队能力）：None=不改。最终态引擎门控
        # （daemon 主控 5 工具仅 provider=claude 注入，建群/加成员同口径；
        # 覆盖「开 team + 同 PATCH 切 codex」与「已开 team 只切引擎」组合）。
        if payload.team_enabled is not None and payload.team_enabled != member.team_enabled:
            member.team_enabled = payload.team_enabled
        if member.team_enabled and (member.provider or "claude") != "claude":
            raise GroupChatInvalid(
                f"成员「{member.display_name}」的团队能力仅支持 Claude 引擎，"
                "请改用 Claude 引擎或先关闭团队能力。",
                details={
                    "member_id": str(member.id),
                    "provider": member.provider,
                },
            )
        if snapshot_dirty:
            member.config_snapshot = await _rebuild_config_snapshot(svc._session, member)

    svc._session.add(member)
    await svc._session.commit()
    await svc._session.refresh(member)

    # ── task-04（design §4.5 / §8 member.config.switched）：六要素热切换──
    # 成员表已提交（六要素真相源）；影子存在时按 diff 分组执行 daemon 侧。
    # 子链内部的 rollback 会 expire 会话对象——先取标量，分支后重取行。
    group_id_val = group.id
    if member.member_type == "agent" and member.shadow_session_id is not None:
        machine_changed = (
            old_config["runtime_id"] != member.runtime_id
            or old_config["workspace_id"] != member.workspace_id
            # 团队能力开关变更归机器组重建分支（quick 群成员团队能力）：
            # stage 随 lease 建时定，复用轮改不掉——必须 end 影子 + pending
            # 下次触发按新开关重懒建（UI 已有重建重置记忆确认语义）。
            or old_config["team_enabled"] != member.team_enabled
        )
        model_changed = (
            old_config["provider"] != member.provider
            or old_config["llm_provider_id"] != member.llm_provider_id
            or old_config["agent_profile_id"] != member.agent_profile_id
        )
        if machine_changed:
            # 机器/工作区切换：end 旧影子 + pending + 指针置空——下次被 @ 按
            # 新六要素懒重建（记忆重置，接口层已提示确认）。
            await svc._end_member_shadow(
                member,
                owner_user_id=group.created_by,
                reason="member_reconfigured",
            )
            member = await svc._get_member(group_id_val, member_id)
            member.shadow_status = "pending"
            member.shadow_session_id = None
            svc._session.add(member)
            await svc._session.commit()
            await svc._session.refresh(member)
        elif model_changed:
            await svc._hot_switch_shadow_config(member, old_config=old_config)

    # 热切换子链（rollback）可能 expire 群/成员行——重取后再收口（防
    # expired 属性 lazy IO 炸 MissingGreenlet）。
    member = await svc._get_member(group_id_val, member_id)
    group = await svc._get_group(group_id_val)
    # task-06（§5.3 audience）：昵称/六要素变更 → 成员 chips 快照刷新。
    await svc._publish_group_sessions_changed(group, "status_changed")
    member_read = GroupMemberRead.model_validate(member)
    # user 成员平台头像回落（D-002）：单成员返回按 user_id 单查目标 user
    # （agent 成员不查不动）。
    if member.member_type == "user" and member.user_id is not None:
        target_user = await svc._session.get(User, member.user_id)
        if target_user is not None:
            _apply_user_avatar_fallback([member_read], {member.user_id: target_user.avatar})
    return member_read


async def _hot_switch_shadow_config(
    svc,
    member: AgentGroupMember,
    *,
    old_config: dict,
) -> bool:
    """模型组六要素热切换（design §4.5：下轮边界生效，独立记忆延续）。

    步骤与顺序（顺序敏感——切换轮靠新旧值 diff 判定，先同步列会让 diff
    消失变成空 prompt 拒绝）：

    1. 经 ``inject_session_as_service`` 服务身份下发**静默切换轮**（空
       prompt + 实际变更维度）：``_inject_into_session`` 的 config_switch
       分支刷新影子 ``agent_profile_id``/``llm_provider_id`` 两列 + 快照 +
       SESSION_SWITCH_CONFIG（daemon 当前轮结束边界 reload，下一轮生效；
       忙轮则排队条目携带切换参数，turn 终态派发时同样走切换分支）。SDK
       resume id 不变，独立记忆延续；
    2. 引擎列（``provider``）inject 分支不覆盖——切换轮后手动补同步；
    3. 纯引擎 diff（profile/llm 未变）无原生切换维度可注入：仅同步三列
       （daemon driver 无法会话中热换引擎，效果落在下次影子重建/快照）。

    失败语义：切换轮失败（供应商归属/引擎不匹配/daemon 离线）记 warning
    后**兜底同步三列**——成员表是六要素真相源，下次触发按新列快照执行，
    PATCH 不因 daemon 侧失败回滚。子链内部 rollback 会 expire 会话对象
    （工厂 expire_on_commit=False，仅 rollback 过期）——所需标量先取局部。
    """
    shadow_id = member.shadow_session_id
    target_provider = member.provider
    target_llm_id = member.llm_provider_id
    target_profile_id = member.agent_profile_id
    shadow = await svc._session.get(AgentSession, shadow_id)
    if shadow is None or shadow.status in ("ended", "failed"):
        return False

    # 仅把**实际变更**的维度传给切换分支（等值传入=不构成切换，空 prompt
    # 会被守卫拒；None→"" 语义=清空回本机默认/无人格）。
    switch_profile: str | None = None
    if old_config["agent_profile_id"] != target_profile_id:
        switch_profile = str(target_profile_id) if target_profile_id is not None else ""
    switch_llm: str | None = None
    if old_config["llm_provider_id"] != target_llm_id:
        switch_llm = str(target_llm_id) if target_llm_id is not None else ""

    if switch_profile is None and switch_llm is None:
        shadow.provider = target_provider or shadow.provider
        shadow.llm_provider_id = target_llm_id
        shadow.agent_profile_id = target_profile_id
        svc._session.add(shadow)
        await svc._session.commit()
        _gsvc.log.info(
            "group_member_switch_engine_only_columns_synced",
            member_id=str(member.id),
            shadow_session_id=str(shadow_id),
            provider=shadow.provider,
        )
        return True

    try:
        await _gsvc.SessionService(svc._session).inject_session_as_service(
            shadow.id,
            prompt="",
            agent_profile_id=switch_profile,
            llm_provider_id=switch_llm,
            queue_when_busy=True,
        )
    except AppError as exc:
        _gsvc.log.warning(
            "group_member_switch_dispatch_failed",
            member_id=str(member.id),
            shadow_session_id=str(shadow_id),
            code=exc.code,
        )
        switched = False
    else:
        switched = True

    # 切换轮（成功与否）后补齐三列：成功路径 profile/llm 已由切换分支刷新，
    # 引擎列恒需手动；失败路径全列兜底同步（真相源跟随，rollforward）。
    fresh_shadow = await svc._session.get(AgentSession, shadow_id)
    if fresh_shadow is not None and fresh_shadow.status not in ("ended", "failed"):
        fresh_shadow.provider = target_provider or fresh_shadow.provider
        fresh_shadow.llm_provider_id = target_llm_id
        fresh_shadow.agent_profile_id = target_profile_id
        svc._session.add(fresh_shadow)
        await svc._session.commit()
    return switched


async def remove_member(
    svc,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User,
) -> None:
    """移除成员（群主/workspace admin，design §8 group.member.removed）。

    用户成员：removed_at 置位（群主本人不可移除——解散才是退出路径）；
    agent 成员：额外 end 影子会话 + 影子队列 pending 行删除 +
    shadow_status='none'。群内系统提示行由 task-03 消息管线补（本卡无
    群消息端点）。
    """
    group = await svc._get_group(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无需移除成员。",
            details={"group_id": str(group.id)},
        )
    member = await svc._get_member(group.id, member_id)
    if member.member_type == "user" and member.user_id == group.created_by:
        raise GroupChatInvalid(
            "群主不能被移除；如需结束群聊请使用解散操作。",
            details={"group_id": str(group.id)},
        )
    if member.member_type == "agent":
        await svc._end_member_shadow(
            member, owner_user_id=group.created_by, reason="member_removed"
        )
        # _end_member_shadow 已 commit；重新取行防 expire 后丢状态。
        member = await svc._get_member(group.id, member_id)
        member.shadow_status = "none"  # design §8 group.member.removed
    member.removed_at = datetime.now(UTC)
    svc._session.add(member)
    await svc._session.commit()
    # task-06（§5.3 audience）：移除后广播（受众=剩余成员；被移除者不再
    # 命中 audience，其列表刷新信号自然停发）。
    await svc._publish_group_sessions_changed(group, "status_changed")


async def reset_member_memory(
    svc,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User,
) -> GroupMemberRead:
    """重置 agent 成员记忆（design §6.1：end 影子置 pending，下次触发懒重建）。

    本卡影子会话尚不存在：实现为幂等置位（shadow_status='pending' +
    shadow_session_id 置 NULL）；已有影子时先走 end 影子链再置位
    （task-03 懒建消费本语义）。
    """
    group = await svc._get_group(group_id)
    await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    member = await svc._get_member(group.id, member_id)
    if member.member_type != "agent":
        raise GroupChatInvalid(
            "仅 agent 成员支持重置记忆。",
            details={"member_id": str(member.id)},
        )
    await svc._end_member_shadow(member, owner_user_id=group.created_by, reason="memory_reset")
    member = await svc._get_member(group.id, member_id)
    member.shadow_status = "pending"
    member.shadow_session_id = None
    svc._session.add(member)
    await svc._session.commit()
    await svc._session.refresh(member)
    return GroupMemberRead.model_validate(member)
