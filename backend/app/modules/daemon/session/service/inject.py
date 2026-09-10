"""inject 簇入口与共享注入核心（task-08 拆分，原 :3003-3385 + :3404-4291）。

- inject_session / inject_session_as_service：用户/服务身份两入口（绑定双写
  段下沉 helpers._bind_inject_session_links）；
- _inject_into_session：共享注入核心——忙轮分支下沉 queue._handle_busy_turn、
  配置切换解析下沉 inject_gates._resolve_inject_turn_config、写事务附件/切换
  同步下沉 attachments._finalize_inject_turn_writes、commit 后派发段下沉
  control._dispatch_inject_turn（均为分步函数，零改写）。

D-007：本文件调用点经 ``_svc.`` 延迟解析的符号无（log/publish 均已随分段
下沉）；常量 ACTIVE_*/TERMINAL_* 定义于包 ``__init__``，子模块经 ``_svc.`` 取。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select

from app.core.errors import AppError
from app.modules.agent.model import (
    USER_INPUT_LOG_MAX_CHARS,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.daemon.schema import PageContextCreateBlock
from app.modules.ppm.common.session_binding import PpmItemKind

from .attachments import _finalize_inject_turn_writes
from .control import _dispatch_inject_turn
from .errors import (
    DaemonSessionConfigInvalid,
    DaemonSessionInvariantViolation,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    SessionEmptyPrompt,
)
from .helpers import _bind_inject_session_links, _strip_team_command_prefix
from .inject_gates import _resolve_inject_turn_config
from .queue import _handle_busy_turn
from .results import SessionDispatchResult, _PrelockedInjectAttachments


async def inject_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    prompt: str,
    # 2026-08-14-sessions-portal task-02：切档案/切供应商字段透传占位（校验与
    # SESSION_SWITCH_CONFIG 下发归 task-05；默认 None 不改既有行为）。
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    # task-11（2026-08-29-usage-by-provider-model / FR-03-3 / FR-03-4 /
    # D-002@v1）：会话级模型选择（三态，与 llm_provider_id None/空串语义
    # 同构）：None=不动（零回归）；空串=显式「跟随供应商配置」重置；
    # 非空=显式选模型（构成切换轮，R-07 兜底模型快照级同步见
    # _inject_into_session 切换段）。
    model: str | None = None,
    # 2026-08-20-session-multimodal-attachments task-05：附件引用（D-7 豁免
    # 空 prompt；引擎/归属/数量校验见 _inject_into_session；组装下发归 task-06）。
    attachment_ids: list[uuid.UUID] | None = None,
    # ql-20260825-004：每轮注入携带当前页面上下文。
    page_context: PageContextCreateBlock | None = None,
    # task-07（2026-08-26-session-input-mention / FR-06 / D-003）：@ 联想绑定
    # 字段——经幂等 binder 落 M:N link（见下方「会话绑定」段插入点说明），
    # 不注入 prompt 前导；缺省 None = 不绑定（零回归）。
    bind_change_key: str | None = None,
    bind_quick_id: str | None = None,
    # task-02（2026-08-28-session-ppm-task-binding / FR-02 / D-005@v1）：@ 联想
    # 选中 PPM 任务/问题的追问绑定成对字段——见下方「PPM 条目追问绑定」段
    # （load_ppm_item 校验 + bind_session_to_ppm_item 幂等追加，不注入前导）；
    # 缺省 None = 不绑定（零回归）。
    bind_ppm_item_kind: PpmItemKind | None = None,
    bind_ppm_item_id: uuid.UUID | None = None,
    # ql-20260825-011：忙轮（已有活跃 run）时入队而不是 409 拒绝（后端真实
    # 排队，刷新页面不丢）。默认 False 保持既有拒绝语义（service 身份路径 /
    # 平台审批代写等调用方零回归）；前端会话 UI 置 True。
    queue_when_busy: bool = False,
) -> SessionDispatchResult:
    """Append a new turn run to an active session (FR-02 / design §7.6 step 1).

    Holds the session row lock, rejects when an active run already exists
    (DaemonSessionTurnConflict), creates the new AgentRun, commits, then
    dispatches a SESSION_INJECT control message. WS send failure converges
    the new run to failed but keeps the session active (boundary #13).

    Ownership: enforced via ``_get_owned_session_for_update`` (``user_id``
    must own the session). For the platform service path that must bypass
    this user-ownership check (multi-member workspace approver ≠ session
    creator), see :meth:`inject_session_as_service` (D-006@v2,
    2026-08-14-change-center-conversation-driven task-04).

    sessions-portal task-05（FR-05/FR-06 / D-012@v1）：``agent_profile_id`` /
    ``llm_provider_id`` 与会话当前值不同 → 切换分支（校验+快照+SESSION_SWITCH_CONFIG
    语义见 :meth:`_inject_into_session` docstring；``llm_provider_id`` 空串 =
    "none" → 清空回本机默认）。都 None → 原有 inject 行为零回归；send 失败
    按既有收敛（Grill C-11）。

    task-11（2026-08-29-usage-by-provider-model / FR-03-3 / design §4.2）：
    ``model`` 三态——None=不动（零回归）；空串=显式「跟随供应商配置」重置；
    非空=显式选模型（模型依赖供应商——本入口守卫：未显式携带非空
    ``llm_provider_id`` → 422）。②③ 都构成切换轮，下发 daemon 的
    ProviderConfig 快照同步 ``default_fallback_model=model``（R-07 消兜底
    遮蔽），见 :meth:`_inject_into_session`。

    P1（2026-08-25 会话路径二审 #1）：附件校验 + gate 解析 + MinIO 组装在
    取锁前完成（:meth:`_preassemble_inject_attachments`，普通读）——行锁窗口
    只含可注入状态判定 + 写入；锁内复核 gate 基准漂移（见组装段）。
    """
    # task-11（FR-03-3）：模型依赖供应商——model 非空而本次请求未显式携带
    # 非空 llm_provider_id（None/空串）→ 422。口径单一来源在本入口（HTTP
    # inject 路由 / 激活分支统一覆盖；空 prompt 豁免条件无需扩——model 非空
    # ⟹ llm_provider_id 非空，已被既有豁免覆盖）。
    if model and not (llm_provider_id or "").strip():
        raise DaemonSessionConfigInvalid(
            "模型依赖供应商：选择模型时必须同时指定供应商。",
            details={"reason": "model_requires_provider", "model": model},
        )
    # ql-20260817-010：静默切换——携带切换字段时允许空 prompt（切换轮无用户
    # 消息/模型回应，daemon 只 reload 配置）；纯追问仍要求非空。
    # 2026-08-20 task-05（D-7）：附件非空也豁免空 prompt（看图说话）。
    # 2026-08-27-background-subagent-progress task-07（FR-08 / D-004@v1）：
    # 空 prompt（含全空白）→ SessionEmptyPrompt 422 中文文案；校验在取锁 /
    # 附件预读 / 忙轮入队（queue_when_busy）之前——空消息不进队列、不建
    # run、不写 user_input 行。空判权威唯一在此（DTO 层不再重复判空，切换 /
    # 附件豁免口径单一来源，见 SessionInjectRequest docstring）。
    if not (prompt or "").strip():
        if agent_profile_id is None and llm_provider_id is None and not attachment_ids:
            raise SessionEmptyPrompt(
                "消息内容不能为空",
                details={"reason": "empty_prompt"},
            )
        prompt = ""

    try:
        # ── P1（2026-08-25 会话路径二审 #1）：附件校验 + gate 解析 + MinIO
        # 组装移到会话行锁之前（对象存储慢读不再占用 FOR UPDATE 行锁，同会话
        # 并发 inject/interrupt/end 不在锁上排队）。锁内 _inject_into_session
        # / 激活分支重校验会话可注入状态 + gate 基准漂移（见其组装段注释）。
        prelocked_attachments = await svc._preassemble_inject_attachments(
            session_id,
            user_id,
            llm_provider_id=llm_provider_id,
            attachment_ids=list(attachment_ids) if attachment_ids else None,
        )
        if prelocked_attachments is not None:
            # 收口预读只读事务（释放快照/事务占用，expire_on_commit=False 下
            # 预读 rows 仍可用）：FOR UPDATE 锁窗口只含锁定 + 依赖可变状态的
            # 判定与写入，尽快 commit。
            await svc._session.commit()
        session = await svc._get_owned_session_for_update(session_id, user_id)
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise
    # ── quick 投影统一标记制（2026-09-02）：标准 inject 端点影子直聊直通 ──
    # 目标会话为群成员影子会话（kind='group_member'，属主=群主——上方归属
    # 校验天然直通）且本轮携带真实消息文本（空 prompt 的纯切换轮不适用）
    # → 按直聊语义注入：prompt 前插直聊头（可见性语义 + [[GROUP]] 标记
    # 说明）+ 轮 metadata source="shadow_direct"（投影过滤判定锚 + 直聊
    # 载体 run，[[GROUP]] 段投影层照常选择性回群）。效果：群主在
    # SessionPanel 对影子会话发消息 = 直聊。群 @ 触发 / 直聊端点 / 排队
    # 派发等服务路径自带 turn_metadata（inject_session_as_service），不经
    # 本入口，零影响。group/service 延迟 import 防循环（照
    # _get_owned_session_for_update 先例）；非群影子（成员行缺失）返回
    # None 零行为变化。载体 run 随调用方事务落库（失败整体回滚）。
    direct_turn_metadata: dict | None = None
    if session.session_kind == "group_member" and prompt.strip():
        from app.modules.daemon.group.service import prepare_shadow_direct_turn

        direct = await prepare_shadow_direct_turn(
            svc._session,
            shadow_session_id=session.id,
            sender_user_id=user_id,
        )
        if direct is not None:
            direct_header, direct_turn_metadata = direct
            prompt = f"{direct_header}\n{prompt}"

    # task-08 拆分：会话绑定双写段（@ 联想 + PPM 追问）下沉
    # helpers._bind_inject_session_links（零改写）。
    await _bind_inject_session_links(
        svc,
        session,
        bind_change_key=bind_change_key,
        bind_quick_id=bind_quick_id,
        bind_ppm_item_kind=bind_ppm_item_kind,
        bind_ppm_item_id=bind_ppm_item_id,
    )

    # ── task-05（design §3.3.4 / D-010）：tool_report 会话懒激活分支 ──────────
    # CLI 工具上报聚合出的「本地 Agent 会话」（origin='tool_report'，创建时
    # status='pending' 且无 lease/runtime）首次被用户继续（首条消息）时，才
    # 绑定机器建 interactive lease——首条消息即首轮（prompt 存 lease metadata
    # 并下发 SESSION_INJECT），激活成功直接返回激活派发结果；已激活（lease
    # 存在）的 tool_report 会话与 origin 缺省的 chat 会话不进本分支，走既有
    # inject 路径零回归（design §3.3.4 第 5 点）。
    # 二审 #2：切换字段（agent_profile_id/llm_provider_id）与附件透传进激活
    # 事务（照 create_session 语义落配置，附件随首轮下发），不再静默丢弃。
    # task-11（2026-08-29-usage-by-provider-model）：激活轮暂不支持会话级选
    # 模型——激活路径的供应商配置经 claim 链组装（lease/context），快照级
    # model 同步不在本 task 范围；显式 422 拒绝而非静默丢弃（铁律：不吞参数）。
    if getattr(session, "origin", "chat") == "tool_report" and session.lease_id is None:
        if model:
            raise DaemonSessionConfigInvalid(
                "该会话尚未激活，暂不支持在激活消息中切换模型；请激活后再选模型。",
                details={
                    "reason": "activation_model_unsupported",
                    "session_id": str(session.id),
                },
            )
        return await svc._activate_tool_report_session(
            session,
            user_id,
            prompt=prompt,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            attachment_ids=list(attachment_ids) if attachment_ids else None,
            prelocked_attachments=prelocked_attachments,
        )
    return await svc._inject_into_session(
        session,
        prompt=prompt,
        # ql-20260817-003：轮次发送者=实际注入者。
        run_sender_user_id=user_id,
        # quick 投影统一标记制（2026-09-02）：标准 inject 对群成员影子会话的
        # 自动直聊化产物（source=shadow_direct + 直聊载体 run）；普通会话
        # 恒 None（零回归）。
        turn_metadata=direct_turn_metadata,
        # sessions-portal task-05：切换参数透传共享核心（service 路径不传=零回归）。
        agent_profile_id=agent_profile_id,
        llm_provider_id=llm_provider_id,
        # task-11：会话级模型选择透传（None/空串=不选，零回归）。
        model=model,
        # 2026-08-20 task-05：附件透传（None → 空列表零回归）。
        attachment_ids=list(attachment_ids) if attachment_ids else None,
        # P1（二审 #1）：取锁前预组装产物（rows + payload + gate 快照）。
        prelocked_attachments=prelocked_attachments,
        # ql-20260825-004：页面上下文透传。
        page_context=page_context,
        # ql-20260825-011：忙轮入队透传。
        queue_when_busy=queue_when_busy,
    )


async def inject_session_as_service(
    svc,
    session_id: uuid.UUID,
    *,
    prompt: str,
    # 2026-09-01-session-group-chat task-03（design §4.3）：群聊影子会话注入
    # 分支——服务身份路径补忙轮排队开关与群链路透传（缺省值保持既有行为
    # 零回归）：
    # - ``queue_when_busy``：影子忙轮时落 AgentSessionQueuedMessage（复用
    #   _inject_into_session 排队分支：满 5 → 409、position 派发序、
    #   queue_changed 事件、dispatch_next_queued_message 续派）；
    # - ``queue_sender_user_id``：排队条目 sender（群聊=实际发送者；缺省=
    #   会话属主——service 路径既有语义）；
    # - ``turn_metadata``：写本轮 user_input 日志 metadata_ 列（群链路
    #   source_group_id/source_member_id/source_carrier_run_id/chain_depth/
    #   sender_user_id——task-04 互@检测读取）。
    queue_when_busy: bool = False,
    queue_sender_user_id: uuid.UUID | None = None,
    turn_metadata: dict | None = None,
    # quick（2026-09-02 群聊忙轮注入 steering）：忙轮策略新形态——
    # ``"inject"``=忙轮跳过排队直接注入当前活跃轮（run_id 沿用活跃 run，
    # 不建新 run，单会话单活跃 run 不变式保持；daemon 侧 running 时下发
    # 注入是既有安全路径：最好=工具间隙 mid-turn 消费，最坏=SDK 轮边界
    # 消费，均不劣于排队）；``"queue"``=既有排队；缺省 None=沿用
    # queue_when_busy 旧形态（True≡"queue"，新参数优先）。空闲轮不受
    # 影响（照常新建 run）。携带配置切换维度时本参数不生效（切换是轮
    # 边界语义，回落排队/切换分支）。
    busy_strategy: Literal["queue", "inject"] | None = None,
    # task-04（2026-09-01-session-group-chat design §4.5 热切换）：配置切换
    # 维度（str 形态 uuid；语义与用户路径 inject_session 同名参数一致——
    # None=不动；空串="none" 清空；≠当前值构成切换轮）。群成员六要素热切换
    # 经本入口以服务身份下发 SESSION_SWITCH_CONFIG：携带切换维度时空
    # prompt 合法（静默切换轮：run 落终态 completed 无 LLM turn，daemon
    # 当前轮结束边界 reload，下轮生效）。
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    # 群聊附件（FR-05 补遗：群消息附件支持）：参数名与用户路径 inject_session
    # 同名同形（list[uuid.UUID] 引用上传端点产出的 SessionAttachment id）。
    # ``attachment_ids`` 非空豁免空 prompt（D-7 看图说话同口径）；引擎/归属/
    # 数量校验与 payload 组装复用 _inject_into_session 既有管线。
    attachment_ids: list[uuid.UUID] | None = None,
    # 归属校验基准覆盖：群链路附件上传者是**实际发送者**（普通群成员），
    # 而影子会话属主恒为群主（§9.2）——按属主校验会误 404。群路径传发送者
    # id；缺省 None = 既有语义（按会话属主 session.user_id）。
    attachment_owner_user_id: uuid.UUID | None = None,
) -> SessionDispatchResult:
    """Append a turn run to an active session as the **platform service** (D-006@v2).

    Service-identity sibling of :meth:`inject_session`: skips the user
    ownership check (``_get_owned_session_for_update`` — a multi-member
    workspace approver may NOT be the session creator, design §5 P2 /
    Grill F-2) and locks the session by id only. Used by the change
    approval flow to push review results into the bound session
    (2026-08-14-change-center-conversation-driven task-04).

    All other semantics are identical to :meth:`inject_session` (status /
    lease / turn-conflict guards, SESSION_INJECT dispatch, offline
    convergence, best-effort readiness wait). The caller is responsible
    for the change-side best-effort degradation mapping (turn_conflict /
    session_inactive / inject_failed, R-03).
    """
    # 2026-08-27-background-subagent-progress task-07（FR-08 / D-004@v1）：
    # 与 inject_session 入口同口径——空 prompt（含全空白）→ SessionEmptyPrompt
    # 422。task-04 例外：携带切换维度（热切换静默轮）时空 prompt 合法
    # （_inject_into_session 的 config_switch 分支消费，等值+空 prompt 仍被
    # 其内部守卫拒绝——调用方只在确有 diff 时传入）。群聊附件例外：附件
    # 非空同样豁免空 prompt（D-7 看图说话，与用户路径一致）。
    if (
        not (prompt or "").strip()
        and agent_profile_id is None
        and llm_provider_id is None
        and not attachment_ids
    ):
        raise SessionEmptyPrompt(
            "消息内容不能为空",
            details={"reason": "empty_prompt"},
        )

    try:
        stmt = select(AgentSession).where(AgentSession.id == session_id).with_for_update()
        session = (await svc._session.execute(stmt)).scalar_one_or_none()
        if session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise
    return await svc._inject_into_session(
        session,
        prompt=prompt,
        # ql-20260817-003：service 身份代写轮——发送者记会话属主。
        run_sender_user_id=session.user_id,
        # 2026-09-01-session-group-chat task-03：群聊影子注入透传（缺省零回归）。
        queue_when_busy=queue_when_busy,
        # quick（2026-09-02 群聊忙轮注入）：忙轮策略透传（缺省 None 零回归）。
        busy_strategy=busy_strategy,
        queue_sender_user_id=queue_sender_user_id,
        turn_metadata=turn_metadata,
        # task-04（design §4.5 热切换）：切换维度透传共享核心（缺省 None=
        # 既有 service 路径零回归）。
        agent_profile_id=agent_profile_id,
        llm_provider_id=llm_provider_id,
        # 群聊附件：透传共享核心（缺省 None 零回归——既有 service 调用方
        # 不携带）。归属基准覆盖见 _inject_into_session 同名参数注释。
        attachment_ids=list(attachment_ids) if attachment_ids else None,
        attachment_owner_user_id=attachment_owner_user_id,
    )


async def _inject_into_session(
    svc,
    session: AgentSession,
    *,
    prompt: str,
    # ql-20260817-003：轮次发送者（run.user_id）——inject_session 传实际注入
    # 的 user_id，inject_session_as_service（平台审批代写）传会话属主。
    run_sender_user_id: uuid.UUID | None = None,
    # sessions-portal task-05：切档案/切供应商（None=不动；llm_provider_id
    # 空串="none" 清空回本机默认）。service 身份路径（inject_session_as_service）
    # 不传 → 走原有 inject 行为（零回归）。
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    # task-11（2026-08-29-usage-by-provider-model / FR-03-3）：会话级模型选择
    # （三态：None=不动；空串=显式重置跟随供应商配置；非空=显式选模型——
    # 守卫在 inject_session 入口，本方法的直调方不携带）。②③ 均构成切换轮
    # （进 SESSION_SWITCH_CONFIG 分支）。
    model: str | None = None,
    # 2026-08-20-session-multimodal-attachments task-05：附件引用（None → 零
    # 回归）。校验（引擎门控/归属/数量）在本方法事务内；组装下发归 task-06。
    attachment_ids: list[uuid.UUID] | None = None,
    # 2026-09-10-auto-resume-interrupted-turn（D-002@v2）：自动续跑轮源标记——
    # 排队派发链（queue.dispatch_queued_messages 解析 origin 传入）；新 run 落
    # metadata_.auto_resume_of（链上限计数 G7 + 前端徽标数据源）。None = 普通
    # 注入轮（既有调用点零改动）。
    auto_resume_of: uuid.UUID | None = None,
    # 群聊附件（FR-05 补遗）：归属校验基准覆盖——群影子会话属主恒为群主，
    # 附件上传者可能是普通群成员；None = 既有语义（按 session.user_id）。
    attachment_owner_user_id: uuid.UUID | None = None,
    # P1（2026-08-25 会话路径二审 #1）：inject_session 主路径取锁前预组装的
    # 附件产物（校验过的 rows + payload + gate 快照）；None = 调用方未预组
    # 装（service 身份路径 / 直调），走锁内原校验兜底。
    prelocked_attachments: _PrelockedInjectAttachments | None = None,
    # ql-20260825-004：每轮注入携带当前页面上下文（build_page_context_preamble
    # 服务端回查注入【页面上下文】前导，复用 create 路径逻辑）。
    page_context: PageContextCreateBlock | None = None,
    # ql-20260825-011：忙轮入队开关（语义见 inject_session 同名参数）。
    queue_when_busy: bool = False,
    # quick（2026-09-02 群聊忙轮注入 steering）：忙轮策略（语义见
    # inject_session_as_service 同名参数——"inject"=中途注入活跃轮，
    # "queue"≡queue_when_busy=True，None=沿用旧形态）。缺省 None 零回归。
    busy_strategy: Literal["queue", "inject"] | None = None,
    # 2026-09-01-session-group-chat task-03（design §4.3）：排队条目 sender
    # 覆盖——群聊影子会话排队时记**实际发送者**（run/计量仍归影子属主=群主，
    # §9.2；条目 sender 供派发轮归属校验与审计）；缺省 None = 既有语义
    # （run_sender_user_id or 会话属主）。
    queue_sender_user_id: uuid.UUID | None = None,
    # 2026-09-01-session-group-chat task-03（design §4.3/§4.4）：本轮
    # user_input 日志 metadata_ 列负载（群链路 source_group_id/
    # source_member_id/source_carrier_run_id/chain_depth/sender_user_id——
    # task-04 turn_completed 互@检测读取）。缺省 None 不写（存量行 NULL）。
    turn_metadata: dict | None = None,
) -> SessionDispatchResult:
    """Shared inject-turn core (used by :meth:`inject_session` +
    :meth:`inject_session_as_service`).

    Caller MUST already hold the session row lock (FOR UPDATE) and is
    responsible for ownership semantics — this method only implements the
    status/lease/turn-conflict guards, the new AgentRun creation, the
    SESSION_INJECT dispatch and the offline convergence. Extracted so the
    user-owned and service-identity paths share one turn-injection body
    (D-006@v2, 2026-08-14-change-center-conversation-driven task-04).

    sessions-portal task-05（FR-05/FR-06 / D-012@v1）：``agent_profile_id`` /
    ``llm_provider_id`` 与会话当前值不同 → 切换分支（同事务新 AgentRun 快照 +
    会话三列刷新 + lease metadata 同步 + SESSION_SWITCH_CONFIG 原子下发）；
    空串 = "none" → 清空会话供应商回本机默认（写 NULL）；都 None / 等值 →
    原有行为逐字段不变（零回归）。

    task-11（2026-08-29-usage-by-provider-model / FR-03-3、FR-03-4 / R-07）：
    ``model`` 三态（与 ``llm_provider_id`` None/空串语义同构）——None=不动
    （普通轮/纯档案切换零回归）；空串=显式「跟随供应商配置」重置；非空=
    显式选模型（→ 切换分支，daemon reload 重建 driver，ANTHROPIC_MODEL
    生效），且下发 daemon 的 ProviderConfig 快照同步 ``model=model`` 且
    ``default_fallback_model=model``（credential-injector 规则3 优先级
    ``default_fallback_model ?? model``，不同步会被供应商兜底模型静默遮蔽；
    快照级覆盖，不动 llm_providers 原配置）。空串/切供应商时随供应商原配置
    重置（无旧模型残留），纯档案切换（不带 model 键）不动模型（沿用会话
    已选，含下发快照同步）；config_snapshot.model 回填本轮生效模型（展示用）。
    """
    session_id = session.id
    now = datetime.now(UTC)
    try:
        # ql-20260829-011：归档区存量会话只读——共享核心入口统一拦（覆盖用户
        # inject / 平台审批代写 / 激活分支三路径），409 早于 status/lease
        # 判定；置于 try 内借既有 AppError rollback 收敛行锁事务。
        await svc._ensure_session_workspace_writable(session)
        if session.status != "active":
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status={session.status}).",
                details={"session_id": str(session_id), "status": session.status},
            )
        if session.lease_id is None or session.runtime_id is None:
            raise DaemonSessionInvariantViolation(
                f"Active session '{session_id}' has no lease/runtime binding.",
                details={"session_id": str(session_id)},
            )

        current = await svc._get_current_run(session.id)
        if current is not None:
            # task-08 拆分：忙轮三分支（steering 直注入 / 409 冲突 / 排队
            # 入队）整体下沉 queue._handle_busy_turn（零改写）；空闲轮返回
            # None 落到下方新建 run 路径。
            return await _handle_busy_turn(
                svc,
                session,
                current,
                prompt=prompt,
                attachment_ids=attachment_ids,
                attachment_owner_user_id=attachment_owner_user_id,
                page_context=page_context,
                agent_profile_id=agent_profile_id,
                llm_provider_id=llm_provider_id,
                model=model,
                queue_when_busy=queue_when_busy,
                busy_strategy=busy_strategy,
                run_sender_user_id=run_sender_user_id,
                queue_sender_user_id=queue_sender_user_id,
                turn_metadata=turn_metadata,
            )

        # ── 2026-08-20 task-05：附件校验（D-6 引擎门控 / 归属 404 / 数量 422）──
        # P1（2026-08-25 二审 #1）：inject_session 主路径已在取锁前完成校验
        # （prelocked_attachments.rows），锁内直接复用行；不带预组装的调用方
        # （inject_session_as_service / 直调）走原地校验兜底（:meth:
        # `_validate_inject_attachment_rows`，判定与原实现逐字节一致）。
        # 组装（base64 内联/降级路由/标记行/回填）见下方 task-06 段；
        # 本段只做整体拒绝（不部分生效）：任一校验失败 raise → 事务回滚。
        validated_attachments: list = []
        if attachment_ids and prelocked_attachments is None:
            validated_attachments = await svc._validate_inject_attachment_rows(
                session_id=session_id,
                session_user_id=(
                    attachment_owner_user_id
                    if attachment_owner_user_id is not None
                    else session.user_id
                ),
                session_provider=session.provider or "",
                attachment_ids=attachment_ids,
            )
        elif prelocked_attachments is not None:
            validated_attachments = list(prelocked_attachments.rows)

        # task-08 拆分：配置切换三态解析 + effective 行解析下沉
        # inject_gates._resolve_inject_turn_config（零改写；两段间原夹的
        # prompt 空守卫留在下方原位——只读本调用产出，无数据依赖）。
        _switch = await _resolve_inject_turn_config(
            svc,
            session,
            agent_profile_id=agent_profile_id,
            llm_provider_id=llm_provider_id,
            model=model,
        )
        profile_changed = _switch.profile_changed
        switch_profile = _switch.switch_profile
        provider_changed = _switch.provider_changed
        new_llm_provider_id = _switch.new_llm_provider_id
        config_switch = _switch.config_switch
        effective_profile = _switch.effective_profile
        effective_provider = _switch.effective_provider
        effective_model = _switch.effective_model
        model_override = _switch.model_override

        # ql-20260818-002：切换字段与当前值**等值**（不构成切换）+ 空 prompt →
        # 拒绝——否则落普通 inject 路径发空 prompt SESSION_INJECT（daemon 拒收
        # 消息），run 永久卡 pending 堵死会话（TURN_CONFLICT）。
        if not config_switch and not prompt.strip():
            raise DaemonSessionNotActive(
                "prompt must not be empty.",
                details={"reason": "empty_prompt"},
            )

        # ql-20260818-009：取消档案（profile_changed=True 且 switch_profile=None）
        # 时对话历史里有深度角色扮演轮，仅靠 system prompt 中和压不住惯性。
        # 以简短用户消息形式显式告知「角色已取消」最有效——用户指令优先级最高，
        # 能可靠中止扮演。注意：仅在 profile_changed（档案主动变动）时触发，
        # 供应商单独切换 profile_changed=False 不会误触发。
        if profile_changed and switch_profile is None and not prompt.strip():
            prompt = "智能体档案已取消，无需继续扮演该角色。"

        config = dict(session.config or {})
        # ── 2026-08-22-team-session-unify task-04 / D-009@v1：主控轮双标记 ──
        # 会话存在活跃 mission（未收敛未取消，R-07 单活跃约束保证至多一条）时，
        # 当轮 AgentRun 回填 mission_id + role='orchestrator'——该 run 即"主控
        # run"（task-05 懒建补回填 / task-06 _get_main_run·finalizer 锚点 /
        # task-08 patrol 主控存续判定消费）。建 run 前查询 + 同事务落库：任一
        # 环节失败整体回滚，不落半标记；上方 turn 冲突守卫（:1232）保证单活
        # 跃轮，双标记时序安全（design §5 Phase 1）。无活跃 mission 时此处为
        # None → run 不带标记，既有行为逐字节不变。
        from app.modules.agent.mission import get_active_mission_for_session
        from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER

        active_mission = await get_active_mission_for_session(svc._session, session_id)
        # objective 占位回填（CC-09）：预建 mission 的 objective 为占位时，以
        # 首条带消息文本的 inject 回填——文本口径=用户 prompt 原文（附件标记
        # 行不参与，非 user_input_content）；回填后非占位，后续轮不再覆盖；
        # 纯配置切换轮（空 prompt）无消息文本，不消耗首条名额。
        if (
            active_mission is not None
            and active_mission.objective == SESSION_OBJECTIVE_PLACEHOLDER
            and prompt.strip()
        ):
            # ql-20260901-002：回填目标剥 /team 前缀（briefing 文本不带平台
            # 指令字面）；裸 /team 剥后为空不回填，占位保留给下一条带文本轮。
            _objective_text = _strip_team_command_prefix(prompt).strip()
            if _objective_text:
                active_mission.objective = _objective_text
                svc._session.add(active_mission)
        # ── 2026-08-24 task-08 / FR-01 / D-004@v1：主控首轮简报判定（inject 侧）──
        # task-06 组合入口（活跃 mission 查询 + 三条件判定 + 简报组装）：空
        # prompt 切换轮不注入不消耗、已消耗 orchestrator run 不再注、failed
        # 不烧断（D-013@v1）；简报内容单一来源在 mission_context，本处只做
        # 判定调用。必须建 run 前判定——当轮 run 落库即 pending orchestrator，
        # 判定会被自身短路（懒建回填同款机理，D-003@v1）。未命中返回 None →
        # 下方 SESSION_INJECT payload 原样透传（无 mission 会话逐字节不变）。
        from app.modules.agent.mission_context import resolve_first_turn_briefing

        first_turn_briefing = await resolve_first_turn_briefing(svc._session, session_id, prompt)
        # task-08 / D-013@v1（Grill CC-12）：空 prompt 纯切换轮无 LLM turn，不是
        # 主控轮——不落双标记。否则该轮 run 落库即 completed orchestrator run，
        # 会烧断简报一次性名额（与「纯切换轮不注入也不消耗」的验收口径冲突，
        # CC-12 关切正是"空 prompt 切换轮被双标记消耗一次性简报"）。带文本的
        # 切换轮是真 LLM 轮，照常双标记。
        silent_config_switch = config_switch and not prompt.strip()
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=session.provider,
            model=config.get("model"),
            status="pending",
            spec_strategy="interactive",
            agent_session_id=session.id,
            # 2026-09-10-auto-resume-interrupted-turn：续跑轮审计标记（源 run id）。
            metadata_=(
                {"auto_resume_of": str(auto_resume_of)} if auto_resume_of is not None else None
            ),
            # ql-20260817-003：轮次发送者=本轮注入者（_inject_into_session 的
            # 调用方注入：inject_session=实际 user；service 路径=会话属主）。
            user_id=run_sender_user_id,
            # task-04 / D-009：主控轮双标记——活跃 mission 命中时当轮回填
            # （role 字面量同 orchestrator.py _ORCHESTRATOR_ROLE 存量语义）；
            # task-08：纯切换轮例外不标记（见上方 silent_config_switch 注释）。
            mission_id=(
                active_mission.id
                if active_mission is not None and not silent_config_switch
                else None
            ),
            role=(
                "orchestrator" if active_mission is not None and not silent_config_switch else None
            ),
        )
        # task-05 / D-008（ql-20260815-010 修正为每轮落快照）：新 run 带本轮
        # 生效配置——切换轮=新值；普通轮=会话当前值（沿用），无配置=NULL 如实。
        from app.modules.agent.service import _build_agent_profile_snapshot

        run.agent_profile_id = effective_profile.id if effective_profile is not None else None
        run.agent_profile_snapshot = (
            _build_agent_profile_snapshot(effective_profile)
            if effective_profile is not None
            else None
        )
        run.llm_provider_id = new_llm_provider_id if config_switch else session.llm_provider_id
        svc._session.add(run)

        session.turn_count = (session.turn_count or 0) + 1
        session.last_active_at = now
        if config_switch:
            # task-05 / FR-04：会话三列刷新（快照含 machine_name/agent_name，
            # 与 create_session 的 Grill C-12 口径一致）。
            session.agent_profile_id = (
                effective_profile.id if effective_profile is not None else None
            )
            session.llm_provider_id = new_llm_provider_id
            machine_name, agent_name = await svc._resolve_runtime_labels(session.runtime_id)
            session.config_snapshot = {
                "profile_name": (effective_profile.name if effective_profile is not None else None),
                "provider_name": (
                    effective_provider.name if effective_provider is not None else None
                ),
                # task-11（FR-03-4）：回填本轮生效模型（显式所选 / 供应商原配
                # / 纯档案切换沿用已选），前端配置条展示用。
                "model": effective_model,
                "engine": session.provider,
                "machine_name": machine_name,
                "agent_name": agent_name,
            }
        svc._session.add(session)

        # task-01 / FR-02 / D-005@v1：后续 turn 同样落一条 channel="user_input"
        # AgentRunLog，挂在新建 run 上（首 turn 在 create_session 已落）。
        # 2026-08-20 task-06（D-3）：附件标记行插头部——[附件:id|kind|name]
        # 逐附件一行，换行后接原 prompt；kind 取 DB 原始值（前端回显缩略图
        # 数据源）；统一 USER_INPUT_LOG_MAX_CHARS 截断（ql-20260910-016 由 5000 放宽）。
        user_input_content = prompt
        if validated_attachments:
            from app.modules.session_attachment.service import (
                attachment_marker_line,
            )

            marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
            user_input_content = f"{marker_lines}\n{prompt}" if prompt else marker_lines
        svc._session.add(
            AgentRunLog(
                run_id=run.id,
                channel="user_input",
                content_redacted=user_input_content[:USER_INPUT_LOG_MAX_CHARS],
                timestamp=now,
                # task-03（群聊影子注入）：群链路 metadata（链 id/深度/发送者）
                # 随本轮日志落库；缺省 None 列保持 NULL（存量零回归）。
                metadata_=dict(turn_metadata) if turn_metadata is not None else None,
            )
        )

        # task-08 拆分：附件组装/gate 复核 + lease metadata 同步 +
        # providerConfig 构造段下沉 inject_gates._finalize_inject_turn_writes。
        _writes = await _finalize_inject_turn_writes(
            svc,
            session,
            validated_attachments=validated_attachments,
            prelocked_attachments=prelocked_attachments,
            config_switch=config_switch,
            profile_changed=profile_changed,
            switch_profile=switch_profile,
            provider_changed=provider_changed,
            new_llm_provider_id=new_llm_provider_id,
            effective_provider=effective_provider,
            model_override=model_override,
            effective_model=effective_model,
        )
        inject_attachments = _writes.inject_attachments
        profile_payload = _writes.profile_payload
        provider_config_payload = _writes.provider_config_payload

        # ql-20260817-010：静默切换——空 prompt 的切换轮无 LLM turn，run 直接
        # 落终态 completed（纯配置变更记录，无 user_input 日志 → 时间线不渲染）；
        # daemon 收到空 prompt 只 reload 配置不喂消息（reloadWithConfig 既有守卫）。
        if config_switch and not prompt.strip():
            run.status = "completed"
            run.finished_at = datetime.now(UTC)

        await svc._session.commit()
        await svc._session.refresh(session)
        await svc._session.refresh(run)
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    # task-08 拆分：commit 后派发段（ready 等待 + SESSION_SWITCH_CONFIG /
    # SESSION_INJECT 下发 + 失败收敛）下沉 control._dispatch_inject_turn。
    return await _dispatch_inject_turn(
        svc,
        session,
        run,
        prompt=prompt,
        config_switch=config_switch,
        profile_payload=profile_payload,
        provider_config_payload=provider_config_payload,
        first_turn_briefing=first_turn_briefing,
        page_context=page_context,
        inject_attachments=inject_attachments,
    )
