"""Lease claim payload builder — execution context construction for a claimed lease.

原 DaemonService._build_claim_payload（service.py:369，~123 行），task-06 迁为模块级
函数 ``build_claim_payload(session, lease)``。行为零变更：interactive 分支提前 return；
batch 分支 agent_run_id NULL 校验（DaemonLeaseNoAgentRun）、AgentRun 字段提取、
workspace_id、lease metadata 透传（prompt/provider/model/repo_url/branch/tool_config/
workspace_*/root_path 等）、runtime capabilities（cmd_path/protocol）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import AgentRunWorkspace
from app.modules.workspace.service import resolve_root_path_for_daemon

log = get_logger(__name__)


def _raise_no_agent_run(lease: DaemonTaskLease) -> None:
    """Raise DaemonLeaseNoAgentRun（task-07 迁入 lease/service.py 定义）。

    函数级 lazy import 避免与 ``lease.service`` 的循环依赖
    （``service.py`` 顶部 import ``build_claim_payload``，本模块需反向引用
    service 定义的异常类）。同款模式见 facade ``__init__`` 与 router.py:624
    （design §7.2 / D-005@v1）。
    """
    from app.modules.daemon.lease.service import DaemonLeaseNoAgentRun

    raise DaemonLeaseNoAgentRun(
        f"Batch lease '{lease.id}' has no agent_run_id (kind={lease.kind}).",
        details={"lease_id": str(lease.id), "kind": lease.kind},
    )


def _normalize_lease_provider(raw: str | None) -> str | None:
    """归一化 backend adapter id → daemon provider key（ql-20260703-001）。

    backend AgentRun.agent_type 永远是 adapter id（默认 'claude_code'），经 lease
    metadata.provider 透传给 daemon。daemon _agentPaths 按 agent-detector 的 provider
    key（'claude'）注册，命名空间不一致。这里在 backend 输出边界归一化（双保险：daemon
    端 normalizeProvider 也做同样归一化），避免任何一边漏改导致 claude_code vs claude
    错配重现 → daemon _agentPaths.get 失败 → interactive 静默早返回 → lease 永远
    claimed / run 永远 pending。

    映射：'claude_code' / 'claude-code'(legacy) → 'claude'；其余原样（adapter id 与
    detector key 同名时直接命中 _agentPaths）。
    """
    if raw == "claude_code" or raw == "claude-code":
        return "claude"
    return raw


async def _inject_provider_config(
    session: AsyncSession,
    lease: DaemonTaskLease,
    lease_meta: dict,
    payload: dict,
    *,
    agent_kind_raw: str | None,
) -> None:
    """task-06 / FR-03 / D-005@v1：按 lease 关联用户查默认 LlmProvider，注入 provider_config。

    user_id 解析（R-01 已关闭）：
      - 主路径 ``lease.runtime_id → DaemonRuntime.user_id``（daemon/model.py:144，
        nullable=False，全 lease kind 适用——claim 阶段 runtime 必在）。
      - interactive 兜底 ``lease_meta.session_id → AgentSession.user_id``
        （agent/model.py:429；session_id 是 AgentSession.id 的 str 形式，
        placement.py:434 写入）。仅 runtime 缺失才走此路（防御性，batch 不会触发）。

    agent_kind 归一化（X-08）：复用 ``_normalize_lease_provider``（claude_code→claude）。
    查询（D-008 owner 级 + R-05 is_default 互斥）：``user_id AND agent_kind=归一化
    AND is_default=True``，三者对齐才命中。

    命中：
      - ``CredentialCipher.decrypt``（task-03 service 同款，复用 ``get_cipher()``）
        明文 api_key 放入 provider_config（8 字段，task-06 provides contract）。
      - X-10 default_model 落点：provider.model 优先（design §9），否则
        default_fallback_model，覆盖 payload[model] 原 lease_meta/agent_run 来源。
    未配（D-007 零回归）：payload 不加 provider_config 键（absent），daemon 第0层跳过，
    payload[model] 维持原值。
    R-02：明文 api_key 仅放 provider_config（claim/create 阶段下发），不入 ORM/审计/日志。
    """
    # ── user_id 解析（R-01：runtime_id→DaemonRuntime.user_id 主路径）──
    user_id: uuid.UUID | None = None
    if lease.runtime_id is not None:
        runtime = await session.get(DaemonRuntime, lease.runtime_id)
        if runtime is not None:
            user_id = runtime.user_id
    if user_id is None:
        # interactive 兜底：lease_meta.session_id（AgentSession.id 的 str）→ AgentSession.user_id
        sess_raw = lease_meta.get("session_id")
        sess_uuid: uuid.UUID | None = None
        if sess_raw:
            try:
                sess_uuid = uuid.UUID(sess_raw) if isinstance(sess_raw, str) else sess_raw
            except (ValueError, AttributeError, TypeError):
                sess_uuid = None
        if sess_uuid is not None:
            from app.modules.agent.model import AgentSession

            uid_stmt = select(AgentSession.user_id).where(AgentSession.id == sess_uuid).limit(1)
            user_id = (await session.execute(uid_stmt)).scalar()
    if user_id is None:
        return  # 无法解析用户 → 不注入（D-007）

    # ── agent_kind 归一化（X-08：复用 _normalize_lease_provider）──
    agent_kind = _normalize_lease_provider(agent_kind_raw)
    if agent_kind is None:
        return  # 无 agent_kind 信号 → 不注入

    # ── 查默认 provider（owner 级 + agent_kind 对齐 + is_default=True）──
    from app.core.crypto import get_cipher
    from app.modules.llm_provider.model import LlmProvider

    stmt = (
        select(LlmProvider)
        .where(
            LlmProvider.user_id == user_id,
            LlmProvider.agent_kind == agent_kind,
            LlmProvider.is_default.is_(True),
        )
        .limit(1)
    )
    provider = (await session.execute(stmt)).scalars().first()
    if provider is None:
        return  # D-007：用户未配默认 provider → absent

    # 解密 api_key 明文（daemon spawn-env 注入 AUTH_TOKEN/AUTH_API_KEY 必需）
    api_key_plain = get_cipher().decrypt(provider.encrypted_api_key, provider.key_id)
    payload["provider_config"] = {
        "agent_kind": provider.agent_kind,
        "base_url": provider.base_url,
        "api_key": api_key_plain,
        "auth_field": provider.auth_field,
        "model": provider.model,
        "model_role_mappings": provider.model_role_mappings,
        "default_fallback_model": provider.default_fallback_model,
        "extra_env": provider.extra_env,
        # task-04（D-009 / design §5.2）：原样透传 settings_config，不解密/不加工/不判空。
        # None（含 task-01 brownfield 老行）照传 None，daemon 侧 ?.env ?? {} 链路判空。
        "settings_config": provider.settings_config,
    }
    # X-10：provider.model（design §9 优先）→ default_fallback_model 覆盖 payload[model]
    override_model = provider.model or provider.default_fallback_model
    if override_model:
        payload["model"] = override_model


# task-07 / C-13：claim payload 透传的 profile 字段（snake_case, camelCase）。
# 来源：task-06 ``AgentService._apply_profile_to_lease`` 写入 lease.metadata（service.py:720）。
# system_prompt 不在此列——注入走 task-06 的 claudeMd prepend（design §7 / D-012@v2），
# 由 ``get_execution_context`` 构造响应时 prepend 到 claudeMd 顶部，不经 context.py。
_PROFILE_PAYLOAD_FIELDS: tuple[tuple[str, str], ...] = (
    ("mcp_refs", "mcpRefs"),
    ("skill_refs", "skillRefs"),
    ("effective_allowed_roots", "effectiveAllowedRoots"),
    ("profile_version", "profileVersion"),
)


def _apply_profile_passthrough(lease_meta: dict, payload: dict) -> None:
    """task-07 / C-13：从 ``lease.metadata`` 读 task-06 写入的 profile 字段，双写
    (camelCase + snake_case) 进 claim payload。

    透传四键（design §6 生命周期契约表 / §9）：

    * ``mcp_refs`` / ``skill_refs``：profile 引用集，daemon 端按此取子集（task-09/10）。
    * ``effective_allowed_roots``：``daemon ∩ profile.allowed_roots_overlay``（D-013，
      backend 算交集下推）→ daemon ``frozenAllowedRoots`` / ``allowedRootsProvider`` 采用。
    * ``profile_version``：快照版本（审计 / daemon 保鲜比对）。

    **无键则不含**：逐键 ``in`` 守护，``lease.metadata`` 缺这些键时 payload 不加（profile=None
    的 run 行为零变化，向后兼容）。task-06 写入时四键成组落盘，逐键守护仍保留——防御未来
    部分写入 / 旧 lease 半迁移场景。

    双写惯例对齐 daemon ``execPayload`` 归一化两端字段名（参考现有 claudeMd/claude_md、
    specRoot/spec_root、rootPath/root_path 双写；daemon.ts:3347）。
    """
    for snake, camel in _PROFILE_PAYLOAD_FIELDS:
        if snake in lease_meta:
            value = lease_meta[snake]
            payload[snake] = value
            payload[camel] = value


async def build_claim_payload(session: AsyncSession, lease: DaemonTaskLease) -> dict:
    """Build execution context payload for a claimed lease.

    ``session`` 替代原 ``self._session``（task-06 结构迁移），其余逻辑逐字搬入。
    """
    lease_meta = dict(lease.metadata_ or {})
    payload: dict = {
        "lease_id": str(lease.id),
        "agent_run_id": None,
        "workspace_id": None,
        "session_id": None,
        "tool_config": {},
        # gap-5（补丁遗漏）：claim payload 必须带 lease.kind，否则 daemon
        # execPayload.kind 为 undefined → 走 batch task_runner（422）。
        "kind": lease.kind,
    }
    # gap-5：interactive lease agent_run_id=NULL（D-005），不走 agent_run 提取分支，
    # 从 lease metadata 取首 turn 参数（prepare_interactive_dispatch 写入），
    # 供 daemon _startInteractiveSession 构造 SessionManager.create 输入。
    if lease.kind == "interactive":
        payload["agent_session_id"] = lease_meta.get("session_id")
        # daemon execPayload.agentRunId 读 snake_case `agent_run_id`（不是 run_id），
        # 把 metadata.run_id 同时映射到 agent_run_id，否则 daemon has_run_id=false
        payload["agent_run_id"] = lease_meta.get("run_id")
        payload["run_id"] = lease_meta.get("run_id")
        payload["prompt"] = lease_meta.get("prompt")
        # ql-20260703-001：归一化 adapter id → daemon provider key（claude_code→claude），
        # 与 daemon normalizeProvider 双保险，避免 daemon _agentPaths.get 失败静默卡死。
        payload["provider"] = _normalize_lease_provider(lease_meta.get("provider"))
        payload["model"] = lease_meta.get("model")
        payload["root_path"] = lease_meta.get("cwd") or lease_meta.get("root_path")
        # task-06 / D-005@v1：interactive 路注入 provider_config（含解密 api_key）。
        # agent_kind_raw 用 lease_meta.provider（adapter id，如 claude_code）经归一化命中。
        # tar/shared 两分支下方各自 return，此处统一注入覆盖两路。未配则 absent（D-007）。
        await _inject_provider_config(
            session,
            lease,
            lease_meta,
            payload,
            agent_kind_raw=lease_meta.get("provider"),
        )
        # scan 真阻塞：透传 manual_approval / ask_user_only（prepare_scan_interactive_dispatch
        # 写入 lease metadata）→ daemon execPayload 归一化 → SessionManager.create input：
        #   - manual_approval 决定是否注入 canUseTool（per-session，chat=false 不注入）
        #   - ask_user_only=true 时只 AskUserQuestion 走人审、Bash 等放行让 scan 自动跑。
        # **修复 Bug**：原 interactive 分支漏传这两个字段 → askUserOnly=undefined → gate
        # 不触发 → 所有工具（含 sillyspec 的 Bash）都走人审 → 5min 超时死循环。
        if lease_meta.get("manual_approval") is not None:
            payload["manual_approval"] = lease_meta["manual_approval"]
        if lease_meta.get("ask_user_only") is not None:
            payload["ask_user_only"] = lease_meta["ask_user_only"]
        # task-09（team-main-agent-orchestration）：透传 lease metadata.stage。
        # 主 agent run stage='orchestrator' → daemon isMainAgentSession(ctx) 判定
        # → 注入 daemon 内置 MCP server 5 tool（dispatch_worker 等）。漏透传则
        # daemon execPayload.stage=undefined → ctx.stage=undefined → 不注入 MCP
        # → 主 agent 看不到 worker dispatch tool（e2e 2026-07-12 发现）。
        if lease_meta.get("stage") is not None:
            payload["stage"] = lease_meta["stage"]
        # task-07 / C-13：透传 profile 字段（mcp_refs/skill_refs/effective_allowed_roots/
        # profile_version，双写 camelCase+snake_case）。置于 transport 分支之前，让 tar /
        # shared 两路 return 都携带（system_prompt 不在此，走 task-06 claudeMd prepend）。
        # 无键（profile=None / 旧 lease）→ payload 不含，零回归。
        _apply_profile_passthrough(lease_meta, payload)
        # ===== task-03（2026-06-23-spec-transport-tar-sync）：transport 分支 =====
        # D-007@v1：scan/stage 走 interactive lease，tar 模式 spec 同步在 interactive 路径
        # （daemon _startInteractiveSession pull + onSessionEnd sync）。backend 侧开关点：
        #   - tar：不透传 spec_root（让 daemon pull 触发，D-003@v1）+ 透传 workspace_id
        #         （pull 需 wsId，design §13 X-004 gap）+ 透传 transport（daemon 读
        #         execPayload.transport === 'tar' 切分支，task-06）。
        #   - shared（默认，D-004@v1）：维持现状透传 spec_root/runtime_root，daemon 走
        #         translateSpecRoot，bind mount 共享，不 pull 不 sync（向后兼容）。
        # ws_id 解析上提（§4.3）：原代码在 spec_root 解析块内部解析 ws_id 仅用于 DB 回填，
        # 本任务上提到 transport 分支之前，让 tar/shared 两路共用同一份 ws_id（行为等价，
        # 同 lease_meta、同 UUID 逻辑；AC-10 现有 test_lease_service.py AC-02 守护）。
        # 来源：lease_meta.workspace_id（prepare_scan_interactive_dispatch 写入，
        # placement.py:494）。普通 prepare_interactive_dispatch（quick-chat）不写 →
        # ws_id=None → tar 模式也不透传 workspaceId（quick-chat 无 spec 同步语义，边界 E4）。
        ws_id_raw = lease_meta.get("workspace_id")
        ws_id: uuid.UUID | None = None
        if ws_id_raw:
            try:
                ws_id = uuid.UUID(ws_id_raw) if isinstance(ws_id_raw, str) else ws_id_raw
            except (ValueError, AttributeError, TypeError):
                ws_id = None

        # task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
        # 后 transport 永远走全局 settings.spec_transport（task-07 已删
        # transport_for_path_source + path_source per-workspace 锁定逻辑）。守护现有
        # test_lease_claim_transport C1-C5（不创建真实 Workspace 行，全走全局分支）。
        settings = get_settings()

        # task-10（2026-07-02-workspace-config-flow，D-010）：lease payload 统一带
        # latest_spec_version（服务器权威文档版本），供 daemon 保鲜比对——每次执行
        # agent/scan/init 任务前比对本地 .sillyspec-platform.json.spec_version，旧了
        # 触发 pullSpecBundle。值源 = SpecWorkspace.spec_version（task-09 落字段）。
        #
        # 向前兼容（task-09 未合前）：getattr(spec_ws, "spec_version", 0)——spec_ws 行
        # 此时无 spec_version 列 → 返回默认 0。task-09 合入加列后自动读真实值，本处零改动。
        # quick-chat（ws_id=None）/ 查不到 SpecWorkspace 行 → 默认 0（无 spec 同步语义，
        # daemon 不比对）。tar 与 shared 两分支共用同一查询，避免 shared 分支重复查 DB。
        latest_spec_version = 0
        _resolved_spec_ws: "object | None" = None
        if ws_id is not None:
            from app.modules.spec_workspace.model import SpecWorkspace

            _sv_stmt = select(SpecWorkspace).where(col(SpecWorkspace.workspace_id) == ws_id)
            _resolved_spec_ws = (await session.execute(_sv_stmt)).scalars().first()
            if _resolved_spec_ws is not None:
                latest_spec_version = int(getattr(_resolved_spec_ws, "spec_version", 0) or 0)
        # 双写（camelCase + snake_case），与 transport/specStrategy/workspaceId 惯例一致，
        # daemon execPayload 归一化两端字段名都覆盖。
        payload["latestSpecVersion"] = latest_spec_version
        payload["latest_spec_version"] = latest_spec_version

        # task-02（daemon-root-path-translation）：root_path container→host 改写，
        # 让 daemon 收到宿主机路径做 cwd（单一 daemon-client 下 resolve_root_path_for_daemon
        # 原样透传，task-03 已改单参）。
        if payload.get("root_path"):
            payload["root_path"] = resolve_root_path_for_daemon(payload["root_path"])
        # task-09：单一 daemon-client 后 transport 走全局 settings.spec_transport
        # （task-07 已删 transport_for_path_source per-workspace 锁定）。
        transport = settings.spec_transport
        # transport 双写（camelCase + snake_case），对齐 specRoot/spec_root、rootPath/root_path
        # 惯例；daemon execPayload 归一化两端字段名都覆盖（边界 E5）。
        payload["transport"] = transport
        payload["transportMode"] = transport

        if transport == "tar":
            # tar 模式：不透传 specRoot/spec_root/runtimeRoot/runtime_root（daemon pull 分支，
            # D-003@v1）。即便 lease_meta.spec_root 有值（placement.py:485 写入）也不透传——
            # backend 容器路径对 daemon 异机无意义，daemon 必须走 pull 拉本地缓存（边界 E6）。
            if ws_id is not None:
                payload["workspaceId"] = str(ws_id)  # daemon pullSpecBundle 需 wsId（task-06）
                payload["workspace_id"] = str(ws_id)  # snake_case 双写
            # spec 同步策略透传（2026-06-28-daemon-client-spec-sync-strategy，D-001）：
            # daemon pullSpecBundle 据此三分支初始化缓存。来源 lease_meta.spec_strategy
            # （placement.py prepare_scan_interactive_dispatch 写入）。双写 camelCase+snake_case，
            # 与 transport/workspaceId 惯例一致。未写（旧 lease/quick-chat）→ daemon 按默认
            # platform-managed 兼容。
            _spec_strategy = lease_meta.get("spec_strategy")
            if _spec_strategy:
                payload["specStrategy"] = _spec_strategy
                payload["spec_strategy"] = _spec_strategy
            # 不 set specRoot/spec_root → daemon execPayload.specRoot 为 undefined
            # → _startInteractiveSession 走 pullSpecBundle（D-003@v1）。
            return payload

        # ===== shared 模式（默认，D-004@v1 现状零改动）=====
        # task-03（2026-06-22-agent-run-pipeline-fix）：interactive 分支透传 spec_root
        # 给 daemon，与 prompt 内 SPEC_ROOT_MAP 翻译双保险——daemon 收到后：
        #   - 若 prompt 仍含容器 /data/ 路径（SPEC_ROOT_MAP 未配 / 翻译漏）→ 记 warn
        #     让用户检查配置（daemon 无宿主路径信息无法独立翻译，真翻译仍靠 SPEC_ROOT_MAP）。
        #   - 字段为可观测 + 未来扩展口（如 daemon RPC 问 backend 宿主路径）。
        # 来源优先级：lease_meta.spec_root > SpecWorkspace.spec_root（用 workspace_id 查 DB）。
        # 注意：普通 prepare_interactive_dispatch（quick-chat）不写 spec_root/workspace_id
        # 到 metadata，spec_root 保持 None → 不透传 → daemon 完全回退 prompt 翻译（向后兼容）。
        spec_root: str | None = lease_meta.get("spec_root")
        if not spec_root and ws_id is not None:
            # task-10：SpecWorkspace 行已在上方 version 解析块查过（_resolved_spec_ws），
            # 此处直接复用，不再重复查 DB（避免 shared 分支双查）。
            spec_ws = _resolved_spec_ws
            if spec_ws is not None:
                # SpecWorkspace.spec_root 是 nullable=False（model.py:59），必有值。
                spec_root = spec_ws.spec_root
        if spec_root:
            payload["specRoot"] = spec_root  # camelCase（daemon execPayload 消费）
            payload["spec_root"] = spec_root  # snake_case 双写（对齐 rootPath/root_path 模式）
            runtime_root = lease_meta.get("runtime_root")
            if runtime_root:
                payload["runtimeRoot"] = runtime_root
                payload["runtime_root"] = runtime_root
        return payload

    # init lease（kind=batch + mode='init'，task-07 / workspace-config-flow D-002/D-009）：
    # 不启 agent（无 agent_run_id），daemon 端 _runInitLease 读 payload 写
    # .sillyspec-platform.json + pull spec。从 lease metadata 构建最小 payload，跳过
    # batch agent_run_id 校验（init 无 AgentRun，否则 _raise_no_agent_run 422）。
    # task-09：root_path 经 resolve_root_path_for_daemon 单参改写（单一 daemon-client）。
    # daemon _runInitLease 读 workspaceId/rootPath(camelCase) + platform_config + latestSpecVersion。
    if lease_meta.get("mode") == "init":
        payload["mode"] = "init"
        _init_ws_raw = lease_meta.get("workspace_id")
        _init_ws: uuid.UUID | None = None
        if _init_ws_raw:
            try:
                _init_ws = (
                    uuid.UUID(_init_ws_raw) if isinstance(_init_ws_raw, str) else _init_ws_raw
                )
            except (ValueError, AttributeError, TypeError):
                _init_ws = None
        if _init_ws is not None:
            payload["workspace_id"] = str(_init_ws)
            payload["workspaceId"] = str(_init_ws)
        _init_root = lease_meta.get("root_path")
        if _init_root:
            _init_root = resolve_root_path_for_daemon(_init_root)
        if _init_root:
            payload["rootPath"] = _init_root  # daemon _runInitLease 读 ctx.rootPath
            payload["root_path"] = _init_root
        _init_pc = lease_meta.get("platform_config")
        if _init_pc is not None:
            payload["platform_config"] = _init_pc
            payload["platformConfig"] = _init_pc
        _init_sv = lease_meta.get("latest_spec_version")
        if _init_sv is not None:
            payload["latest_spec_version"] = _init_sv
            payload["latestSpecVersion"] = _init_sv
        return payload

    if lease.agent_run_id is None:
        # ql-004：batch lease（interactive 已在上方 return）agent_run_id 不应为
        # NULL。静默返回 agent_run_id=None 的 payload 会让 daemon 发空
        # agent_run_id → backend 422 风暴 → 连接池耗尽。fail-fast 抛错暴露。
        _raise_no_agent_run(lease)

    agent_run = await session.get(AgentRun, lease.agent_run_id)
    if agent_run is None:
        log.warning(
            "daemon_claim_agent_run_missing",
            lease_id=str(lease.id),
            agent_run_id=str(lease.agent_run_id),
        )
        return payload

    # Get workspace_id from M:N association
    ws_stmt = (
        select(AgentRunWorkspace.workspace_id)
        .where(
            col(AgentRunWorkspace.agent_run_id) == agent_run.id,
        )
        .limit(1)
    )
    # .scalar() 直接返回单列首值（无行→None），等价于 first()[0]，且避开 mypy 对 Row 的误报
    workspace_id = (await session.execute(ws_stmt)).scalar()

    payload["agent_run_id"] = str(agent_run.id)
    payload["workspace_id"] = str(workspace_id) if workspace_id else None
    payload["session_id"] = agent_run.session_id
    payload["agent_type"] = agent_run.agent_type
    if agent_run.provider:
        payload["provider"] = agent_run.provider
    if agent_run.model:
        payload["model"] = agent_run.model
    payload["change_id"] = str(agent_run.change_id) if agent_run.change_id else None
    payload["task_id"] = str(agent_run.task_id) if agent_run.task_id else None

    # Propagate prompt from lease metadata (quick-chat scenario)
    lease_meta = lease.metadata_ or {}
    if lease_meta.get("prompt"):
        payload["prompt"] = lease_meta["prompt"]
    # ql-20260618-009：AgentRun 是 source of truth（持久化快照），
    # lease_meta 仅在 AgentRun 字段为空时兜底（如旧测试场景）。
    # 不再用 lease_meta 覆盖 AgentRun 已固化的值——避免重 dispatch 时 transport
    # 与快照不一致导致 daemon 拿到错的 provider/model。
    if not agent_run.provider and lease_meta.get("provider"):
        payload["provider"] = lease_meta["provider"]
    if not agent_run.model and lease_meta.get("model"):
        payload["model"] = lease_meta["model"]
    if lease_meta.get("resume_session_id"):
        payload["resume_session_id"] = lease_meta["resume_session_id"]
    # Propagate bundle context fields from lease metadata (task-03 / Phase 2).
    if lease_meta.get("repo_url"):
        payload["repo_url"] = lease_meta["repo_url"]
    if lease_meta.get("branch"):
        payload["branch"] = lease_meta["branch"]
    if lease_meta.get("allowed_paths"):
        payload["allowed_paths"] = lease_meta["allowed_paths"]
    if lease_meta.get("tool_config"):
        payload["tool_config"] = lease_meta["tool_config"]  # 覆盖默认 {}
    if lease_meta.get("timeout_seconds") is not None:
        payload["timeout_seconds"] = lease_meta["timeout_seconds"]
    # ql-20260617-009：workspace 标识 + root_path 透传给 daemon（camelCase + snake_case 双写，
    # 对齐 daemon.ts:662-665 兜底链；root_path 用于 daemon 直接当 cwd，跳过 mirror）。
    if lease_meta.get("workspace_name"):
        payload["workspaceName"] = lease_meta["workspace_name"]
        payload["workspace_name"] = lease_meta["workspace_name"]
    if lease_meta.get("workspace_slug"):
        payload["workspaceSlug"] = lease_meta["workspace_slug"]
        payload["workspace_slug"] = lease_meta["workspace_slug"]
    # task-02（daemon-root-path-translation）：root_path container→host 改写。
    # task-09：单一 daemon-client 后 resolve_root_path_for_daemon 单参（原样透传），
    # 删 ws_path_source 读取（不再按 path_source 分流）。
    if lease_meta.get("root_path"):
        daemon_root_path = resolve_root_path_for_daemon(lease_meta["root_path"])
        payload["rootPath"] = daemon_root_path
        payload["root_path"] = daemon_root_path

    # task-10（2026-07-02-workspace-config-flow，D-010）：batch lease 同样带
    # latest_spec_version（agent 任务执行前 daemon 比对保鲜）。值源与 interactive 分支
    # 同 = SpecWorkspace.spec_version，向前兼容 getattr 默认 0（task-09 未合前）。
    # workspace_id=None（无 M:N 关联）→ 默认 0（无 spec 同步语义）。
    batch_latest_spec_version = 0
    if workspace_id:
        from app.modules.spec_workspace.model import SpecWorkspace

        _batch_sv_stmt = select(SpecWorkspace).where(
            col(SpecWorkspace.workspace_id) == workspace_id
        )
        _batch_spec_ws = (await session.execute(_batch_sv_stmt)).scalars().first()
        if _batch_spec_ws is not None:
            batch_latest_spec_version = int(getattr(_batch_spec_ws, "spec_version", 0) or 0)
    payload["latestSpecVersion"] = batch_latest_spec_version
    payload["latest_spec_version"] = batch_latest_spec_version

    # Include runtime capabilities (cmd_path, bin_path, protocol) from
    # daemon_instance (DaemonRuntime.capabilities removed in Wave 1, design §4.2).
    runtime = await session.get(DaemonRuntime, lease.runtime_id)
    if runtime is not None and runtime.daemon_instance_id is not None:
        instance = await session.get(DaemonInstance, runtime.daemon_instance_id)
        if instance is not None and instance.capabilities:
            caps = instance.capabilities if isinstance(instance.capabilities, dict) else {}
            payload["cmd_path"] = caps.get("bin_path", "")
            payload["protocol"] = caps.get("protocol", "")

    # task-06 / D-005@v1：batch 路同 interactive 注入 provider_config。
    # agent_kind_raw 用 agent_run.agent_type（adapter id，如 claude_code）经归一化命中。
    # init lease 在上方 mode=='init' 分支已 return（不启 agent，无需 provider_config）。
    await _inject_provider_config(
        session,
        lease,
        lease_meta,
        payload,
        agent_kind_raw=agent_run.agent_type,
    )
    # task-07 / C-13：batch 路同 interactive 透传 profile 字段（双写 camelCase+snake_case）。
    # lease_meta 在上方 :400 行重新绑定为 ``lease.metadata_ or {}``，与此处同一份数据；
    # 无键（profile=None / 旧 lease）→ payload 不含，零回归。
    _apply_profile_passthrough(lease_meta, payload)
    return payload
