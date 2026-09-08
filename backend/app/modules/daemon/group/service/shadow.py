"""group 子域触发与影子会话懒建（task-09 拆分，task-03 design §4.3）。

群背景摘要加载（``_load_group_context_lines``）+ 影子注入 prompt 组装
（``_build_group_prompt``）+ 单成员触发核心（``_trigger_group_member``：
懒建/复用注入/忙轮中途注入/409 竞态排队兜底）+ 影子会话懒建三件套
（``_ensure_shadow_session`` 直接 ORM 建行 + grants 授权分支派发 +
首轮 SESSION_INJECT 下发）。方法体下沉自 GroupChatService，第一参数传
service 实例（svc）。

D-007：SessionService 为本命名空间 patch 目标（15 处），一律
``_gsvc.SessionService`` 延迟解析；``_send_shadow_first_inject`` 内的
session.service 懒加载（_resolve_daemon_id_for_runtime / get_session_readiness）
保持函数级 import 原样（patch 面与 session/service 一致）。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.group.service as _gsvc
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.daemon import attachment_pipeline
from app.modules.daemon.session.service import DaemonSessionTurnConflict

from .helpers import (
    GROUP_MEMBER_STAGE,
    GroupChatInvalid,
    GroupMemberTriggerRead,
    _attachment_prompt_lines,
)
from .typing_presence import _publish_group_channel_event

# 群背景摘要单条截断 / 总长上限（design §4.2）。
GROUP_CONTEXT_ENTRY_MAX_CHARS = 500
GROUP_CONTEXT_TOTAL_MAX_CHARS = 6000


# 忙轮中途注入标注行（quick 2026-09-02 群聊 steering）：复用轮查到活跃 run 时
# 包在 _build_group_prompt 产物**头部**（外层包不动纯函数）——消息将以中途新
# 指令形式注入当前正在执行的轮，提示 agent 优先阅读并调整工作方式。
_MID_TURN_NOTICE = (
    "【注意】以下是用户/成员在你任务执行中途发来的新消息，"
    "请优先阅读并据此调整当前工作方式，无需中断任务除非明确要求。"
)


# quick 投影统一标记制（2026-09-02）：群 @ 轮回应要求指示行——@轮投影与直聊
# 同款标记制（完整 assistant 文本仅 [[GROUP]] 段进群时间线），_build_group_prompt
# 在当前消息段后追加本行告知 agent 标记用法（run_sync.
# extract_group_broadcast_segments 按同款标记抽段，标记文本保留在影子会话
# 原文、投影时剥离；@轮整轮无标记时收口侧补兜底行防群里死寂）。
_GROUP_REPLY_MARKER_REQUIREMENT = (
    "回应要求：把给群内成员看的结论/回答放进 [[GROUP]] 与 [[/GROUP]] 标记段"
    "（会以你的身份发送到群里，简洁如聊天）；"
    "推理过程、工具使用细节写在标记段之外（只保留在你的内部会话中）。"
)


# ── 群背景摘要（design §4.2，task-03）───────────────────────────────────────


async def _load_group_context_lines(
    db: AsyncSession,
    *,
    group_session_id: uuid.UUID,
    context_window: int,
    members: Sequence[AgentGroupMember],
    exclude_log_id: uuid.UUID | None = None,
) -> list[str]:
    """查群时间线最近 ``context_window`` 条并组装摘要行（时间正序返回）。

    行源（§4.2）：``user_input`` 行（用户消息）+ 投影行（``channel='stdout'``
    且 ``metadata`` 含成员身份——task-05 桥接投影双写，本查询先兼容）。

    - 身份标签：用户行 = 发送者昵称（``metadata_.sender_member_name`` 优先，
      回退 ``run.user_id`` 查成员表）+ ``(用户)``；投影行 =
      ``metadata_.member_name`` + ``(Agent)``；
    - 单条截断 500 字、总长上限 6000 字符（超限**丢最旧**保最新）；
    - ``exclude_log_id``：当前消息行排除（它进「当前消息」段，不重复出现在
      背景里）。
    """
    from sqlalchemy import and_

    stmt = (
        select(AgentRunLog, AgentRun.user_id)
        .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
        .where(
            AgentRun.agent_session_id == group_session_id,
            or_(
                AgentRunLog.channel == "user_input",
                and_(
                    AgentRunLog.channel == "stdout",
                    AgentRunLog.metadata_.is_not(None),
                ),
            ),
        )
        .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
        .limit(max(context_window, 1))
    )
    rows = (await db.execute(stmt)).all()

    user_members_by_user: dict[uuid.UUID, AgentGroupMember] = {
        m.user_id: m for m in members if m.member_type == "user" and m.user_id is not None
    }
    # 时间倒序逐条组装；总长超限即停（丢弃的是更旧的行），最后反转回正序。
    kept_newest_first: list[str] = []
    total = 0
    for log_row, run_user_id in rows:
        if exclude_log_id is not None and log_row.id == exclude_log_id:
            continue
        meta = log_row.metadata_ or {}
        if log_row.channel == "user_input":
            name = meta.get("sender_member_name")
            if not name and run_user_id is not None:
                member = user_members_by_user.get(run_user_id)
                name = member.display_name if member is not None else None
            label = f"{name or '成员'}(用户)"
        else:
            label = f"{meta.get('member_name') or '成员'}(Agent)"
        content = (log_row.content_redacted or "").strip()
        if not content:
            continue
        line = f"{label}: {content[:GROUP_CONTEXT_ENTRY_MAX_CHARS]}"
        if kept_newest_first and total + len(line) > GROUP_CONTEXT_TOTAL_MAX_CHARS:
            break
        kept_newest_first.append(line)
        total += len(line)
    kept_newest_first.reverse()
    return kept_newest_first


def _build_group_prompt(
    *,
    group: AgentGroupChat,
    member: AgentGroupMember,
    member_lines: Sequence[str],
    context_lines: Sequence[str],
    sender_member_name: str,
    content: str,
    source_member_name: str | None = None,
    attachment_lines: Sequence[str] | None = None,
) -> str:
    """影子会话注入 prompt 组装（design §4.3：简报 + 群背景摘要 + 当前消息）。

    ``source_member_name``（task-04 互@协作消费）：非 None 表示当前消息来自
    Agent 成员的协作请求——当前消息行身份标签用 ``{source}(Agent)`` 且段头
    标注「来自 Agent 成员的协作请求」（design §4.4），否则 ``{sender}(用户)``。

    ``attachment_lines``（FR-05 补遗）：用户随消息发送的附件提示行
    （``[附件] name (file_id)`` 逐附件一条）——附 prompt 末尾提示 agent 可读
    （实际下发走 SESSION_INJECT attachments 通道：多模态块内联 / 磁盘落盘，
    与单聊同管线）；互@轮不携带（agent 消息无附件）。

    quick 投影统一标记制（2026-09-02）：末尾追加回应要求指示行
    （``_GROUP_REPLY_MARKER_REQUIREMENT``）——@轮仅 [[GROUP]] 标记段进群
    时间线，prompt 告知 agent 标记用法。
    """
    briefing = (
        f"你是群聊「{group.title}」中的 Agent 成员「{member.display_name}」。"
        f"成员：{'、'.join(member_lines)}。"
        "仅当消息 @你 或 @全体 时回应；回应简洁如聊天；"
        f"你的发言会以「{member.display_name}」身份出现在群里。"
    )
    if member.team_enabled:
        # 团队能力段（quick 群成员团队能力）：工具名与 daemon 主控注入一致
        # （mcp-server.ts：dispatch_worker / list_workers / get_worker_result /
        # converge_mission / report_progress），措辞对照 mission_context
        # build_worker_briefing can_dispatch 段保持群聊口吻——大任务拆分身、
        # 结论由成员本人汇总转述回群。
        briefing += (
            "团队能力：你可调用 dispatch_worker 派分身并行执行子任务（各分身有"
            "独立工作区副本），list_workers 查看分身进度，get_worker_result 读取"
            "分身产出，converge_mission 收敛合并结果，report_progress 上报进度；"
            "大任务建议拆给分身干，你汇总结论回群。分身产出不会自动出现在群里，"
            "由你转述。"
        )
    # quick-6966fcee 注入分离展示：简报/群背景/回应要求合并为前导块（单聊
    # dispatch_prompt 同款形态——【群聊上下文】头 + "\n\n---\n\n" 分隔出真实
    # 用户消息），前端 extractPreambleText 剥离（对话视图只显示真实消息，
    # 注入上下文进「进度」视图 preamble 段默认收起）。
    parts = [f"【群聊上下文】\n{briefing}"]
    if context_lines:
        parts.append("[群聊记录 · 背景，仅供了解上下文]\n" + "\n".join(context_lines))
    sender_label = (
        f"{source_member_name}(Agent)"
        if source_member_name is not None
        else f"{sender_member_name}(用户)"
    )
    current_header = (
        "[当前消息 · 来自 Agent 成员的协作请求，需要你回应]"
        if source_member_name is not None
        else "[当前消息 · 需要你回应]"
    )
    if attachment_lines:
        parts.append(
            "[当前消息附件 · 用户随消息发送，可直接读取参考]\n" + "\n".join(attachment_lines)
        )
    # quick 投影统一标记制（2026-09-02）：回应要求指示行——@轮仅 [[GROUP]]
    # 标记段进群时间线（与直聊同款），告知 agent 标记用法。
    parts.append(_GROUP_REPLY_MARKER_REQUIREMENT)
    # 真实用户消息主体置于前导分隔符之后（extractPreambleText 按首个
    # "\n\n---\n\n" 切分——前导块在前，current_header+消息为干净主体）。
    return "\n\n".join(parts) + "\n\n---\n\n" + current_header + "\n" + f"{sender_label}: {content}"


# ── GroupChatService 方法体下沉（第一参数 svc = service 实例，self→svc）───


async def _trigger_group_member(
    svc,
    *,
    group: AgentGroupChat,
    member: AgentGroupMember,
    members: list[AgentGroupMember],
    member_lines: list[str],
    sender_user_id: uuid.UUID,
    sender_member_name: str,
    content: str,
    carrier_run_id: uuid.UUID,
    exclude_log_id: uuid.UUID | None,
    source_member_name: str | None = None,
    chain_depth: int = 0,
    attachment_rows: list | None = None,
) -> GroupMemberTriggerRead:
    """触发单个 agent 成员（design §4.1 步 6 / §8 member.injected）。

    prompt 先组装（即时注入与忙轮注入/排队共用同一文本——排队快照按入队
    时刻冻结，design §9.7）；随后影子懒建（首次）或复用注入（quick
    2026-09-02 忙轮策略翻转：查到活跃 run → prompt 头部包中途标注行 +
    ``inject_session_as_service`` busy_strategy="inject" 直接注入当前
    活跃轮；409 竞态降级回既有 ``queue_when_busy`` 排队分支，满 5 → 409
    DaemonSessionQueueFull）。

    ``sender_user_id``：触发方用户 id——用户 @ 路径=实际发送者，互@路径
    （task-04）=群主（服务身份，§9.2 计量归属）；``source_member_name``/
    ``chain_depth`` 为互@协作参数（链沿用原载体 run、深度 +1）。

    ``attachment_rows``（FR-05 补遗）：用户随消息发送的已校验附件行——
    prompt 末尾附提示行 + SESSION_INJECT attachments 通道下发（多模态块
    内联/磁盘落盘，与单聊同管线）；互@路径不携带（agent 消息无附件）。
    非 Claude 成员引擎 → 400（单聊引擎门控 D-6 同口径，群错误族）。
    """
    # 引擎门控（单聊 D-6 同口径：仅 Claude 支持附件）——发送侧已过归属/
    # 数量校验并落时间线，此处 fail-loud 拒绝触发（消息保留可重发仅触发）。
    attachment_lines: list[str] = []
    if attachment_rows:
        if (member.provider or "claude") != "claude":
            raise GroupChatInvalid(
                f"成员「{member.display_name}」的引擎不支持附件"
                "（仅 Claude 支持多模态与文件注入）。",
                details={"member_id": str(member.id), "provider": member.provider},
            )
        attachment_lines = _attachment_prompt_lines(attachment_rows)

    context_lines = await _load_group_context_lines(
        svc._session,
        group_session_id=group.session_id,
        context_window=group.context_window,
        members=members,
        exclude_log_id=exclude_log_id,
    )
    prompt = _build_group_prompt(
        group=group,
        member=member,
        member_lines=member_lines,
        context_lines=context_lines,
        sender_member_name=sender_member_name,
        content=content,
        source_member_name=source_member_name,
        attachment_lines=attachment_lines,
    )
    # 群链路 metadata（§4.3 注入 / §4.4 链 id 透传）：写本轮 user_input 日志
    # metadata_ 列——task-04 turn_completed 互@检测读取（排队派发的透传
    # 见 dispatch_next_queued_message 侧 task-04 接线）。
    turn_metadata = {
        "source_group_id": str(group.id),
        "source_member_id": str(member.id),
        "source_carrier_run_id": str(carrier_run_id),
        "chain_depth": chain_depth,
        "sender_user_id": str(sender_user_id),
        # quick-6966fcee 注入分离展示：真实用户消息原文（不含成员简报/群
        # 背景/回应要求等注入上下文）——影子会话与群时间线的用户气泡优先
        # 显示本字段，完整注入文本折叠为「已注入上下文」可展开。
        "user_message": content,
    }
    if source_member_name is not None:
        # 互@轮：来源是 Agent 成员（无 user 行）——记成员身份供审计/展示。
        turn_metadata["sender_member_name"] = source_member_name
        turn_metadata["sender_member_kind"] = "agent"

    shadow, first_run_id = await svc._ensure_shadow_session(
        group,
        member,
        first_prompt=prompt,
        first_turn_metadata=turn_metadata,
        attachment_rows=attachment_rows,
    )
    if first_run_id is not None:
        # 首次触发：懒建事务内已落首轮 run + SESSION_INJECT（附件 payload 在
        # _ensure_shadow_session 内组装下发——见 _send_shadow_first_inject）。
        return GroupMemberTriggerRead(
            member_id=member.id,
            member_name=member.display_name,
            shadow_session_id=shadow.id,
            run_id=first_run_id,
            queued=False,
        )

    # quick（2026-09-02 群聊忙轮注入 steering）：复用轮忙轮策略翻转——
    # 查活跃 run：命中 → prompt 头部插一行中途标注（在 _build_group_prompt
    # 产物外层包，不动其纯函数），消息经 busy_strategy="inject" 直接注入
    # 当前活跃轮（不再等轮终态派发排队条目——实测排队延迟=轮时长，用户
    # 中途指令轮结束才被看到）；409 竞态（注入瞬间轮刚好终态）由调用点
    # 捕获 DaemonSessionTurnConflict 降级回既有排队兜底。
    active_run = await svc._get_shadow_active_run(shadow.id)
    inject_prompt = prompt
    if active_run is not None:
        inject_prompt = f"{_MID_TURN_NOTICE}\n{prompt}"

    # 复用轮：注入共享核心（run user_id=影子属主=群主，§9.2；忙轮 → 中途
    # 注入活跃 run，竞态 409 → 排队兜底，entry.sender_user_id=实际发送者）。
    # 附件透传：attachment_ids + 归属基准覆盖=发送者（影子属主是群主，附件
    # 上传者是发送者——按属主校验会误拒；排队派发侧从链标记 sender_user_id
    # 同口径推导）。
    try:
        result = await _gsvc.SessionService(svc._session).inject_session_as_service(
            shadow.id,
            prompt=inject_prompt,
            busy_strategy="inject",
            queue_when_busy=True,
            queue_sender_user_id=sender_user_id,
            turn_metadata=turn_metadata,
            attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
            attachment_owner_user_id=sender_user_id if attachment_rows else None,
        )
    except DaemonSessionTurnConflict:
        # 409 竞态兜底：注入瞬间轮刚好终态（或降级排队场景）→ 走既有落队
        # 分支（满 5 → 409 DaemonSessionQueueFull），消息不丢。
        result = await _gsvc.SessionService(svc._session).inject_session_as_service(
            shadow.id,
            prompt=inject_prompt,
            queue_when_busy=True,
            queue_sender_user_id=sender_user_id,
            turn_metadata=turn_metadata,
            attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
            attachment_owner_user_id=sender_user_id if attachment_rows else None,
        )
    return GroupMemberTriggerRead(
        member_id=member.id,
        member_name=member.display_name,
        shadow_session_id=shadow.id,
        run_id=result.agent_run.id if result.agent_run is not None else None,
        queued=result.queued,
        mid_turn=result.mid_turn,
    )


async def _get_shadow_active_run(svc, shadow_session_id: uuid.UUID) -> AgentRun | None:
    """查影子会话当前活跃轮（quick 2026-09-02 忙轮注入判定）。

    谓词与 SessionService._get_current_run 同源（ACTIVE_RUN_STATUSES 单一
    词表 import，勿内联状态元组）；锁外查询仅作中途标注的判定基准——
    真正的忙轮判定在 inject 行锁内（竞态最坏=标注有无与实际路径错位一行
    文案，消息不丢）。
    """
    stmt = select(AgentRun).where(
        AgentRun.agent_session_id == shadow_session_id,
        AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
    )
    return (await svc._session.execute(stmt)).scalars().first()


async def _ensure_shadow_session(
    svc,
    group: AgentGroupChat,
    member: AgentGroupMember,
    *,
    first_prompt: str,
    first_turn_metadata: dict,
    attachment_rows: list | None = None,
) -> tuple[AgentSession, uuid.UUID | None]:
    """影子会话懒建（design §4.3 / §8 shadow.created，照 worker 三件套）。

    返回 ``(影子会话, 首轮 run id)``——**首轮 run id 非 None 表示本次为
    懒建**（首轮 run + lease + SESSION_INJECT 已在事务内完成）；None 表示
    复用既有影子（调用方走 inject 排队/注入路径）。

    三件套（``_dispatch_worker_core`` mcp_tools.py 先例）：

    1. 直接 ORM 建行（不走 create_session——审批开关生效位在
       ``AgentSession.config`` 列，permission_service 按其门控；影子
       ``manual_approval=False``，§9.1 审批不进群）；
    2. ``prepare_interactive_dispatch``（flush-only）：pinned_runtime_id=
       成员机器、cwd=成员工作区根、stage='group_member'（``team_enabled``
       成员用 'orchestrator'——daemon 主控谓词据此注入团队 5 工具，见下方
       派发段注释）；**机器授权走
       grants 分支**（``skip_owner_check=False`` + ``workspace_id=群工作区``
       ——属主命中或 workspace grant 授权才放行；**不照抄 worker 的
       ``skip_owner_check=True``**，D-010：群成员机器是群主任意选择的，
       无授权 → 400 fail-loud 零残留）；
    3. 回填成员表 ``shadow_session_id`` / ``shadow_status='active'``。

    首轮下发照 ``create_session`` 尾段：lease metadata prompt 作 daemon 建
    会话兜底 + readiness 后 SESSION_INJECT 控制指令发完整组装 prompt
    （daemon inject() 清 pendingFirstPrompt，无双重轮次——create_session
    P0 修复注释口径）。``parent_session_id`` 恒 NULL（D-007/§5.1）。
    """
    # 幂等复用：指针非空且影子非终态 → 直接复用（懒建只在首次触发发生）。
    # quick 群 P1（2026-09-02 并发双建修复）：幂等判定前先以行锁重读成员行
    # （SELECT ... FOR UPDATE，照 auth/service.py refresh-token 并发先例；
    # SQLite 忽略锁提示、语义不变）——并发触发同一成员时，第二个事务在
    # 成员行上等锁，首个事务 commit（回填指针）后读到已回填指针直接复用，
    # 不再双建影子。populate_existing 强制刷新 identity map 内既有对象——
    # 不带则查询命中缓存旧快照，调用方传入的 member 指针仍是 NULL。锁在
    # 调用方事务内持有至 commit，不新增 commit。
    locked_member = (
        await svc._session.execute(
            select(AgentGroupMember)
            .where(AgentGroupMember.id == member.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if locked_member is not None:
        member = locked_member
    if member.shadow_session_id is not None:
        existing = await svc._session.get(AgentSession, member.shadow_session_id)
        if existing is not None and existing.status not in ("ended", "failed"):
            return existing, None
        # 指针悬挂（reset-memory 后重建 / 派发失败残留）→ 走下方新建，
        # 旧行留史，成员指针更新到新影子。

    from app.modules.agent.placement import (
        NoOnlineDaemonError,
        RunPlacementService,
    )

    if member.runtime_id is None:
        raise GroupChatInvalid(
            f"成员「{member.display_name}」缺少机器配置，无法触发。",
            details={"member_id": str(member.id)},
        )
    provider = member.provider or "claude"

    # cwd = 成员工作区根（六要素②；缺省建群时已落群工作区）。
    cwd: str | None = None
    if member.workspace_id is not None:
        from app.modules.workspace.model import Workspace
        from app.modules.workspace.service import resolve_root_path_for_daemon

        member_ws = await svc._session.get(Workspace, member.workspace_id)
        if member_ws is not None and member_ws.root_path:
            cwd = resolve_root_path_for_daemon(member_ws.root_path)

    # 档案行（快照 + lease 提示词维度下推用；缺省 None 零分支）。
    profile = None
    if member.agent_profile_id is not None:
        from app.modules.agent.profile.model import AgentProfile

        profile = await svc._session.get(AgentProfile, member.agent_profile_id)

    now = datetime.now(UTC)
    # ① 影子会话行（parent 恒 NULL——群↔影子唯一关联通道是成员表反向指针）。
    shadow = AgentSession(
        id=uuid.uuid4(),
        user_id=group.created_by,  # 计量归属=群主（§9.2；影子 user_id 同源）
        runtime_id=None,  # 派发后回填（dispatch.runtime_id==钉定机器）
        lease_id=None,  # 同上
        provider=provider,
        status="pending",  # 事务内随 lease 回填激活为 active
        # quick-6966fcee 意图是放开 AskUserQuestion 弹窗（影子已挂完整
        # SessionPanel 可作答），但彼时只删了 manual_approval=False——
        # permission_service 的闸门是 `config.get("manual_approval") is not
        # True` 即拒，删 key（config=null）与 False 同样被丢，agent 提问
        # 被吞、前端收不到、agent 死等（quick-bfec20a6 实证：事故会话
        # e148364e 弹窗请求 0 行 + 日志 permission_request_manual_disabled）。
        # 对齐 placement stage 路径（placement.py:556 同坑先修）显式写 True；
        # ask_user_only 与 lease metadata（placement 统一 True）同形。
        config={"manual_approval": True, "ask_user_only": True},
        turn_count=0,
        created_at=now,
        workspace_id=member.workspace_id,
        title=f"群「{group.title}」·{member.display_name}",
        session_kind="group_member",
        parent_session_id=None,  # D-007：恒 NULL（§5.1 硬约束）
        agent_profile_id=member.agent_profile_id,
        llm_provider_id=member.llm_provider_id,
    )
    svc._session.add(shadow)
    await svc._session.flush()

    # 首轮 run（interactive 驱动；挂影子会话、user_id=群主）——lease
    # metadata.run_id 必须指向真实 run（daemon claim/上报按 run 对账，
    # 假 id 会让 daemon 上报打到不存在的 run 上）。
    from app.modules.agent.service import _build_agent_profile_snapshot

    first_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider=provider,
        status="pending",
        spec_strategy="interactive",
        agent_session_id=shadow.id,
        user_id=group.created_by,
        agent_profile_id=member.agent_profile_id,
        agent_profile_snapshot=(
            _build_agent_profile_snapshot(profile) if profile is not None else None
        ),
        llm_provider_id=member.llm_provider_id,
    )
    svc._session.add(first_run)
    await svc._session.flush()
    # 首轮 user_input 日志：完整组装 prompt（与排队快照同口径）+ 群链路
    # metadata（含发送者——run.user_id 是群主，真实发送者只在此处）。
    svc._session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=first_run.id,
            channel="user_input",
            content_redacted=first_prompt[:5000],
            timestamp=now,
            metadata_=dict(first_turn_metadata),
        )
    )

    # ② interactive lease（flush-only；grants 授权分支见 docstring）。
    # 失败分支的 message/details 值先取局部（rollback 会 expire 会话内全部
    # 对象，过期属性访问在 greenlet 外炸 MissingGreenlet——worker 预检先例）。
    member_name = member.display_name
    member_id_str = str(member.id)
    runtime_id_str = str(member.runtime_id)
    placement = RunPlacementService(svc._session)
    try:
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=shadow.id,
            agent_run_id=first_run.id,
            user_id=group.created_by,
            provider=provider,
            prompt=first_prompt,
            model=None,  # 模型走 llm_provider_id → lease metadata（下方）
            workspace_id=group.workspace_id,  # grants 授权作用域=群工作区
            cwd=cwd,
            pinned_runtime_id=member.runtime_id,
            pinned_skip_owner_check=False,  # D-010：不照抄 worker 豁免
            # 团队能力（quick 群成员团队能力）：开启时 stage='orchestrator'
            # 命中 daemon isMainAgentSession 谓词（cli.ts：stage==''||
            # 'orchestrator' 且 provider=claude）→ 注入 dispatch_worker 等
            # 5 主控工具；配置侧（建群/加成员/PATCH）已校验仅 Claude 可开。
            # stage 随 lease 建时定——热切换开关走 update_member 机器组
            # 重建分支（复用轮改不掉 stage）。
            stage="orchestrator" if member.team_enabled else GROUP_MEMBER_STAGE,
        )
    except NoOnlineDaemonError as exc:
        # 无授权/离线/掉线 → 400 fail-loud，事务回滚零残留（不建孤儿影子）。
        await svc._session.rollback()
        raise GroupChatInvalid(
            f"成员「{member_name}」的机器当前不可用或未授权，无法触发。",
            details={
                "member_id": member_id_str,
                "runtime_id": runtime_id_str,
                "reason": str(exc),
            },
        ) from exc

    # 档案提示词维度 / 会话级供应商下推（照 create_session :1867-1914）。
    if profile is not None:
        from app.modules.agent.service import AgentService

        await AgentService(svc._session).apply_session_profile_to_lease(dispatch.lease_id, profile)
    if member.llm_provider_id is not None:
        from app.modules.daemon.session.service import _merge_lease_metadata

        await _merge_lease_metadata(
            svc._session,
            dispatch.lease_id,
            {"session_llm_provider_id": str(member.llm_provider_id)},
        )

    # ③ 回填 + 激活 + 成员表指针（单 commit 收口三元组）。
    shadow.runtime_id = dispatch.runtime_id
    shadow.lease_id = dispatch.lease_id
    shadow.status = "active"
    svc._session.add(shadow)
    member.shadow_session_id = shadow.id
    member.shadow_status = "active"
    svc._session.add(member)
    await svc._session.commit()

    # 唤醒 daemon（lease pending 等 daemon 轮询自领取；不可达仅告警——
    # worker 路径同口径，lease 不作废）。
    delivered = await placement.notify_interactive_dispatch(dispatch)
    shadow_id = shadow.id
    if not delivered:
        # WS 完全不可达：收口影子终态（照 create_session 失败收敛语义），
        # 成员置 failed——下次触发按重建路径重试（上方幂等分支放行重建）。
        _gsvc.log.warning(
            "group_shadow_dispatch_wake_failed",
            group_id=str(group.id),
            member_id=str(member.id),
            shadow_session_id=str(shadow_id),
        )
        try:
            fresh_shadow = await svc._session.get(AgentSession, shadow_id)
            fresh_run = await svc._session.get(AgentRun, first_run.id)
            fresh_member = await svc._session.get(AgentGroupMember, member.id)
            if fresh_shadow is not None:
                fresh_shadow.status = "failed"
                fresh_shadow.ended_at = datetime.now(UTC)
                svc._session.add(fresh_shadow)
            if fresh_run is not None:
                fresh_run.status = "failed"
                fresh_run.finished_at = datetime.now(UTC)
                fresh_run.error_code = "no_online_daemon"
                svc._session.add(fresh_run)
            if fresh_member is not None:
                fresh_member.shadow_status = "failed"
                svc._session.add(fresh_member)
            await svc._session.commit()
        except Exception:
            await svc._session.rollback()
            _gsvc.log.warning(
                "group_shadow_failed_convergence_error", shadow_session_id=str(shadow_id)
            )
        from app.modules.daemon.session.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            f"成员「{member.display_name}」的执行机器当前不在线，本轮未能触发；"
            "消息已进群时间线，请稍后重试。",
            details={
                "runtime_id": str(dispatch.runtime_id),
                "session_id": str(shadow_id),
                "member_id": str(member.id),
            },
        )

    # 首轮 SESSION_INJECT（照 create_session :2080-2127）：readiness 等待后
    # 控制指令三段式下发（WS 失败落库 pending 待补拉；lease metadata prompt
    # 为 daemon 侧兜底，不失败）。FR-05 补遗：附件 payload 组装（MinIO 读）
    # 在 commit 后进行——不进写事务（单聊 P1 预组装同理由）。
    first_inject_attachments: list[dict] = []
    if attachment_rows:
        first_inject_attachments = await svc._assemble_group_inject_attachments(
            attachment_rows, member=member, owner_user_id=group.created_by
        )
    await svc._send_shadow_first_inject(
        shadow_id=shadow_id,
        lease_id=dispatch.lease_id,
        run_id=first_run.id,
        prompt=first_prompt,
        claim_token=dispatch.claim_token,
        runtime_id=dispatch.runtime_id,
        inject_attachments=first_inject_attachments,
    )
    await _publish_group_channel_event(
        shadow_id,
        {"event": "turn_injected", "session_id": str(shadow_id), "run_id": str(first_run.id)},
    )
    return shadow, first_run.id


async def _assemble_group_inject_attachments(
    svc,
    rows: list,
    *,
    member: AgentGroupMember,
    owner_user_id: uuid.UUID,
) -> list[dict]:
    """群链路附件 → SESSION_INJECT payload attachments 列表（FR-05 补遗）。

    口径照单聊 ``_assemble_inject_attachment_payload`` + ``_resolve_inject_gate``
    （复用 session_attachment 组装/门控函数，单一实现不复制粘贴）：gate 基准
    = 影子会话维度——属主=群主（``owner_user_id``，成员供应商行的归属者）、
    会话级供应商=成员六要素 ``llm_provider_id``、引擎=成员 ``provider``。
    组装产物（deliver=block 内联/回拉、disk 落盘）与单聊 SESSION_INJECT
    attachments 同形态，daemon 侧零改动。

    task-11 轻重构⑤：gate 解析与组装调用收敛到
    ``daemon/attachment_pipeline.resolve_multimodal_gate`` /
    ``assemble_attachments``（与单聊 inject/create 路径单源）。
    """
    provider = member.provider or "claude"
    supports = await attachment_pipeline.resolve_multimodal_gate(
        svc._session,
        user_id=owner_user_id,
        session_llm_provider_id=member.llm_provider_id,
        agent_kind=provider,
    )
    return await attachment_pipeline.assemble_attachments(rows, supports_multimodal=supports)


async def _send_shadow_first_inject(
    svc,
    *,
    shadow_id: uuid.UUID,
    lease_id: uuid.UUID,
    run_id: uuid.UUID,
    prompt: str,
    claim_token: str,
    runtime_id: uuid.UUID,
    inject_attachments: list[dict] | None = None,
) -> None:
    """首轮 SESSION_INJECT 控制指令下发（照 ``create_session`` 尾段）。

    readiness 等待（daemon 建会话完成再注入，防 ``session_not_found`` 丢
    指令；超时 fallback 仍发——兼容不上报 ready 的旧 daemon）→ 控制指令
    三段式（落库 pending + WS 推送 + delivered 标记）：WS 失败保留 pending
    待 daemon 补拉，**不让首轮触发整体失败**（lease metadata prompt 是
    daemon 侧兜底）。函数级 import 保持 patch 面与 session/service 一致
    （测试 mock ``get_session_readiness`` 于源模块生效）。

    ``inject_attachments``（FR-05 补遗）：组装好的附件 payload 列表——
    仅非空时附加（单聊 task-06 同口径：旧 daemon 忽略未知键，协议向后
    兼容）。
    """
    from app.modules.daemon.control_commands import (
        KIND_SESSION_INJECT,
        ControlCommandService,
    )
    from app.modules.daemon.session.service import (
        _resolve_daemon_id_for_runtime,
        get_session_readiness,
    )

    ready = await get_session_readiness().wait(shadow_id, timeout=8)
    if not ready:
        _gsvc.log.warning("group_shadow_ready_timeout", shadow_session_id=str(shadow_id))
    daemon_id = await _resolve_daemon_id_for_runtime(svc._session, runtime_id)
    if daemon_id is None:
        _gsvc.log.warning(
            "group_shadow_inject_no_daemon",
            shadow_session_id=str(shadow_id),
            runtime_id=str(runtime_id),
        )
        return
    inject_payload: dict[str, object] = {
        "session_id": str(shadow_id),
        "lease_id": str(lease_id),
        "run_id": str(run_id),
        "prompt": prompt,
        "claim_token": claim_token,
        "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
    }
    if inject_attachments:
        inject_payload["attachments"] = inject_attachments
    _row, control_ok = await ControlCommandService(svc._session).enqueue_and_push(
        daemon_id=daemon_id,
        runtime_id=runtime_id,
        kind=KIND_SESSION_INJECT,
        payload=inject_payload,
    )
    if not control_ok:
        _gsvc.log.warning(
            "group_shadow_inject_control_pending",
            shadow_session_id=str(shadow_id),
            run_id=str(run_id),
        )
