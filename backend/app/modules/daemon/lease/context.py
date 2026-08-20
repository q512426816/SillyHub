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
from app.modules.agent.model import AgentMission, AgentRun
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


async def resolve_default_provider_config(
    session: AsyncSession,
    user_id: uuid.UUID,
    agent_kind: str,
) -> dict | None:
    """查用户默认 LlmProvider 并构造中性 provider_config(D-006 单一真相源)。

    change 2026-08-06-provider-switch-live-session / task-02 / FR-06 / D-005@v1。
    供 claim 路径(``_inject_provider_config``)与 set_default 即时下发(task-03/04)
    共用,避免两处各写一份「查默认 + 解密 + 构造」逻辑。

    查询口径(D-008 owner 级 + R-05 is_default 互斥):
    ``user_id AND agent_kind AND is_default=True``,三者对齐才命中。

    命中:经 ``get_cipher().decrypt`` 解密 api_key 明文,构造 9 字段中性 dict
    (8 核心字段 + settings_config 原样透传,task-04 D-009),返回给调用方自行
    决定如何注入 payload / WS push。未命中 → 返回 None,调用方按 D-007 不加
    provider_config 键(claim)或不推送(set_default)。

    R-02:明文 api_key 仅在返回 dict 内短暂存在,由调用方立即下发 daemon
    spawn-env 后丢弃;不写 ORM/审计/日志。
    """
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
        return None

    # task-10（change 2026-08-08-llm-provider-openai-format）：openai_chat 格式早返回分支。
    # openai 形态构造 6 字段 provider_config 指向 LiteLLM 网关（base_url + master key 作
    # auth token + model_name），**不解密 / 不下发上游 api_key**（D-003/NFR-01 安全增益：
    # 上游 key 只在 task-09 register 时注册进 LiteLLM，claim/WS 下发的 config 不含）。
    # litellm_model_name 复用 task-09 单一真相源 helper（usr-<uid>-<pid>），命名漂移会导致
    # LiteLLM 按 model_name 路由 404 → Claude Code 报错（R-03 跨任务契约）。
    if provider.api_format == "openai_chat":
        from app.modules.llm_provider.litellm_client import litellm_model_name

        settings = get_settings()
        return {
            "agent_kind": provider.agent_kind,
            "api_format": "openai_chat",
            # task-04（security-audit-remediation / Grill M-1 / D-003@v1）：master key
            # 不再下发明文（原 litellm_auth_token 字段删除）。改下发 litellm_proxy 标记 +
            # 代理地址（settings.hub_proxy_base_url 拼本端点路径）：daemon injector 据标记
            # 注 ANTHROPIC_BASE_URL=代理地址、ANTHROPIC_AUTH_TOKEN=daemon 自身 apiKey，
            # 子进程 Bearer 打 hub 代理，backend 校验归属后注入 master key 转发 LiteLLM。
            "litellm_proxy": True,
            "litellm_base_url": f"{settings.hub_proxy_base_url.rstrip('/')}/api/daemon/llm-proxy",
            "litellm_model_name": litellm_model_name(user_id, provider.id),
            "model": provider.model,
        }

    # anthropic 分支（现有 9 字段，逐字不变，NFR-02 零回归）。
    # 解密 api_key 明文(daemon spawn-env 注入 AUTH_TOKEN/AUTH_API_KEY 必需)
    api_key_plain = get_cipher().decrypt(provider.encrypted_api_key, provider.key_id)
    return {
        "agent_kind": provider.agent_kind,
        "base_url": provider.base_url,
        "api_key": api_key_plain,
        "auth_field": provider.auth_field,
        "model": provider.model,
        "model_role_mappings": provider.model_role_mappings,
        "default_fallback_model": provider.default_fallback_model,
        "extra_env": provider.extra_env,
        # task-04(D-009 / design §5.2):原样透传 settings_config,不解密/不加工/不判空。
        # None(含 task-01 brownfield 老行)照传 None,daemon 侧 ?.env ?? {} 链路判空。
        "settings_config": provider.settings_config,
    }


async def resolve_bound_provider_config(
    session: AsyncSession,
    lease_meta: dict,
    user_id: uuid.UUID,
    agent_kind: str,
) -> dict | None:
    """方案A：优先用档案绑定的 LlmProvider 构造 provider_config（D-003/D-006/D-007）。

    读 ``lease_meta["llm_provider_id"]``（由 ``AgentService._apply_profile_to_lease``
    写入），按 id 查 LlmProvider，校验：

    * **归属（方案A）**：``provider.user_id == user_id``（user_id 为 daemon 登记者
      ``runtime.user_id``）——仅当绑定 provider 属于当前执行用户时才生效，否则
      静默回退用户默认链，不泄露他人凭证。
    * **引擎一致**：``provider.agent_kind == agent_kind``——防止 codex 引擎档案
      绑了 claude provider 时下发错配凭证（堵 API/DB 直写绕过前端禁用）。

    通过则按 ``api_format`` 构造中性 config（anthropic 8 字段 / openai_chat 6 字段），
    口径与 :func:`resolve_default_provider_config` 逐字一致；未绑定 / 查不到 / 归属
    不符 / 引擎不符 → 返回 None，调用方回退用户默认（D-005，零回归）。

    注：构造逻辑复制自 resolve_default_provider_config 而非提取公共 helper，避免
    改动有测试守护的 resolve_default（回归风险）；两处口径保持一致，后续可重构提取。
    """
    raw = lease_meta.get("llm_provider_id")
    if not raw:
        return None
    try:
        provider_id = uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None

    from app.modules.llm_provider.model import LlmProvider

    provider = await session.get(LlmProvider, provider_id)
    if provider is None:
        return None
    if provider.user_id != user_id or provider.agent_kind != agent_kind:
        return None

    if provider.api_format == "openai_chat":
        from app.modules.llm_provider.litellm_client import litellm_model_name

        settings = get_settings()
        return {
            "agent_kind": provider.agent_kind,
            "api_format": "openai_chat",
            # task-04（Grill M-1 / D-003@v1）：与 resolve_default_provider_config
            # 同口径——litellm_auth_token 明文删除，改 litellm_proxy 标记 + hub 代理地址
            # （漏改此处即高危残留，design M-1 明确两个下发点）。
            "litellm_proxy": True,
            "litellm_base_url": f"{settings.hub_proxy_base_url.rstrip('/')}/api/daemon/llm-proxy",
            "litellm_model_name": litellm_model_name(provider.user_id, provider.id),
            "model": provider.model,
        }

    from app.core.crypto import get_cipher

    api_key_plain = get_cipher().decrypt(provider.encrypted_api_key, provider.key_id)
    return {
        "agent_kind": provider.agent_kind,
        "base_url": provider.base_url,
        "api_key": api_key_plain,
        "auth_field": provider.auth_field,
        "model": provider.model,
        "model_role_mappings": provider.model_role_mappings,
        "default_fallback_model": provider.default_fallback_model,
        "extra_env": provider.extra_env,
        "settings_config": provider.settings_config,
    }


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

    供应商优先级（task-04 sessions-portal / FR-04 / R-02，两级）：
      1. **会话级**：``lease_meta.session_llm_provider_id``（独立 key，与档案绑定
         ``llm_provider_id`` 严格区分）→ 按该 id 解析（校验属主 + agent_kind），
         解析异常降级走原链；
      2. 全局默认链：档案绑定（bound）→ 用户默认（default），现状不变。
    无 profile.model 派生分支（D-013）。

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

    # ── 会话级供应商（最高优先级，task-04 sessions-portal / FR-04 / R-02）──
    # lease_meta.session_llm_provider_id 由会话创建链路（design §5 Wave1 第 2 步）写入，
    # 是与档案绑定 key ``llm_provider_id`` **严格区分**的独立 key（R-02：不同 key 天然
    # 不冲突）。两级优先级：会话选择 > 全局默认（bound/default 链）——有会话供应商时
    # 直接用它，压制档案绑定（FR-04）；不引入 profile.model 派生分支（D-013）。
    # 解析复用 ``resolve_bound_provider_config``（按 id 查 + 校验属主与 agent_kind +
    # 按 api_format 构造，口径完全一致）；解析异常时降级走原链并留日志，不阻断会话创建。
    _session_pid_raw = lease_meta.get("session_llm_provider_id")
    if _session_pid_raw:
        try:
            session_config = await resolve_bound_provider_config(
                session, {"llm_provider_id": _session_pid_raw}, user_id, agent_kind
            )
        except Exception:
            log.warning(
                "daemon_claim_session_provider_resolve_failed",
                lease_id=str(lease.id),
                session_llm_provider_id=str(_session_pid_raw),
            )
            session_config = None  # 降级走原链（bound/default），不阻断会话创建
        if session_config is not None:
            payload["provider_config"] = session_config
            override_model = session_config.get("model") or session_config.get(
                "default_fallback_model"
            )
            if override_model:
                payload["model"] = override_model
            return
        # session_config 为 None（id 不存在 / 属主不符 / agent_kind 不符 / 格式无效）
        # → 静默降级走下方原链（与 bound 分支同款回退语义，不抛错）。

    # ── 优先用档案绑定的 provider（方案A，D-003/D-006/D-007）──
    # lease_meta.llm_provider_id 由 _apply_profile_to_lease 写入。bound helper 校验
    # 归属（仅 daemon 登记者本人绑定生效）+ agent_kind 一致，通过则用绑定 provider
    # 的 config；否则回退用户默认链。
    bound_config = await resolve_bound_provider_config(session, lease_meta, user_id, agent_kind)
    if bound_config is not None:
        payload["provider_config"] = bound_config
        override_model = bound_config.get("model") or bound_config.get("default_fallback_model")
        if override_model:
            payload["model"] = override_model
        return

    # ── 未绑定 / 归属不符 / agent_kind 不符 → 回退用户默认（D-005，零回归）──
    # change 2026-08-06-provider-switch-live-session / task-02：抽取
    # ``resolve_default_provider_config`` 供 claim 与 set_default 即时下发共用,
    # 避免两处各写一份查 provider + 解密 + 构造逻辑。helper 口径与原内联逻辑
    # 完全一致(owner 级 + agent_kind 对齐 + is_default=True,解密 api_key,
    # 9 字段中性 dict 含 settings_config 透传),对外行为零回归。
    provider_config = await resolve_default_provider_config(session, user_id, agent_kind)
    if provider_config is None:
        return  # D-007：用户未配默认 provider → absent

    payload["provider_config"] = provider_config
    # X-10：provider.model（design §9 优先）→ default_fallback_model 覆盖 payload[model]。
    # task-10：openai 形态 dict 只 6 键（无 default_fallback_model），用 .get() 兼容；
    # anthropic 形态两键都在，.get() 与原 [...] 逐字等价（NFR-02 零回归）。
    override_model = provider_config.get("model") or provider_config.get("default_fallback_model")
    if override_model:
        payload["model"] = override_model


# task-07 / C-13：claim payload 透传的 profile 字段（snake_case, camelCase）。
# 来源：task-06 ``AgentService._apply_profile_to_lease`` 写入 lease.metadata（service.py:720）。
# task-02（2026-08-13-profile-system-prompt-injection）：system_prompt 改走 lease.metadata
# 透传（废弃 D-012@v2 的 claudeMd prepend）→ daemon SessionManager SDK systemPrompt
# preset+append（design §5 / D-001）。
_PROFILE_PAYLOAD_FIELDS: tuple[tuple[str, str], ...] = (
    ("mcp_refs", "mcpRefs"),
    ("skill_refs", "skillRefs"),
    ("effective_allowed_roots", "effectiveAllowedRoots"),
    ("profile_version", "profileVersion"),
    ("system_prompt", "systemPrompt"),
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


async def _inject_mission_budget(
    session: AsyncSession,
    payload: dict,
    *,
    mission_id: uuid.UUID | None,
) -> None:
    """task-07 / FR-05 / D-005@v1 / D-009：下发 ``AgentMission.budget_tokens`` 到 claim payload。

    供 daemon 执行循环检查点使用（累计 input+output ≥ budget_tokens → 软切断，
    D-006）。budget 口径（D-009）= input_tokens + output_tokens，per AgentRun 归集
    （不含 cache_read/cache_creation）；daemon 侧累计器 + 检查点逻辑在 Wave 2 task-08
    实现，**本任务只下发数值，不算口径**。

    数据源：``AgentMission.budget_tokens``（agent/model.py:595，``int | None``，
    nullable=True）。mission run（``AgentRun.mission_id`` 非空）→ 加载 mission → 读
    字段；非 mission run（quick-chat / scan / init / 无 mission 的 batch）→ mission_id=None。

    **None 短路**（FR-07 / design §9 brownfield）：``mission_id`` 为 None 或
    ``mission.budget_tokens`` 为 None（用户未配置预算）→ payload **不加** ``budget_tokens``
    键，daemon 端 ``ctx.budget_tokens`` undefined → 检查点不触发（D-006 软切断保持关闭），
    现有 dispatch 行为零变化。逐键守护风格对齐 ``_apply_profile_passthrough``。

    双写（snake_case + camelCase）：对齐 daemon ``execPayload`` 归一化两端字段名惯例
    （参考 ``latestSpecVersion``/``latest_spec_version``、``profileVersion``/``profile_version``）。
    """
    if mission_id is None:
        return
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        return
    if mission.budget_tokens is not None:
        payload["budget_tokens"] = mission.budget_tokens
        payload["budgetTokens"] = mission.budget_tokens


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
    # 2026-08-06-public-mcp-server verify 修复（read_only 物制 / G3 / D-005@v2）：
    # tool_config override 必须在所有 kind 分支之前——原 override 在文件末（~line 521），
    # 但 kind=interactive 分支（下方 tar/shared 两路）提前 return，永远到不了末尾 override，
    # 致 interactive lease（=所有 worker，placement.py D-002@v3）claim payload 的 tool_config
    # 恒为默认 {} → daemon 拿不到 allowed_tools → read_only worker 实测 Write/Bash 全放行。
    # 提前到此处，interactive + batch 都能透传 lease metadata 的 tool_config（governance）。
    if lease_meta.get("tool_config"):
        payload["tool_config"] = lease_meta["tool_config"]
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
        # task-07 / FR-05 / D-005@v1 / D-009：interactive 路下发 AgentMission.budget_tokens
        # （lease_meta.run_id → AgentRun.mission_id → AgentMission.budget_tokens）。置于
        # transport 分支之前，让 tar / shared 两路 return 都携带。budget 口径（D-009）=
        # input+output per-run，daemon 侧累计 + 检查点在 task-08 实现。**None 短路**（§9）：
        # quick-chat / scan / 无 mission 的 interactive run → mission_id=None → 不加键，
        # daemon ctx.budget_tokens undefined → 检查点不触发，零回归。
        _bt_run_raw = lease_meta.get("run_id")
        _bt_run_uuid: uuid.UUID | None = None
        if _bt_run_raw:
            try:
                _bt_run_uuid = (
                    uuid.UUID(_bt_run_raw) if isinstance(_bt_run_raw, str) else _bt_run_raw
                )
            except (ValueError, AttributeError, TypeError):
                _bt_run_uuid = None
        _bt_mission_id: uuid.UUID | None = None
        if _bt_run_uuid is not None:
            _bt_mission_id = (
                await session.execute(
                    select(AgentRun.mission_id).where(AgentRun.id == _bt_run_uuid)
                )
            ).scalar()
        await _inject_mission_budget(session, payload, mission_id=_bt_mission_id)
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
        # agent/scan/init 任务前比对本地 daemon 状态文件
        # resolveSpecDir(ws)/.runtime/spec-version.json.spec_version（D-001@v1 迁移，旧名
        # .sillyspec-platform.json 已退役），旧了触发 pullSpecBundle。值源 = SpecWorkspace.spec_version（task-09 落字段）。
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
    # 不启 agent（无 agent_run_id），daemon 端 _runInitLease 读 payload 写 daemon 状态文件
    # （.runtime/spec-version.json，D-001@v1）+ pull spec + spawn sillyspec init。从 lease
    # metadata 构建最小 payload，跳过
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
        # task-04（2026-08-12-init-provision-local-yaml）/ P0 B1 / design §5.3.1 / §7.2 / §9：
        # claim 时现算签发 shpsync_ + shmcp_ 明文，注入 payload.platform_config.local_yaml。
        # **P0 关键：明文绝不落 lease.metadata_**（daemon_task_leases.metadata_ 是持久化
        # JSON 列且被 audit/service.py:74 读取）——明文只活在本函数局部变量 → payload dict
        # → HTTP 响应体，daemon 写入用户本地 local.yaml 后即落盘到本机（design §9）。
        # actor_user_id / ws_id 缺失或非法 → 防御降级（不签 token、不注入 local_yaml，不抛 500）。
        _init_actor_raw = lease_meta.get("actor_user_id")
        _init_actor: uuid.UUID | None = None
        if _init_actor_raw:
            try:
                _init_actor = (
                    uuid.UUID(_init_actor_raw)
                    if isinstance(_init_actor_raw, str)
                    else _init_actor_raw
                )
            except (ValueError, AttributeError, TypeError):
                _init_actor = None
        if _init_ws is not None and _init_actor is not None:
            from app.modules.mcp_gateway.service import McpTokenService
            from app.modules.platform_sync.token_service import PlatformSyncTokenService

            _init_settings = get_settings()
            # 两 service 构造器必传 settings（design §7.1）；get_or_issue 返回 (row, 明文)，
            # 只取明文，row 丢弃（DB 只存 sha256，明文不可恢复——design §5.2 D-001）。
            _, _shpsync_plain = await PlatformSyncTokenService(
                session, settings=_init_settings
            ).get_or_issue(workspace_id=_init_ws, created_by=_init_actor)
            _, _shmcp_plain = await McpTokenService(session, settings=_init_settings).get_or_issue(
                workspace_id=_init_ws, created_by=_init_actor
            )
            # _init_pc 透传后 platform_config/platformConfig 已双写指向同一 dict；未透传 /
            # 非 dict 时补建空 dict（防御 malformed lease）。local_yaml 只含两 token，
            # url 由 daemon _serverOrigin() 拼，后端不下发（D-002 / design §5.4）。
            #
            # **P0 别名断开（task-10 xfail 上浮的缺口）**：payload["platform_config"] 在
            # 上方 :601 由 `_init_pc = lease_meta.get("platform_config")` 引用赋值得来，
            # 而 lease_meta 是 `dict(lease.metadata_ or {})` 的浅拷贝——嵌套 platform_config
            # dict 与 lease.metadata_["platform_config"] 共享同一对象。若直接在其上加
            # local_yaml 会原地 mutate，污染内存 lease.metadata_（违背 §9 "明文绝不落
            # lease.metadata_" 内存口径）。此处**新建 dict**（浅拷贝 server_origin/strategy
            # 顶层键）断开引用，local_yaml 写到独立 dict，DB 持久化行本就干净（JSON 列无
            # MutableDict 跟踪不 flush），现内存口径也守住。
            _init_pc_src = payload.get("platform_config")
            _init_pc_dict: dict = {**_init_pc_src} if isinstance(_init_pc_src, dict) else {}
            payload["platform_config"] = _init_pc_dict
            payload["platformConfig"] = _init_pc_dict
            _init_pc_dict["local_yaml"] = {
                "platform_token": _shpsync_plain,
                "mcp_token": _shmcp_plain,
            }
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
    # task-07 / FR-05 / D-005@v1 / D-009：batch 路下发 AgentMission.budget_tokens（来自
    # 已加载的 ``agent_run.mission_id`` → AgentMission.budget_tokens）。budget 口径（D-009）
    # = input+output per-run，daemon 侧累计 + 检查点在 task-08 实现。**None 短路**（§9）：
    # 非 mission 的 batch run（mission_id=None）或未配置预算 → 不加键，零回归。
    await _inject_mission_budget(session, payload, mission_id=agent_run.mission_id)
    return payload
