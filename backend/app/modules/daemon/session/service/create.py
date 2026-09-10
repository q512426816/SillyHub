"""create_session 写事务编排（task-08 拆分，原 :1167-2222）。

前置校验/绑定/workspace/PPM 解析下沉 ``inject_gates._resolve_create_inputs``
（分步函数）；首句附件校验/组装下沉 ``attachments``；PPM 物化/失败收敛在
``ppm_activation``（经类壳委托）。本文件保留写事务编排 + 派发段，方法体
逐字节搬移（仅 self→svc、D-007 patch 符号经 ``_svc.`` 延迟解析）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

import app.modules.daemon.session.service as _svc
from app.modules.agent.model import (
    USER_INPUT_LOG_MAX_CHARS,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.change.model import ChangeSessionLink
from app.modules.daemon.control_commands import KIND_SESSION_INJECT, ControlCommandService
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.daemon.schema import (
    PageContextCreateBlock,
    TeamMissionCreateBlock,
)
from app.modules.ppm.common.session_binding import PpmItemKind, bind_session_to_ppm_item

from .attachments import assemble_create_attachments
from .errors import (
    DaemonSessionNotActive,
    DaemonSessionRuntimeUnavailable,
)
from .helpers import _resolve_daemon_id_for_runtime, _strip_team_command_prefix
from .inject_gates import _resolve_create_inputs
from .results import SessionDispatchResult, _PreparedPpmAttachment


async def create_session(
    svc,
    user_id: uuid.UUID,
    *,
    provider: str | None,
    prompt: str,
    model: str | None = None,
    manual_approval: bool = False,
    ask_user_only: bool = False,
    change_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    # 2026-08-14-sessions-portal task-02：新页面双入口 + 会话配置字段透传占位。
    # task-03 落地解析：runtime_id（优先于 provider，钉定机器+智能体并派生
    # provider）/ agent_profile_id（只注 system_prompt+mcp/skill，D-013）/
    # llm_provider_id（写 lease metadata session_llm_provider_id）。
    runtime_id: str | None = None,
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    # task-09（2026-08-24-session-team-mission-context / FR-05/06）：预会话
    # 团队任务块——事务前共享校验 + E2 主 agent 工作区解析；事务内 flush-only
    # 预建 mission + 首 run 双标记 + 首 prompt 团队简报前缀。缺省 None 零
    # 分支进入（无 team_mission 的 create 行为逐字节不变）。
    team_mission: TeamMissionCreateBlock | None = None,
    # 2026-08-25-unified-floating-session（FR-5 / D-005）：悬浮入口页面上下文
    # 块——仅 page_key 枚举 + 实体 id，前导数据服务端回查；缺省 None 零回归。
    page_context: PageContextCreateBlock | None = None,
    # task-08（2026-08-25-session-spec-binding / FR-04 / FR-06）：快速修复
    # 短码——创建落库点 bind_session_to_quicklog 补写 quicklog_session_links
    # （savepoint best-effort，失败仅 warning 不阻断创建主事务与 201）。
    # 缺省 None 零分支进入（零回归）。
    quicklog_id: str | None = None,
    # task-02（2026-08-28-session-ppm-task-binding / FR-01 / D-005@v1 /
    # D-004@v2）：PPM 条目成对绑定字段——item 存在性校验与工作区解析在写
    # 事务前（查无记 ``session_ppm_bind_item_missing`` warning 降级普通会话，
    # §9 不 4xx）；落 ppm_item_session_links 在写事务内（quicklog 分支旁）；
    # AgentSession.workspace_id 未显式指定时回填解析值。缺省 None 零分支
    # 进入（零回归）。前导注入/附件物化归 task-03，本方法不实现。
    ppm_item_kind: PpmItemKind | None = None,
    ppm_item_id: uuid.UUID | None = None,
    # task-04（2026-08-25-team-subsession-governance / FR-02 / design §5.B）：
    # 分身子会话形态参数组（task-05 dispatch_worker 换三元组派发时传入）：
    # parent_session_id 写 AgentSession.parent_session_id（会话树挂载，
    # D-001@v1）；stage 透传 prepare_interactive_dispatch 写 lease
    # metadata.stage（软依赖 task-03 的扩展形参——仅显式传入才透传）；
    # first_run_mission_id / first_run_role 为首 run 双标记（缺省回落
    # team_mission 预建的 mission.id + 'orchestrator' 原值）。owner 不另设
    # 参数——分身形态归属即 user_id 入参本身（task-05 传 mission.created_by，
    # D-004@v1）。全缺省 None 时本方法行为逐字节不变（既有三路零回归）。
    parent_session_id: uuid.UUID | None = None,
    stage: str | None = None,
    first_run_mission_id: uuid.UUID | None = None,
    first_run_role: str | None = None,
    # ql-20260825-001：预会话首句附件——校验/标记行/组装/回填复用 inject 路径
    # 既有逻辑（D-6 引擎门控 / 归属 404 / 数量 422 / marker 行回显 /
    # SESSION_INJECT attachments）。缺省 None = 旧调用行为逐字节不变。
    attachment_ids: list[uuid.UUID] | None = None,
) -> SessionDispatchResult:
    """Create an interactive session + first-turn run + interactive lease.

    FR-01 / design §7.6 step 1. The session, run and lease are committed
    atomically (D-005@v1 triple), then the daemon is woken. If the wake-up
    cannot be delivered the triple is converged to failed terminal states
    and DaemonRuntimeOffline is raised so no active session lingers.

    task-03 双入口：``runtime_id``（/sessions 新页面，Grill C-01 钉定）与
    ``provider``（/runtimes 弹窗旧路径，零回归）二选一，前者优先。

    task-09：``team_mission`` 携带时预建 mission（session 模式 flush-only，
    共用本方法唯一 commit）——详见函数内 task-09 分段注释。

    task-04（2026-08-25-team-subsession-governance / FR-02 / design §5.B）：
    ``parent_session_id`` / ``stage`` / ``first_run_mission_id`` /
    ``first_run_role`` 显式传入时进入分身子会话形态——AgentSession 挂
    parent、首 run 带双标记、stage 进 lease metadata；归属即 ``user_id``
    入参（调用方传 mission.created_by，D-004@v1）。全缺省 None 零分支进入
    （既有 quick-chat / 变更会话 / 团队主控三路行为逐字节不变）。
    """
    # ql-20260825-001（D-7 对齐 inject）：纯文本首句需非空 prompt；附件
    # 非空允许空 prompt（看图说话）。
    if (not prompt or not prompt.strip()) and not attachment_ids:
        raise DaemonSessionNotActive(
            "prompt must not be empty.",
            details={"reason": "empty_prompt"},
        )

    from app.modules.agent.placement import (
        NoOnlineDaemonError,
        RunPlacementService,
    )

    # ── task-08 拆分：前置校验/绑定/workspace/PPM 解析经 inject_gates 分步
    # 函数完成（零改写），此处展开回局部变量供写事务编排原样消费。──
    inputs = await _resolve_create_inputs(
        svc,
        user_id,
        provider=provider,
        model=model,
        manual_approval=manual_approval,
        workspace_id=workspace_id,
        runtime_id=runtime_id,
        agent_profile_id=agent_profile_id,
        llm_provider_id=llm_provider_id,
        team_mission=team_mission,
        ppm_item_kind=ppm_item_kind,
        ppm_item_id=ppm_item_id,
        attachment_ids=attachment_ids,
    )
    _platform_binding = inputs.platform_binding
    pinned_runtime_id = inputs.pinned_runtime_id
    provider = inputs.provider
    model = inputs.model
    manual_approval = inputs.manual_approval
    validated_attachments = inputs.validated_attachments
    profile = inputs.profile
    llm_provider_row = inputs.llm_provider_row
    workspace_id = inputs.workspace_id
    cwd = inputs.cwd
    mission_scope_ids = inputs.mission_scope_ids
    mission_anchor_id = inputs.mission_anchor_id
    ppm_item_ok = inputs.ppm_item_ok
    ppm_ws = inputs.ppm_ws
    ppm_item_row = inputs.ppm_item_row

    now = datetime.now(UTC)
    # Copy config so the request dict is never mutated (boundary #16).
    config: dict = {
        "manual_approval": bool(manual_approval),
    }
    if model:
        config["model"] = model

    try:
        # ── ql-20260825-002-3e67（P2 二审 #5）：前导组装提前到写事务外 ──
        # change/page 前导 = 只读查询 + asyncio.to_thread 磁盘遍历；组装完毕
        # 立即 commit 收口只读事务，首个写 flush（AgentSession INSERT）晚于该
        # commit——磁盘 IO 不落在写事务窗口内（回归守卫：
        # test_session_optimize_round2.py::TestCreateSessionPreambleBeforeWrite）。
        # expire_on_commit=False（app/core/db.py:94），收口后上方已加载的
        # profile/provider/workspace 行仍可安全取属性。写块共用方法末尾的
        # 唯一 commit，中途异常整体回滚，无孤儿 session/mission。
        from app.modules.daemon.session.context import (
            build_change_context_preamble,
            build_page_context_preamble,
            build_platform_rules_preamble,
            build_ppm_item_context_preamble,
            build_sillyspec_preamble,
            build_user_preamble,
        )

        # 2026-07-09-change-detail-session / D-004@v1（X-02/X-04）：变更会话首轮
        # 注入【变更上下文】前导。dispatch prompt = 前导+用户消息，经 lease
        # metadata 的 prompt 字段透传到 daemon _startInteractiveSession 构造
        # 首条 user 消息。AgentRunLog(user_input) 与 SESSION_INJECT 的 prompt
        # 仍写干净用户消息（列表标题 / 回放 / 展示干净）。零 daemon 改动。
        preamble = await build_change_context_preamble(svc._session, change_id)
        # ── 2026-08-25-unified-floating-session（FR-5 / D-005）：页面上下文前导 ──
        # 数据服务端回查（build_page_context_preamble 内部 DB.get），客户端
        # 仅 page_key 枚举 + project_id；查无/未传 → None 不注入。
        page_preamble = (
            await build_page_context_preamble(
                svc._session,
                page_context.page_key,
                page_context.project_id,
                page_context.route_key,
                page_context.workspace_id,
                page_context.tab_key,
            )
            if page_context is not None
            else None
        )
        # ── task-03（2026-08-28-session-ppm-task-binding / FR-03 / D-003/D-006/
        # D-007）：PPM 附件物化 + PPM 条目前导，执行序＝物化在前、前导消费
        # attachment_lines（design §5 Phase 2 不变量）──同样只落「写事务外」段：
        # storage 读 IO（file bytes 读取 + session attachment store_bytes）/
        # ``_can_access`` / 降级决策全部在本只读事务窗口内完成（首个写 flush
        # 晚于下方 commit，对齐上方前导段的结构守卫）；``SessionAttachment``
        # 行 insert 归写事务内（session.id 已知后，见下方组装段）。
        ppm_preamble: str | None = None
        ppm_prepared_attachments: list[_PreparedPpmAttachment] = []
        if ppm_item_ok:
            _ppm_lines, ppm_prepared_attachments = await svc._materialize_ppm_attachments(
                user_id=user_id,
                kind=ppm_item_kind,
                item_id=ppm_item_id,
                provider=provider,
                manual_attachments=validated_attachments,
                item=ppm_item_row,
            )
            ppm_preamble = await build_ppm_item_context_preamble(
                svc._session,
                ppm_item_kind,
                ppm_item_id,
                attachment_lines=_ppm_lines,
                item=ppm_item_row,
            )
        # ── 2026-08-29-session-user-preamble（ql-20260829-012-2eb3 /
        # D-001/D-002/FR-01~FR-04）：用户信息 + 平台规则 + SillySpec 工具
        # 规则三前导，同样只落「写事务外」段——.sillyspec/ 探测是磁盘 IO
        # （单次 stat），对齐 TestCreateSessionPreambleBeforeWrite 结构守卫
        # （磁盘 IO 不进写事务窗口）。workspace 口径与下方 AgentSession.
        # workspace_id 同式：显式 workspace_id（含 team_mission E2 覆写）
        # 优先，PPM 回填 ppm_ws 兜底。仅本轮 create 拼接；后续轮次
        # _inject_into_session / 服务身份注入不携带（D-002）。展示层
        # （AgentRunLog user_input / SESSION_INJECT payload）仍写干净
        # 用户原文，对齐变更/页面前导先例。
        _user_preamble_ws = workspace_id if workspace_id is not None else ppm_ws
        user_preamble = await build_user_preamble(svc._session, user_id, _user_preamble_ws)
        platform_preamble = build_platform_rules_preamble()
        sillyspec_preamble = await build_sillyspec_preamble(svc._session, _user_preamble_ws)
        await svc._session.commit()

        session = AgentSession(
            id=uuid.uuid4(),
            user_id=user_id,
            provider=provider,
            status="pending",
            config=config,
            turn_count=0,
            created_at=now,
            change_id=change_id,
            # task-02（FR-01 / D-004@v2）：显式 workspace_id 优先（含 team_
            # mission E2 覆写）；未显式指定且命中 PPM 条目时回填解析的
            # ppm_ws（条目所属项目第一个关联工作区快照）——只回填本列，
            # cwd/dispatch 沿用既有 workspace_id 决策不新增覆盖（R-05）。
            workspace_id=workspace_id if workspace_id is not None else ppm_ws,
            cwd=cwd,
            # task-03（FR-04/D-008）：会话配置三列（未选 = None = 现状，零回归）。
            agent_profile_id=profile.id if profile is not None else None,
            llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
            # task-04 / FR-02 / design §5.B：分身子会话挂 parent（D-001@v1 会话
            # 树）；缺省 None = 现状（非分身会话恒 NULL，零回归）。
            parent_session_id=parent_session_id,
        )
        svc._session.add(session)
        await svc._session.flush()

        # ── task-08（2026-08-25-session-spec-binding / FR-04 / FR-06 / D-002@v1）：
        # 创建落绑定（best-effort 双写，共用本方法唯一 commit；行级 savepoint
        # 吞异常，失败不阻断会话创建的 201 语义）──
        # ① change_id 非空：补写 change_session_links。**不走** binding.py 的
        #    bind_session_to_change——它按 change_key（变更名）解析且查无会建
        #    placeholder 行，而这里的 change_id 来自请求、已是 Change 行 UUID，
        #    直接按 (change_id, session_id) 幂等查插 link 即可（unique 兜底
        #    并发；Change 行不存在时 FK 失败被 savepoint 吞掉仅 warning）。
        #    agent_sessions.change_id 单 FK 列上方照写（D-002@v1 冻结语义：
        #    双写冗余提示，links 是关联唯一真相）。
        if change_id is not None:
            try:
                async with svc._session.begin_nested():
                    _c_link = (
                        (
                            await svc._session.execute(
                                select(ChangeSessionLink).where(
                                    ChangeSessionLink.change_id == change_id,
                                    ChangeSessionLink.session_id == session.id,
                                )
                            )
                        )
                        .scalars()
                        .first()
                    )
                    if _c_link is None:
                        svc._session.add(
                            ChangeSessionLink(
                                id=uuid.uuid4(),
                                change_id=change_id,
                                session_id=session.id,
                            )
                        )
                        await svc._session.flush()
            except Exception as exc:
                _svc.log.warning(
                    "session_change_link_bind_failed",
                    change_id=str(change_id),
                    session_id=str(session.id),
                    error=str(exc),
                )
        # ② quicklog_id 非空：bind_session_to_quicklog 写 quicklog_session_links
        #    （task-02 契约：自带 savepoint + log.warning 不抛，绑定失败不回滚
        #    创建主事务）。link 行 workspace_id NOT NULL——缺失时记 warning
        #    跳过（悬浮球/门户入口正常必带 workspace_id）。
        if quicklog_id:
            if workspace_id is None:
                _svc.log.warning(
                    "session_quicklog_bind_skipped_no_workspace",
                    quicklog_id=quicklog_id,
                    session_id=str(session.id),
                )
            else:
                from app.modules.change.binding import bind_session_to_quicklog

                await bind_session_to_quicklog(svc._session, workspace_id, quicklog_id, session.id)
        # ③ ppm_item_* 成对携带且条目存在（task-02 / 2026-08-28-session-ppm-
        #    task-binding / FR-01 / D-005@v1）：bind_session_to_ppm_item 幂等写
        #    ppm_item_session_links（自带 savepoint + log.warning 不抛，失败
        #    不回滚创建主事务与 201）。workspace_id 快照取前置解析的 ppm_ws
        #    （可空：项目无关联工作区留 None，D-004@v2——本表列可空，与
        #    quicklog 的 NOT NULL 跳过守卫不同）。条目查无已被前置降级
        #    （ppm_item_ok=False），此处不重复校验。
        if ppm_item_ok:
            await bind_session_to_ppm_item(
                svc._session,
                workspace_id=ppm_ws,
                kind=ppm_item_kind,
                item_id=ppm_item_id,
                session_id=session.id,
            )

        # ── task-09 / D-009@v2（flush-only 预建，R-04）：team_mission 预建 ──
        # session 行 add+flush 后、首 run 构造前调 task-04 helper（session
        # 模式）；objective=block.objective 非空否则直取首句 prompt（create
        # 路径不经 _inject_into_session 占位回填）；scope/project_id/budget/
        # worker_preset/main_agent_config 透传。不 commit——共用写事务的
        # 唯一 commit（下方），中途任意环节异常走整体回滚，无孤儿 session/mission。
        mission = None
        if team_mission is not None:
            from app.modules.agent.orchestrator import OrchestratorService

            assert mission_anchor_id is not None and mission_scope_ids is not None
            mission = await OrchestratorService(svc._session)._precreate_mission_flush(
                workspace_id=mission_anchor_id,
                # ql-20260901-002：objective 回落剥 /team 前缀（briefing 里
                # 的目标文本不带平台指令字面）。
                objective=team_mission.objective or _strip_team_command_prefix(prompt),
                created_by=user_id,
                change_id=change_id,
                constraints=None,
                budget_usd=team_mission.budget_usd,
                worker_preset=team_mission.worker_preset,
                main_agent_config=team_mission.main_agent_config,
                orchestration_mode="session",
                scope_workspace_ids=mission_scope_ids,
                project_id=team_mission.project_id,
                session_id=session.id,
            )

        # task-03：首 run 带档案/供应商轮次快照（D-008）。
        from app.modules.agent.service import _build_agent_profile_snapshot

        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=provider,
            model=model,
            status="pending",
            spec_strategy="interactive",
            agent_session_id=session.id,
            change_id=change_id,
            # task-09 / FR-05：预建 mission 的首 run 双标记（mission_id +
            # role='orchestrator'，字面量对齐 _inject_into_session 既有口径
            # 与 orchestrator.py _ORCHESTRATOR_ROLE）；首 run 即主控轮。
            # task-04 / FR-02 / design §5.A：双标记参数化——显式传入
            # first_run_* 优先（分身子会话首 run 带 mission_id + 分身 role），
            # 缺省回落 task-09 原值（team_mission 预建主控口径，零回归）。
            mission_id=(
                first_run_mission_id
                if first_run_mission_id is not None
                else (mission.id if mission is not None else None)
            ),
            role=(
                first_run_role
                if first_run_role is not None
                else ("orchestrator" if mission is not None else None)
            ),
            # ql-20260817-003：首轮发送者=会话创建者。
            user_id=user_id,
            agent_profile_id=profile.id if profile is not None else None,
            agent_profile_snapshot=(
                _build_agent_profile_snapshot(profile) if profile is not None else None
            ),
            llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
        )
        svc._session.add(run)
        await svc._session.flush()

        # ── task-09 / FR-01 / D-004@v1：首 prompt 团队简报前缀（create 路径）──
        # 叠加顺序定死（R-06）：变更前导（既有，在前）→ 团队简报（task-06
        # build_orchestrator_briefing）→ "\n\n---\n\n" → 用户消息。lease
        # metadata 经 dispatch_prompt 携带前缀（既有机制）；AgentRunLog
        # (user_input)（下方）与首 turn SESSION_INJECT payload prompt（下发
        # 段）仍写干净用户原文（对齐变更前导先例，展示层干净）。
        # unified-floating-session：页面前导插在变更前导与团队简报之间
        # （design §4 拼接顺序）。change/page 前导已在写事务外组装（见方法
        # try 块顶部）；简报依赖写事务内预建的 mission，且为纯 DB 读（无
        # 磁盘遍历），留在写块后组装。
        briefing = None
        if mission is not None:
            from app.modules.agent.mission_context import build_orchestrator_briefing

            briefing = await build_orchestrator_briefing(svc._session, mission)
        # task-03（2026-08-28-session-ppm-task-binding Phase 2 / FR-01/FR-03）：
        # PPM 条目前导插在页面前导与团队简报之间并入 _prefix_parts（task-02
        # 占位注释的落地点）——dispatch_prompt 经 lease metadata 携带前缀
        # （既有机制），AgentRunLog(user_input)（下方）与首 turn SESSION_INJECT
        # 展示层仍写干净用户原文（对齐变更/页面前导先例，零 daemon 改动）。
        _prefix_parts = [
            part
            for part in (
                preamble,
                page_preamble,
                ppm_preamble,
                briefing,
                # 2026-08-29-session-user-preamble：三前导紧贴用户消息
                # （业务前导在前，规则块离用户输入最近遵从度最高）。
                user_preamble,
                platform_preamble,
                sillyspec_preamble,
            )
            if part
        ]
        # ql-20260901-002：派发文本剥 /team 前缀——前端发原始输入（展示层
        # 保留 "/team 目标"），agent 永不接收平台指令字面；无前缀消息
        # 剥离为 no-op，普通会话行为逐字节不变。
        _dispatch_user_msg = _strip_team_command_prefix(prompt)
        dispatch_prompt = (
            "\n\n---\n\n".join([*_prefix_parts, _dispatch_user_msg])
            if _prefix_parts
            else _dispatch_user_msg
        )

        placement = RunPlacementService(svc._session)
        # task-04 / FR-02 / design §5.B：stage 透传（软依赖 task-03 的
        # prepare_interactive_dispatch 扩展形参——stage 写 lease
        # metadata.stage → claim payload → daemon 谓词）。仅显式传入时追加
        # kwargs：缺省 None 不传 = 存量调用逐字节不变（含 placement 尚未
        # 扩展形参的并行合并窗口，不会对既有三路 TypeError）。
        _dispatch_extra: dict[str, str] = {}
        if stage is not None:
            _dispatch_extra["stage"] = stage
        try:
            dispatch = await placement.prepare_interactive_dispatch(
                agent_session_id=session.id,
                agent_run_id=run.id,
                user_id=user_id,
                provider=provider,
                prompt=dispatch_prompt,
                model=model,
                manual_approval=manual_approval,
                ask_user_only=ask_user_only,
                workspace_id=workspace_id,
                cwd=cwd,
                pinned_runtime_id=pinned_runtime_id,
                # task-05：platform 会话代表钉定——placement 复查只按 id+online，
                # 跳过属主谓词与借用授权分支（task-03 已放行 platform 授权，本
                # 分支直接钉定并跳过借用语义 → 无沙箱 marker / 无借用审计）。
                pinned_skip_owner_check=_platform_binding is not None,
                **_dispatch_extra,
            )
        except NoOnlineDaemonError as exc:
            # task-03 / Grill C-01（P0）：钉定路径的竞态防线失联（校验后、
            # placement 复查前 runtime 掉线）→ 转 4xx 明确报错，不静默换机。
            # 旧 provider 路径保持原 NoOnlineDaemonError 透传（零回归）。
            if pinned_runtime_id is not None:
                raise DaemonSessionRuntimeUnavailable(
                    f"Runtime '{pinned_runtime_id}' is offline.",
                    details={"runtime_id": str(pinned_runtime_id)},
                ) from exc
            raise

        # ── task-03：会话档案注入（D-013，非 commit 变体，同事务）──
        # 只写 system_prompt + mcp_refs/skill_refs；不写 bound
        # llm_provider_id / effective_allowed_roots（Grill C-06）。
        if profile is not None:
            from app.modules.agent.service import AgentService

            await AgentService(svc._session).apply_session_profile_to_lease(
                dispatch.lease_id, profile
            )
        # ── task-05（FR-04 / D-009@v1）：platform 会话工具集下推──写 lease
        # metadata.tool_config（照 mcp_tools.py:1316 dispatch_worker 既有写法，
        # 经 build_claim_payload tool_config 透传 context.py:442-443 → daemon
        # CreateSessionInput.allowedTools → canUseTool 最外层白名单 gate，
        # per-session 物理拒绝白名单外工具）。
        # ── task-12（D-011 / spike-02 结论 B 修复）：writable_dir 写约束下推──
        # 同点位写 lease metadata.effective_allowed_roots=[writable_dir]，经
        # ``_apply_profile_passthrough``（context.py `_PROFILE_PAYLOAD_FIELDS`
        # 逐键 ``in`` 守护）原样透传进 claim payload（snake+camel 双写）→
        # daemon execPayload.effectiveAllowedRoots（daemon.ts:4510-4513）→
        # SessionManager state.effectiveAllowedRoots → 写守卫 policyEngine
        # 分支 session 级 overlay 交集收紧（session-manager.ts task-12 增量）。
        # claim 透传决策（读码结论）：lease metadata 的显式值即单一来源——会话
        # 档案变体 ``apply_session_profile_to_lease``（Grill C-06/NG-03）不写
        # effective_allowed_roots，本注入在其后执行无覆写冲突，context.py 零改动。
        # writable_dir 为空（模型可空，创建时校验非空 ⊆ runtime allowed_roots）
        # → 不注入，退回机器级边界口径（不宽于 task-05 现状）。
        if _platform_binding is not None:
            from app.modules.agent.execution import platform_shared_tool_config

            _platform_meta: dict[str, object] = {
                "tool_config": platform_shared_tool_config(),
            }
            if _platform_binding.writable_dir:
                _platform_meta["effective_allowed_roots"] = [_platform_binding.writable_dir]
            await _svc._merge_lease_metadata(
                svc._session,
                dispatch.lease_id,
                _platform_meta,
            )
        # task-03 / FR-04 / R-02：会话级供应商写独立 metadata key（claim 端
        # _inject_provider_config 最高优先级分支消费）；压制档案绑定，未选
        # 不写 = 现状链（零回归）。
        if llm_provider_row is not None:
            await _svc._merge_lease_metadata(
                svc._session,
                dispatch.lease_id,
                {"session_llm_provider_id": str(llm_provider_row.id)},
            )

        # ── task-03（2026-08-28-session-ppm-task-binding / FR-03 / D-006）：
        # PPM 附件物化行落库（写事务内 flush-only，共用本方法唯一 commit）──
        # 对象本体与降级决策已在写事务外完成（见方法顶部物化段）；此处
        # session.id 已知，session_id 直接回填（跳过 draft 语义）、
        # user_id=创建者，按列写入后并入 validated_attachments 复用下方既有
        # 组装链（标记行/多模态块/落盘/8MB 闸门，daemon 协议零改动）。
        # 不复用 SessionAttachmentService.upload()——其自带 commit 与 PIL/
        # 大小校验，源文件已在 file 中心过上传校验不重复（TaskCard 事务口径）。
        if ppm_prepared_attachments:
            from app.modules.session_attachment.model import (
                SessionAttachment as _PpmSessionAttachment,
            )

            for _ppm_spec in ppm_prepared_attachments:
                _ppm_row = _PpmSessionAttachment(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    session_id=session.id,
                    kind=_ppm_spec.kind,
                    media_type=_ppm_spec.media_type,
                    bytes=_ppm_spec.bytes,
                    name=_ppm_spec.name,
                    object_key=_ppm_spec.object_key,
                    sha256=_ppm_spec.sha256,
                )
                svc._session.add(_ppm_row)
                validated_attachments.append(_ppm_row)

        create_inject_attachments: list[dict] = []
        if validated_attachments:
            create_inject_attachments = await assemble_create_attachments(
                svc,
                session,
                validated_attachments,
                user_id=user_id,
                llm_provider_row=llm_provider_row,
                provider=provider,
            )

        # Backfill the triple binding fields + activate the session.
        session.runtime_id = dispatch.runtime_id
        session.lease_id = dispatch.lease_id
        session.status = "active"
        session.turn_count = 1
        session.last_active_at = now
        # task-03 / Grill C-12：config_snapshot（含 machine_name/agent_name，
        # 列表 chips 直显免二次查询）。任一新入口字段选中才写；全不选 =
        # NULL = 现状（零回归）。machine/agent 名取实际定位的 runtime。
        if pinned_runtime_id is not None or profile is not None or llm_provider_row is not None:
            machine_name, agent_name = await svc._resolve_runtime_labels(dispatch.runtime_id)
            session.config_snapshot = {
                "profile_name": profile.name if profile is not None else None,
                "provider_name": (llm_provider_row.name if llm_provider_row is not None else None),
                # D-002@v1：显式选择的 model 优先（预会话级联首句）；缺省
                # 回落供应商配置派生（展示口径与下发 config["model"] 一致）。
                "model": (
                    model
                    or (
                        (llm_provider_row.model or llm_provider_row.default_fallback_model)
                        if llm_provider_row is not None
                        else None
                    )
                ),
                "engine": provider,
                "machine_name": machine_name,
                "agent_name": agent_name,
            }
        svc._session.add(session)

        # task-01 / FR-01 / D-005@v1：首 turn 落一条 channel="user_input" 的
        # AgentRunLog，让历史回看能看到用户发的首 prompt（与 agent 输出
        # stdout/stderr/tool_call 并列）。prompt 经 content_redacted 脱敏
        # （统一 USER_INPUT_LOG_MAX_CHARS 截断，ql-20260910-016 由 5000 放宽），user_input channel
        # 显式写、不经 _channel_from_event_type（与 agent service 的
        # USER_INPUT_CHANNEL 标准保持一致）。
        # ql-20260825-001：附件标记行插头部（对齐 inject 路径 task-06 D-3，
        # 前端 chips 回显数据源）——[附件:id|kind|name] 逐附件一行。
        _user_input_content = prompt
        if validated_attachments:
            from app.modules.session_attachment.service import (
                attachment_marker_line,
            )

            _marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
            _user_input_content = f"{_marker_lines}\n{prompt}" if prompt else _marker_lines
        svc._session.add(
            AgentRunLog(
                run_id=run.id,
                channel="user_input",
                content_redacted=_user_input_content[:USER_INPUT_LOG_MAX_CHARS],
                timestamp=now,
            )
        )
        await svc._session.commit()
        await svc._session.refresh(session)
        await svc._session.refresh(run)
    except Exception:
        await svc._session.rollback()
        raise

    # task-02（2026-08-24-sessions-live-updates / design §3）：INSERT 与
    # status→active 激活在同一事务内一体落库（生效点 = 上方 commit），此处
    # 合并发布 created（行出现）+ status_changed（→active）两个列表信号；
    # 若下方派发失败收敛为 failed，_converge_failed_dispatch 会再发一条
    # status_changed，列表最终收敛到终态（轮询兜底语义不受影响）。
    await _svc.publish_sessions_changed("created", session.id, session.user_id)
    await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)

    # Commit succeeded → wake the daemon. Failure here must converge the
    # just-committed triple to terminal failed states before raising.
    placement = RunPlacementService(svc._session)
    delivered = await placement.notify_interactive_dispatch(dispatch)
    if not delivered:
        await svc._converge_failed_dispatch(
            session=session,
            run=run,
            lease_id=dispatch.lease_id,
            error="interactive dispatch wake-up failed (daemon offline)",
        )
        raise DaemonRuntimeOffline(
            "执行代理当前不在线，会话无法启动。请确认本机 daemon 进程已运行"
            "（任务栏/终端 sillyhub-daemon），重启后重试；若刚重启请等几秒再试。",
            details={
                "runtime_id": str(dispatch.runtime_id),
                "session_id": str(session.id),
                "run_id": str(run.id),
            },
        )

    # Best-effort SESSION_INJECT control message carrying the first turn.
    # Wake-up already signalled the lease; the control message lets the
    # daemon SessionManager know the exact first prompt (FR-02 contract).
    # task-04（design A2）：走控制指令三段式（落库 pending + WS 推送 +
    # delivered 标记）——WS 失败不再裸丢，daemon 重连补拉兜底。
    # task-06: WS Hub routes by daemon_instance_id; resolve from the
    # provider runtime_id carried on the dispatch.
    daemon_id = await _resolve_daemon_id_for_runtime(svc._session, dispatch.runtime_id)
    # ql-20260904-016（会话首响优化）：不再原地 await ready（原 timeout=8 死等——
    # 新会话 daemon create 全链实机 3~31s，冷启动必然超时，POST /api/daemon/sessions
    # 白挂 8s，实测会话 f0f76381 首响 46.5s 中占 8.2s）。改为立即发 SESSION_INJECT，
    # 早到安全由 daemon 侧三重兜底承接：①inject 早到 park 窗口 60s
    # （daemon.ts _awaitSessionThenRoute，ql-20260831-006）；②控制指令三段式
    # （落库 pending + WS 推送 + daemon 重连补拉，task-04 design A2）；③daemon
    # create 的 firstPrompt 10s fallback（session-manager _pendingFirstPrompt）。
    control_ok = False
    if daemon_id is not None:
        _create_inject_payload = {
            "session_id": str(session.id),
            "lease_id": str(dispatch.lease_id),
            "run_id": str(run.id),
            # P0 修复（2026-08-26，真实派团队测试发现）：首轮 SESSION_INJECT
            # 必须发 **dispatch_prompt**（含团队简报/变更前导/页面前导拼接），
            # 而非裸 prompt——daemon inject() 消费 SESSION_INJECT 后会清掉
            # firstPrompt 挂起（session-manager _pendingFirstPrompt），lease
            # metadata 的简报版 prompt 永远不会被 fallback 消费。原裸 prompt
            # 导致主控收不到团队简报，把 /team 当普通命令回 Unknown command。
            "prompt": dispatch_prompt,
            # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token，
            # daemon 存入 SessionState.claimToken。
            "claim_token": dispatch.claim_token,
            # design §5.3: payload carries the provider runtime_id so
            # the daemon dispatches to the correct SessionManager.
            "runtime_id": str(dispatch.runtime_id),
        }
        # ql-20260825-001：首句附件随首 turn 下发（对齐 inject 路径——仅
        # 有附件时附加，旧 daemon 忽略未知键，协议向后兼容）。
        if create_inject_attachments:
            _create_inject_payload["attachments"] = create_inject_attachments
        _row, control_ok = await ControlCommandService(svc._session).enqueue_and_push(
            daemon_id=daemon_id,
            runtime_id=dispatch.runtime_id,
            kind=KIND_SESSION_INJECT,
            payload=_create_inject_payload,
        )
    if not control_ok:
        # Wake-up delivered but control send failed: the daemon will still
        # claim the lease (metadata has the prompt), so we do NOT fail the
        # session here. Log for observability; FR-01 success already holds.
        _svc.log.warning(
            "session_create_control_send_failed",
            session_id=str(session.id),
            run_id=str(run.id),
            runtime_id=str(dispatch.runtime_id),
        )

    await svc._publish_session_event(
        session.id,
        {"event": "session_created", "session_id": str(session.id), "run_id": str(run.id)},
    )
    return SessionDispatchResult(
        agent_session=session,
        agent_run=run,
        lease_id=dispatch.lease_id,
    )
