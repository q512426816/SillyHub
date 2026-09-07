"""inject/create 入口校验与门控（task-08 拆分）。

- ``_ensure_session_workspace_writable``（原 :3387-3402）：归档区只读守卫；
- ``_resolve_create_inputs`` + ``_CreateInputs``：create_session 前置校验/
  绑定/workspace/PPM 解析段（原 :1257-1611，分步函数拆出，零改写——附件
  校验段经 attachments.validate_create_attachments 复用）；
- ``_resolve_inject_turn_config`` + ``_InjectConfigSwitch``：_inject_into_
  session 配置切换解析段（原 :3674-3771 + :3790-3839，含 effective 档案/
  供应商/模型行解析——三段与 prompt 守卫无数据依赖，拆出后守卫留在调用方
  原位，行为等价）；
- ``_finalize_inject_turn_writes`` + ``_InjectTurnWrites``：附件组装/gate
  复核 + lease metadata 同步 + providerConfig 构造段（原 :3976-4114）。

D-007：log / _merge_lease_metadata 调用点经 ``_svc.`` 延迟解析。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import app.modules.daemon.session.service as _svc
from app.modules.agent.model import AgentSession
from app.modules.auth.permissions import Permission

# allowed_workspace_ids 绑定留在包 __init__（D-007——测试 patch 目标），经 _svc 取。
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.schema import TeamMissionCreateBlock
from app.modules.ppm.common.session_binding import (
    PpmItemKind,
    load_ppm_item,
    resolve_item_workspace_id,
)
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask

from .attachments import validate_create_attachments
from .errors import (
    DaemonSessionConfigInvalid,
    DaemonSessionLlmProviderKindMismatch,
    DaemonSessionLlmProviderNotFound,
    DaemonSessionNotActive,
    DaemonSessionRuntimeNotFound,
    DaemonSessionRuntimeUnavailable,
    DaemonSessionTeamMissionInvalid,
    DaemonSessionWorkspaceNotFound,
)
from .helpers import _detect_platform_profile_binding, _PlatformSessionBinding


async def _ensure_session_workspace_writable(svc, session: AgentSession) -> None:
    """ql-20260829-011：归档区存量会话只读守卫。

    会话挂工作区且该工作区已归档 → 409 WorkspaceArchived（统一守卫
    ``WorkspaceService.ensure_writable``，与创建会话/发起变更同口径）；
    非工作区会话（workspace_id null）不拦。inject 主路径/service 身份路径
    与 interrupt 共用本守卫。
    """
    if session.workspace_id is None:
        return
    from app.modules.workspace.model import Workspace
    from app.modules.workspace.service import WorkspaceService

    ws = await svc._session.get(Workspace, session.workspace_id)
    if ws is not None:
        WorkspaceService.ensure_writable(ws)


@dataclass
class _CreateInputs:
    """create_session 前置校验产物（task-08 分步函数传参载体，字段即原局部变量）。"""

    provider: str | None
    model: str | None
    manual_approval: bool
    workspace_id: uuid.UUID | None
    cwd: str | None
    pinned_runtime_id: uuid.UUID | None
    platform_binding: _PlatformSessionBinding | None
    validated_attachments: list = field(default_factory=list)
    profile: object | None = None
    llm_provider_row: object | None = None
    mission_scope_ids: list[uuid.UUID] | None = None
    mission_anchor_id: uuid.UUID | None = None
    ppm_item_ok: bool = False
    ppm_ws: uuid.UUID | None = None
    ppm_item_row: object | None = None


async def _resolve_create_inputs(
    svc,
    user_id: uuid.UUID,
    *,
    provider: str | None,
    model: str | None = None,
    manual_approval: bool = False,
    workspace_id: uuid.UUID | None = None,
    runtime_id: str | None = None,
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    team_mission: TeamMissionCreateBlock | None = None,
    ppm_item_kind: PpmItemKind | None = None,
    ppm_item_id: uuid.UUID | None = None,
    attachment_ids: list[uuid.UUID] | None = None,
) -> _CreateInputs:
    """create_session 入参校验/绑定/workspace/PPM 前置解析（分步函数，零改写）。

    原地拆自 create_session :1257-1611：platform 共享档案检测 → runtime_id
    钉定解析 → 首句附件校验 → 档案/会话供应商解析 → workspace cwd →
    team_mission 共享校验与 E2 主 agent 工作区 → platform cwd 覆写 → PPM
    条目绑定前置解析。全部前置到写事务外：不可满足直接 4xx，无半成品落库。
    """
    # ── task-05（2026-08-28-daemon-agent-share / FR-04 / D-007@v1）：platform
    # 共享档案检测前置——先于 runtime_id/provider 二选一校验（Grill B-01：悬浮
    # 助手/门户只传 agent_profile_id（无 runtime_id/provider）形态在原校验
    # :950-954 之后必被拒）。检测命中 → 进服务端强制分支（钉定 pinned runtime
    # + 派生 provider；cwd 覆写在 team_mission 块后统一施加，见下方）；未命中
    # （普通档案 / grant 停用 / 档案悬空 / runtime 离线）→ 零分支走原链路，
    # 停用后档案天然回普通语义（constraints）。grants 空表 → 恒 None 零回归。
    _platform_binding: _PlatformSessionBinding | None = None
    if agent_profile_id:
        try:
            _platform_profile_uuid = uuid.UUID(agent_profile_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionConfigInvalid(
                f"Invalid agent_profile_id '{agent_profile_id}'.",
                details={"agent_profile_id": agent_profile_id},
            ) from exc
        _platform_binding = await _detect_platform_profile_binding(
            svc._session, profile_id=_platform_profile_uuid
        )

    # ── task-03：runtime_id 入口解析（钉定 + 派生 provider，Grill C-01/P0）──
    # 校验在事务开始前完成：不可满足直接 4xx，无半成品落库；placement 侧
    # pinned 路径二次复查（竞态防线），失联同样转 4xx，绝不静默换机。
    pinned_runtime_id: uuid.UUID | None = None
    if _platform_binding is not None:
        # task-05 强制分支：无视请求 runtime_id 语义（防伪造——约束由服务端
        # 施加，请求参数不可放宽），钉定 grant 的 pinned_runtime_id 并派生
        # provider。下发侧 prepare_interactive_dispatch 传
        # pinned_skip_owner_check=True（代表钉定模式，:612-620 先例）：placement
        # 只按 id+online 复查，不进借用授权分支 → 不写 daemon_borrow_audit、
        # 不带借用沙箱 marker（D-007@v1：platform 是平台授权非工作区借用，
        # 用量计量走 AgentSession 既有口径）。离线竞态仍转 4xx 不静默换机。
        pinned_runtime_id = _platform_binding.pinned_runtime_id
        provider = _platform_binding.provider
        # E2E 修正（2026-08-28，R-10）：平台共享会话强制 manual_approval=False
        # ——约束即策略（writable_dir 写边界 + 禁 Bash 白名单），远程人审无增益
        # 且实测 enableApproval=true 路径下写守卫未生效（目录外写放行、零审计）；
        # enableApproval=false 路径（write-only 守卫）经对照实验实证可用
        # （机器级边界 deny + 审计落库）。服务端强制，请求参数不可放宽。
        manual_approval = False
    elif runtime_id:
        try:
            pinned_runtime_id = uuid.UUID(runtime_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionRuntimeNotFound(
                f"Invalid runtime_id '{runtime_id}'.",
                details={"runtime_id": runtime_id},
            ) from exc
        _rt = await svc._session.get(DaemonRuntime, pinned_runtime_id)
        if _rt is None:
            raise DaemonSessionRuntimeNotFound(
                f"Runtime '{runtime_id}' not found.",
                details={"runtime_id": runtime_id},
            )
        # ── task-03（2026-08-28-daemon-agent-share / FR-02 / D-001@v1 +
        # D-006@v1）：钉定授权判定——owner 短路，非本人走 grants──
        # ``_rt.user_id == user_id`` 自有 runtime 走原路径（零回归）；否则调
        # task-02 的 ``authorize_pinned_runtime``（grants 授权唯一判定源）：
        # - workspace_grant 命中（成员 + daemon:borrow 权限 + enabled + 机器
        #   在线）→ 放行，按**借用会话**处理——lender/grant_id 的审计关联由
        #   placement 二次复查（_query_pinned_online_runtime 授权分支，同源
        #   判定）命中后写入 daemon_borrow_audit（含 grant_id）+ 借用沙箱
        #   marker，本层只做授权闸不重复记审计；
        # - platform_grant 命中 → authorize 返回 None → 404（D-012@v1，
        #   验收审查 gap-2）：直接钉定 platform grant 的 pinned runtime
        #   （不带共享档案）会绕过 task-05 强制（cwd/写约束/工具集），
        #   该形态首查即封堵；共享 runtime 唯一入口=task-05 档案检测
        #   （上方强制分支，下发走 pinned_skip_owner_check=True 不经
        #   authorize，不受影响）；
        # - None（未授权/停用 grant/机器离线）→ 维持 DaemonSessionRuntimeNotFound
        #   404 语义，不泄露存在性（design §9）；下方 404/离线/provider 校验
        #   顺序与语义不变。
        if _rt.user_id != user_id:
            # 函数级 import 对齐本模块跨域 lazy 范式（design §7.2 / §10 R1）。
            from app.modules.daemon.grants.queries import authorize_pinned_runtime

            _pin_authz = await authorize_pinned_runtime(
                svc._session,
                actor_user_id=user_id,
                runtime_id=pinned_runtime_id,
                workspace_id=workspace_id,
            )
            if _pin_authz is None:
                raise DaemonSessionRuntimeNotFound(
                    f"Runtime '{runtime_id}' not found.",
                    details={"runtime_id": runtime_id},
                )
        if _rt.status != "online":
            raise DaemonSessionRuntimeUnavailable(
                f"Runtime '{runtime_id}' is offline.",
                details={"runtime_id": runtime_id, "status": _rt.status},
            )
        if not _rt.provider:
            raise DaemonSessionRuntimeUnavailable(
                f"Runtime '{runtime_id}' has no provider.",
                details={"runtime_id": runtime_id},
            )
        # 派生 provider（design §5：runtime_id 优先，覆盖入参 provider）。
        provider = _rt.provider
    elif not provider:
        raise DaemonSessionNotActive(
            "either runtime_id or provider must be provided.",
            details={"reason": "missing_provider"},
        )

    # ── ql-20260825-001：首句附件校验（对齐 inject 路径 task-05 段）──
    # D-6 引擎门控（仅 Claude 支持附件）/ 归属+存在 404 / 数量 422（图≤5、
    # 文≤5）/ 保序。整体拒绝不部分生效：任一失败 raise → 无半成品落库。
    # provider-abstraction task-11：引擎门控收敛查 ProviderCaps（multimodal
    # 键；文案逐字保留，与原 != "claude" 判定等价）。
    # task-08：校验体下沉 attachments.validate_create_attachments（零改写）。
    validated_attachments: list = []
    if attachment_ids:
        validated_attachments = await validate_create_attachments(
            svc,
            user_id=user_id,
            provider=provider,
            attachment_ids=attachment_ids,
        )
    # ── task-03：档案解析（D-013：只消费提示词维度，不做引擎过滤）──
    # 复用 AgentProfileService.get 的读可见性校验（与 GET /agent-profiles
    # ?scope=mine 列表同口径）：不存在 → 404；不可见 → 403。不兜底、不软回退
    # （用户显式选择，契约字段缺失/失效必须显式报错）。
    profile = None
    if agent_profile_id:
        from app.modules.agent.profile.service import AgentProfileService
        from app.modules.auth.model import User as _User

        try:
            _profile_uuid = uuid.UUID(agent_profile_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionConfigInvalid(
                f"Invalid agent_profile_id '{agent_profile_id}'.",
                details={"agent_profile_id": agent_profile_id},
            ) from exc
        _actor = await svc._session.get(_User, user_id)
        if _actor is None:
            raise DaemonSessionConfigInvalid(
                "Session owner user not found.",
                details={"user_id": str(user_id)},
            )
        profile = await AgentProfileService(svc._session).get(
            profile_id=_profile_uuid, actor=_actor
        )

    # ── task-03：会话级供应商解析（归属 + agent_kind 匹配，FR-04/FR-06）──
    llm_provider_row = None
    if llm_provider_id:
        from app.modules.llm_provider.model import LlmProvider

        try:
            _provider_uuid = uuid.UUID(llm_provider_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionConfigInvalid(
                f"Invalid llm_provider_id '{llm_provider_id}'.",
                details={"llm_provider_id": llm_provider_id},
            ) from exc
        llm_provider_row = await svc._session.get(LlmProvider, _provider_uuid)
        if llm_provider_row is None or llm_provider_row.user_id != user_id:
            raise DaemonSessionLlmProviderNotFound(
                f"LlmProvider '{llm_provider_id}' not found.",
                details={"llm_provider_id": llm_provider_id},
            )
        # agent_kind 与引擎（runtime 派生 provider，如 claude/codex）不匹配 →
        # 422（FR-06），不静默降级。
        if llm_provider_row.agent_kind != provider:
            raise DaemonSessionLlmProviderKindMismatch(
                "LlmProvider agent_kind does not match the session engine.",
                details={
                    "llm_provider_id": llm_provider_id,
                    "agent_kind": llm_provider_row.agent_kind,
                    "engine": provider,
                },
            )

    # 2026-07-09-change-detail-session / D-003@v1：变更会话 cwd=workspace 本地
    # 项目根。复用 Workspace.root_path（workspace/model.py:63），未传 workspace_id
    # 时 cwd=None 走原逻辑（边界 E4，零回归）。
    cwd: str | None = None
    if workspace_id is not None:
        # D-001@v1：workspace 归属校验，口径与前端 listWorkspaces 一致。
        # 无权限与工作区不存在同语义（404），不泄露存在性。
        # 平台管理员旁路权限判定（口径对齐 rbac.allowed_workspace_ids docstring
        # 「Platform admin bypasses at the dependency layer」），但仍要求工作区
        # 真实存在（保持 404 语义）。2026-08-20 审计顺手修：管理员建会话 404。
        from app.modules.auth.model import User as _User

        _actor = await svc._session.get(_User, user_id)
        _is_admin = bool(_actor and _actor.is_platform_admin)
        _allowed = (
            []
            if _is_admin
            else await _svc.allowed_workspace_ids(
                svc._session, user_id=user_id, permission=Permission.WORKSPACE_READ
            )
        )
        if not _is_admin and workspace_id not in _allowed:
            raise DaemonSessionWorkspaceNotFound(
                f"Workspace '{workspace_id}' not found or you have no access.",
                details={"workspace_id": str(workspace_id)},
            )
        from app.modules.workspace.model import Workspace as _Workspace

        if _is_admin and await svc._session.get(_Workspace, workspace_id) is None:
            raise DaemonSessionWorkspaceNotFound(
                f"Workspace '{workspace_id}' not found or you have no access.",
                details={"workspace_id": str(workspace_id)},
            )
        from app.modules.workspace.model import Workspace

        _ws = await svc._session.get(Workspace, workspace_id)
        if _ws is not None:
            # ql-20260829-010：归档工作区禁写——创建会话 409（守卫与中文提示
            # 统一收敛在 WorkspaceService.ensure_writable）。
            from app.modules.workspace.service import WorkspaceService as _WSSvc

            _WSSvc.ensure_writable(_ws)
            cwd = _ws.root_path

    # ── task-09（2026-08-24-session-team-mission-context / FR-05/06）：预会话
    # 团队任务块解析（事务开始前，design §5.E1/E2）──共享校验
    # ``validate_team_mission_block``（task-07：scope 去重保序/项目维度
    # 403/scope 越界 422/anchor backend-code 优先派生）+ E2 主 agent 工作区
    # （orchestrator_workspace_id）解析。全部前置到事务外：不可满足直接
    # 4xx，无半成品落库。缺省 None 零分支进入（零回归）。
    mission_scope_ids: list[uuid.UUID] | None = None
    mission_anchor_id: uuid.UUID | None = None
    if team_mission is not None:
        from app.modules.auth.model import User as _User

        _tm_actor = await svc._session.get(_User, user_id)
        if _tm_actor is None:
            raise DaemonSessionConfigInvalid(
                "Session owner user not found.",
                details={"user_id": str(user_id)},
            )
        # 延迟 import：daemon.router 顶层 import 本模块（get_session_readiness），
        # 函数内取 task-07 共享校验避免模块环（单一实现，无复制粘贴）。
        from app.modules.daemon.router import validate_team_mission_block

        mission_scope_ids, mission_anchor_id = await validate_team_mission_block(
            svc._session,
            _tm_actor,
            team_mission,
            fallback_workspace_id=workspace_id,
        )

        # ── E2 主 agent 工作区（design §5.E2 / D-010@v1）──
        _orch_ws_id = team_mission.orchestrator_workspace_id
        if _orch_ws_id is not None:
            assert mission_scope_ids is not None  # 上方已赋值，助 mypy 收窄
            if _orch_ws_id not in mission_scope_ids:
                raise DaemonSessionTeamMissionInvalid(
                    "主 agent 工作区必须在团队任务 scope 内。",
                    details={"orchestrator_workspace_id": str(_orch_ws_id)},
                )
            # (W, 创建者) 的 WorkspaceMemberRuntime binding（D-014@v1）：
            # 行缺失或 runtime_id 空 → 422「该工作区未绑定你的机器」，
            # 不借用他人 binding 钉定。
            from app.modules.workspace.member_runtimes.model import (
                WorkspaceMemberRuntime,
            )

            _binding = await svc._session.get(WorkspaceMemberRuntime, (_orch_ws_id, user_id))
            if _binding is None or _binding.runtime_id is None:
                raise DaemonSessionTeamMissionInvalid(
                    "该工作区未绑定你的机器，无法作为主 agent 工作区。",
                    details={"orchestrator_workspace_id": str(_orch_ws_id)},
                )
            # 命中：workspace_id 覆写 W + cwd=W.root_path（W ∈ scope 已验）。
            from app.modules.workspace.model import Workspace as _E2Workspace

            _w_row = await svc._session.get(_E2Workspace, _orch_ws_id)
            workspace_id = _orch_ws_id
            cwd = _w_row.root_path if _w_row is not None else None
            # binding.runtime_id 作 pinned_runtime_id 复用既有钉定链
            # （placement 属主+在线复查，失联转 4xx 不静默换机）；用户显式
            # 传 runtime_id 时显式优先（R-09：W 仅决定 workspace_id/cwd）。
            # task-05：platform 会话钉定不可被 E2 覆盖——共享智能体的
            # pinned runtime 是服务端强制项，team_mission 请求参数不得放宽。
            if not runtime_id and _platform_binding is None:
                pinned_runtime_id = _binding.runtime_id
            # 用户未显式传 agent_profile_id/llm_provider_id/runtime_id 时
            # provider/model 落 W.default_agent/W.default_model（显式选择
            # 逐字节优先，R-09，后端不因不一致 422）。
            if not (agent_profile_id or llm_provider_id or runtime_id):
                if _w_row is not None and _w_row.default_agent:
                    provider = _w_row.default_agent
                if _w_row is not None and _w_row.default_model:
                    model = _w_row.default_model

    # ── task-05（FR-04 / D-002@v2 / Grill B-01 前置生效）：platform 会话
    # cwd 强制覆写──统一施加在 request workspace cwd（:1086-1120 既有落点）
    # 与 team_mission E2 cwd 之后：cwd = 源码工作区 root_path（读源码基准），
    # 请求 workspace 语义不参与 cwd（防伪造，服务端强制）。AgentSession
    # .workspace_id 仍记请求工作区（用户可访问的自身上下文，归属校验已过），
    # 只作 bookkeeping，不改变 lease 定位与 cwd 语义。
    if _platform_binding is not None:
        cwd = _platform_binding.source_root_path

    # ── task-02（2026-08-28-session-ppm-task-binding / FR-01 / D-004@v2）：
    # PPM 条目绑定前置解析（写事务前，纯只读）──成对携带 ppm_item_* 时先
    # load_ppm_item 校验条目存在性：查无记 ``session_ppm_bind_item_missing``
    # warning 后**降级普通会话**（§9：不 4xx/5xx 阻塞创建，不落 link）；
    # 命中则 resolve_item_workspace_id 解析条目所属项目第一个关联工作区
    # （workspace_id 升序第一个，D-004@v2），供下方 AgentSession.workspace_id
    # 未显式指定时回填 + 写事务内 bind_session_to_ppm_item 落 link 快照。
    # 项目无关联工作区 → ppm_ws=None，两者留空不阻塞（D-004）。缺省双 None
    # 零分支进入（零回归）。
    # ql-20260828-003：加载的条目行向下透传（物化 + 前导复用同一行，
    # 全链只查一次 DB——此前前置解析/物化/前导三处各查一次）。
    ppm_item_ok = False
    ppm_ws: uuid.UUID | None = None
    ppm_item_row: PlanTask | PpmProblemList | None = None
    if ppm_item_kind is not None and ppm_item_id is not None:
        _ppm_item = await load_ppm_item(svc._session, ppm_item_kind, ppm_item_id)
        if _ppm_item is None:
            _svc.log.warning(
                "session_ppm_bind_item_missing",
                kind=ppm_item_kind,
                item_id=str(ppm_item_id),
            )
        else:
            ppm_item_ok = True
            ppm_item_row = _ppm_item
            ppm_ws = await resolve_item_workspace_id(svc._session, ppm_item_kind, ppm_item_id)
    return _CreateInputs(
        provider=provider,
        model=model,
        manual_approval=manual_approval,
        workspace_id=workspace_id,
        cwd=cwd,
        pinned_runtime_id=pinned_runtime_id,
        platform_binding=_platform_binding,
        validated_attachments=validated_attachments,
        profile=profile,
        llm_provider_row=llm_provider_row,
        mission_scope_ids=mission_scope_ids,
        mission_anchor_id=mission_anchor_id,
        ppm_item_ok=ppm_item_ok,
        ppm_ws=ppm_ws,
        ppm_item_row=ppm_item_row,
    )


@dataclass
class _InjectConfigSwitch:
    """_inject_into_session 配置切换解析产物（task-08 分步函数传参载体）。"""

    profile_changed: bool
    switch_profile: object | None
    provider_changed: bool
    provider_row: object | None
    new_llm_provider_id: uuid.UUID | None
    selected_model: str | None
    model_reset: bool
    config_switch: bool
    effective_profile: object | None
    effective_provider: object | None
    effective_model: str | None
    model_override: bool


async def _resolve_inject_turn_config(
    svc,
    session: AgentSession,
    *,
    agent_profile_id: str | None,
    llm_provider_id: str | None,
    model: str | None,
) -> _InjectConfigSwitch:
    """_inject_into_session 配置切换解析段（task-08 分步函数拆出，零改写）。

    原地拆自 :3674-3771（profile/provider/model 三态解析 + config_switch）
    与 :3790-3839（effective 档案/供应商/模型行解析）。三态解析与 effective
    解析两段之间原夹 prompt 空守卫（:3773-3788）——守卫只读 config_switch /
    profile_changed，与本函数产出无数据依赖，留在调用方原位执行，行为等价。
    """
    # ── task-05：配置切换解析（FR-05/FR-06 / Grill C-05 / D-013）────────
    # 维度语义：入参 None=不动；profile 非空且≠当前 → 切；provider 非空且
    # ≠当前 → 切，空串（"none"）→ 清空回本机默认；与当前值相同 → 等价不动
    # （落回原有 inject 路径，零回归）。校验失败在事务内 raise → rollback，
    # 会话状态与列不变（R-03）。
    profile_changed = False
    switch_profile = None
    if agent_profile_id == "":
        # ql-20260818-004：空串 = "none" → 取消档案（写 NULL 回无人格），
        # 与 llm_provider_id 空串语义对称。已 NULL 时等价不动。
        if session.agent_profile_id is not None:
            profile_changed = True
    elif agent_profile_id:
        try:
            _new_profile_uuid = uuid.UUID(agent_profile_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionConfigInvalid(
                f"Invalid agent_profile_id '{agent_profile_id}'.",
                details={"agent_profile_id": agent_profile_id},
            ) from exc
        if _new_profile_uuid != session.agent_profile_id:
            from app.modules.agent.profile.service import AgentProfileService
            from app.modules.auth.model import User as _User

            _actor = await svc._session.get(_User, session.user_id)
            if _actor is None:
                raise DaemonSessionConfigInvalid(
                    "Session owner user not found.",
                    details={"user_id": str(session.user_id)},
                )
            # 读可见性与 GET /agent-profiles?scope=mine 同口径（同 create）。
            switch_profile = await AgentProfileService(svc._session).get(
                profile_id=_new_profile_uuid, actor=_actor
            )
            profile_changed = True

    provider_changed = False
    provider_row = None
    new_llm_provider_id = session.llm_provider_id
    if llm_provider_id is not None:
        if llm_provider_id == "":
            # 空串 = "none" → 清空会话供应商（写 NULL 回本机默认）。已 NULL
            # 时等价不动（不触发切换分支）。
            if session.llm_provider_id is not None:
                provider_changed = True
                new_llm_provider_id = None
        else:
            try:
                _new_provider_uuid = uuid.UUID(llm_provider_id)
            except (ValueError, AttributeError, TypeError) as exc:
                raise DaemonSessionConfigInvalid(
                    f"Invalid llm_provider_id '{llm_provider_id}'.",
                    details={"llm_provider_id": llm_provider_id},
                ) from exc
            if _new_provider_uuid != session.llm_provider_id:
                from app.modules.llm_provider.model import LlmProvider

                provider_row = await svc._session.get(LlmProvider, _new_provider_uuid)
                # 归属按 AgentSession.user_id（Grill C-05：借用 runtime 场景
                # borrower 供应商不被静默拒绝），404 不泄露存在性。
                if provider_row is None or provider_row.user_id != session.user_id:
                    raise DaemonSessionLlmProviderNotFound(
                        f"LlmProvider '{llm_provider_id}' not found.",
                        details={"llm_provider_id": llm_provider_id},
                    )
                # FR-06：agent_kind 与会话引擎不匹配 → 422，不静默降级。
                if provider_row.agent_kind != session.provider:
                    raise DaemonSessionLlmProviderKindMismatch(
                        "LlmProvider agent_kind does not match the session engine.",
                        details={
                            "llm_provider_id": llm_provider_id,
                            "agent_kind": provider_row.agent_kind,
                            "engine": session.provider,
                        },
                    )
                provider_changed = True
                new_llm_provider_id = provider_row.id

    # ── task-11（2026-08-29-usage-by-provider-model / FR-03-3 / design §4.2）：
    # 会话级模型选择解析（三态，与 llm_provider_id None/空串语义同构）：
    # ① None（不带键）= 不动——普通轮/纯档案切换零回归（前端聊天路径
    # 恒不带 model 键）；② 空串 = 显式「跟随供应商配置」重置（前端切模
    # 型选「默认」、切供应商级联重置均发空串）；③ 非空 = 显式选模型
    # （依赖供应商——守卫在 inject_session 入口）。②③ 都构成切换轮（进
    # SESSION_SWITCH_CONFIG 分支，daemon reload 重建 driver 使
    # ANTHROPIC_MODEL 生效）。
    selected_model: str | None = None
    model_reset = False
    if model is None:
        pass
    elif model.strip():
        selected_model = model
    else:
        model_reset = True

    config_switch = profile_changed or provider_changed or selected_model is not None or model_reset

    # 解析本轮生效（effective）档案/供应商行：切换轮用新值、未切维度与
    # 普通轮（不切换）沿用会话当前值——D-008 每轮 run 都要带配置快照
    # （ql-20260815-010 修正：此前仅切换分支落快照，普通轮 run 的
    # agent_profile_id/llm_provider_id 为 NULL → 前端 whoLine 误显
    # 「未指定/本机默认」）。按 id 取行（create 时已过校验，不重查）。
    effective_profile = switch_profile
    effective_provider = provider_row
    if not profile_changed and session.agent_profile_id is not None:
        from app.modules.agent.profile.model import AgentProfile as _AgentProfile

        effective_profile = await svc._session.get(_AgentProfile, session.agent_profile_id)
    if not provider_changed and session.llm_provider_id is not None:
        from app.modules.llm_provider.model import LlmProvider

        effective_provider = await svc._session.get(LlmProvider, session.llm_provider_id)

    # ── task-11（FR-03-3 / design §4.2）：本轮生效模型（config_snapshot
    # 展示与下发 providerConfig 同步的单一口径）─────────────────────────
    # ① 显式选模型 → 所选；② 显式切供应商（含空串清空）→ 重置回新供应
    # 商原配置（避免旧供应商所选模型残留）；③ model 空串「跟随配置」→
    # 重置回当前供应商原配置；④ 纯档案切换/供应商等值（不带 model 键）→
    # 会话级模型**不动**（沿用此前所选；无历史快照的旧会话回落供应商原
    # 配置，与 task-05 重算口径一致）。model_override 标记「生效模型是
    # 会话级选择」（非供应商原配）——下发 providerConfig 时才做 R-07
    # 快照同步；重置场景（②③）保持原样透传零回归。
    prior_model = (session.config_snapshot or {}).get("model")
    provider_original = (
        (effective_provider.model or effective_provider.default_fallback_model)
        if effective_provider is not None
        else None
    )
    if selected_model is not None:
        effective_model: str | None = selected_model
        model_override = True
    elif provider_changed:
        effective_model = (
            (provider_row.model or provider_row.default_fallback_model)
            if provider_row is not None
            else None
        )
        model_override = False
    elif model_reset:
        effective_model = provider_original
        model_override = False
    elif prior_model is not None:
        effective_model = prior_model
        model_override = True
    else:
        effective_model = provider_original
        model_override = False
    return _InjectConfigSwitch(
        profile_changed=profile_changed,
        switch_profile=switch_profile,
        provider_changed=provider_changed,
        provider_row=provider_row,
        new_llm_provider_id=new_llm_provider_id,
        selected_model=selected_model,
        model_reset=model_reset,
        config_switch=config_switch,
        effective_profile=effective_profile,
        effective_provider=effective_provider,
        effective_model=effective_model,
        model_override=model_override,
    )
