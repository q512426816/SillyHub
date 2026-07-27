"""task-07 / FR-03：``build_claim_payload`` 注入 provider_config 单测。

覆盖 task-06 四路契约：
  1. 用户配了默认 provider → payload.provider_config 全 8 字段 + api_key 明文（interactive+batch 两路）；
  2. 用户未配（或非默认）→ provider_config absent（D-007 零回归）；
  3. agent_type=claude_code（adapter id）经 ``_normalize_lease_provider`` 命中 agent_kind=claude provider（X-08）；
  4. R-02：provider_config 明文 api_key 不落 AuditLog（build_claim_payload 只读不写 ORM，
     解密后明文仅在返回 dict；audit_hooks 只读 ORM 列，明文不入 ORM 故捕获不到）。

夹具范式参考 ``test_complete_lease_stage_writeback.py``（SQLite+aiosqlite + 直接构造 ORM 行）。
不真实调 daemon（不启进程 / 不发 WS），纯 backend 函数级 + DB 夹具。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.llm_provider.model import (
    LlmProvider,  # 注册到 BaseModel.metadata 让 db_engine 建表
)
from app.modules.llm_provider.schema import LlmProviderCreate
from app.modules.llm_provider.service import LlmProviderService
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# task-06 provides 契约的 8 字段（严格集合匹配，防字段漂移）。
_PROVIDER_CONFIG_FIELDS: frozenset[str] = frozenset(
    {
        "agent_kind",
        "base_url",
        "api_key",
        "auth_field",
        "model",
        "model_role_mappings",
        "default_fallback_model",
        "extra_env",
        # settings_config：llm_provider 变更 task-04 / D-009，context.py 原样透传（不解密/不加工）
        "settings_config",
    }
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(session: AsyncSession, *, suffix: str) -> uuid.UUID:
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"pc-{suffix}@example.com",
        password_hash="x",
        display_name="pc-test",
        status="active",
    )
    session.add(user)
    await session.commit()
    return user.id


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"pc-ws-{uuid.uuid4().hex[:6]}",
        slug=f"pc-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/pc-test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="pc-runtime",
        provider="claude",
        status="online",
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_default_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    plaintext: str,
    base_url: str | None = "https://api.anthropic.example",
    model: str | None = None,
    default_fallback_model: str | None = None,
    model_role_mappings: dict | None = None,
    extra_env: dict | None = None,
    auth_field: str = "ANTHROPIC_AUTH_TOKEN",
    is_default: bool = True,
) -> LlmProvider:
    """复用 task-03 ``LlmProviderService.create``：内部 cipher.encrypt 后赋 encrypted_api_key，
    明文永不入 ORM（R-04）。``agent_kind`` 走 schema Literal 默认 "claude"。"""
    data = LlmProviderCreate(
        name=f"pc-prov-{uuid.uuid4().hex[:6]}",
        agent_kind="claude",
        base_url=base_url,
        api_key=plaintext,
        model=model,
        default_fallback_model=default_fallback_model,
        model_role_mappings=model_role_mappings,
        extra_env=extra_env,
        auth_field=auth_field,  # type: ignore[arg-type]
        is_default=is_default,
    )
    return await LlmProviderService(session).create(user_id, data)


async def _make_interactive_lease(
    session: AsyncSession,
    runtime: DaemonRuntime,
    *,
    provider: str = "claude_code",
    prompt: str = "hi",
    model: str | None = None,
) -> DaemonTaskLease:
    meta: dict = {
        "session_id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "prompt": prompt,
        "provider": provider,
        "claim_token": "test-claim-token",
    }
    if model is not None:
        meta["model"] = model
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        agent_run_id=None,
        kind="interactive",
        status="claimed",
        metadata_=meta,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


async def _make_batch_run(
    session: AsyncSession,
    *,
    agent_type: str = "claude_code",
    model: str | None = None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type=agent_type,
        provider="claude_code",
        model=model,
        status="running",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_batch_lease(
    session: AsyncSession,
    runtime: DaemonRuntime,
    run: AgentRun,
) -> DaemonTaskLease:
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        agent_run_id=run.id,
        kind="batch",
        status="claimed",
        metadata_={"claim_token": "test-claim-token"},
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


# ---------------------------------------------------------------------------
# 用例 1：有默认 provider → payload.provider_config 全字段 + 明文 api_key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_interactive_payload_has_provider_config(db_session: AsyncSession) -> None:
    """用例1a：interactive lease + 默认 provider → provider_config 全 8 字段 + api_key 明文。"""
    user_id = await _create_user(db_session, suffix="interactive")
    runtime = await _create_runtime(db_session, user_id)
    plaintext = "sk-interactive-plaintext-aaaaaaaa"
    await _create_default_provider(
        db_session,
        user_id,
        plaintext=plaintext,
        base_url="https://api.interactive.example",
        model="claude-sonnet-4",
        default_fallback_model="kimi-k2",
        model_role_mappings={"sonnet": {"model": "kimi-k2", "one_m": False}},
        extra_env={"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"},
    )
    lease = await _make_interactive_lease(db_session, runtime, provider="claude_code")

    payload = await build_claim_payload(db_session, lease)

    assert "provider_config" in payload
    pc = payload["provider_config"]
    assert set(pc.keys()) == _PROVIDER_CONFIG_FIELDS
    assert pc["agent_kind"] == "claude"
    assert pc["base_url"] == "https://api.interactive.example"
    assert pc["api_key"] == plaintext  # 明文（cipher.decrypt 解出）
    assert pc["auth_field"] == "ANTHROPIC_AUTH_TOKEN"
    assert pc["model"] == "claude-sonnet-4"
    assert pc["default_fallback_model"] == "kimi-k2"
    assert pc["model_role_mappings"] == {"sonnet": {"model": "kimi-k2", "one_m": False}}
    assert pc["extra_env"] == {"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
    # X-10：provider.model 覆盖 payload[model]（原 lease_meta 无 model → None 被覆盖）
    assert payload["model"] == "claude-sonnet-4"


@pytest.mark.asyncio
async def test_batch_payload_has_provider_config(db_session: AsyncSession) -> None:
    """用例1b：batch lease + 默认 provider → provider_config 全字段 + 明文 api_key。"""
    user_id = await _create_user(db_session, suffix="batch")
    runtime = await _create_runtime(db_session, user_id)
    plaintext = "sk-batch-plaintext-bbbbbbbb"
    await _create_default_provider(
        db_session,
        user_id,
        plaintext=plaintext,
        model="claude-opus-4",
    )
    ws = await _create_workspace(db_session)
    run = await _make_batch_run(db_session, agent_type="claude_code", model="claude-3-opus")
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    lease = await _make_batch_lease(db_session, runtime, run)

    payload = await build_claim_payload(db_session, lease)

    assert "provider_config" in payload
    pc = payload["provider_config"]
    assert set(pc.keys()) == _PROVIDER_CONFIG_FIELDS
    assert pc["api_key"] == plaintext
    assert pc["agent_kind"] == "claude"
    # X-10：provider.model 覆盖 agent_run.model（claude-3-opus → claude-opus-4）
    assert payload["model"] == "claude-opus-4"


# ---------------------------------------------------------------------------
# 用例 2：未配 / 非默认 → provider_config absent（D-007 零回归）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provider_config_absent_when_user_has_no_provider(db_session: AsyncSession) -> None:
    """用例2a：用户未配任何 provider → provider_config 不在 payload，payload[model] 维持原值。"""
    user_id = await _create_user(db_session, suffix="no-prov")
    runtime = await _create_runtime(db_session, user_id)
    lease = await _make_interactive_lease(
        db_session, runtime, provider="claude_code", model="claude-sonnet-4"
    )

    payload = await build_claim_payload(db_session, lease)

    assert "provider_config" not in payload
    assert payload["model"] == "claude-sonnet-4"  # 维持 lease_meta 来源


@pytest.mark.asyncio
async def test_provider_config_absent_when_provider_not_default(db_session: AsyncSession) -> None:
    """用例2b：用户配了 provider 但 is_default=False → 仍 absent（只下发默认）。"""
    user_id = await _create_user(db_session, suffix="non-default")
    runtime = await _create_runtime(db_session, user_id)
    await _create_default_provider(
        db_session,
        user_id,
        plaintext="sk-nodef-plaintext-cccccccc",
        is_default=False,
    )
    lease = await _make_interactive_lease(db_session, runtime, provider="claude_code")

    payload = await build_claim_payload(db_session, lease)

    assert "provider_config" not in payload


# ---------------------------------------------------------------------------
# 用例 3：claude_code 归一化命中 agent_kind=claude provider（X-08）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_claude_code_agent_type_normalized_to_claude(db_session: AsyncSession) -> None:
    """用例3 / X-08：adapter id claude_code 经 _normalize_lease_provider → agent_kind=claude 命中。

    batch 路（agent_run.agent_type='claude_code'）+ interactive 路（lease_meta.provider
    ='claude_code'）双验证归一化复用同一函数（context.py:44）。
    """
    user_id = await _create_user(db_session, suffix="norm")
    runtime = await _create_runtime(db_session, user_id)
    plaintext = "sk-norm-plaintext-dddddddd"
    # provider 存的是 agent_kind='claude'（不是 'claude_code'）
    await _create_default_provider(db_session, user_id, plaintext=plaintext)

    # interactive：lease_meta.provider='claude_code'
    interactive_lease = await _make_interactive_lease(db_session, runtime, provider="claude_code")
    interactive_payload = await build_claim_payload(db_session, interactive_lease)
    assert "provider_config" in interactive_payload
    assert interactive_payload["provider_config"]["agent_kind"] == "claude"
    assert interactive_payload["provider_config"]["api_key"] == plaintext

    # batch：agent_run.agent_type='claude_code'
    ws = await _create_workspace(db_session)
    run = await _make_batch_run(db_session, agent_type="claude_code")
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    batch_lease = await _make_batch_lease(db_session, runtime, run)
    batch_payload = await build_claim_payload(db_session, batch_lease)
    assert "provider_config" in batch_payload
    assert batch_payload["provider_config"]["agent_kind"] == "claude"
    assert batch_payload["provider_config"]["api_key"] == plaintext


# ---------------------------------------------------------------------------
# 用例 4：R-02 审计脱敏——provider_config 明文 api_key 不入 AuditLog
# ---------------------------------------------------------------------------

# Mapper 级 audit 事件全局注册一次（engine 参数仅 API 兼容，见 test_audit_hooks.py:119）。
_AUDIT_HOOKS_REGISTERED = False


def _maybe_register_audit_hooks() -> None:
    global _AUDIT_HOOKS_REGISTERED
    if _AUDIT_HOOKS_REGISTERED:
        return
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.audit_hooks import register_audit_hooks

    register_audit_hooks(create_async_engine("sqlite+aiosqlite:///:memory:", future=True))
    _AUDIT_HOOKS_REGISTERED = True


@pytest.mark.asyncio
async def test_provider_config_not_leaked_to_audit_log(db_session: AsyncSession) -> None:
    """用例4 / R-02：provider_config（含明文 api_key）不入 AuditLog。

    断言：
      1. build_claim_payload 只读不写 ORM → 调用前后 AuditLog 行数不变；
      2. 即便 audit_context 注入并已触发 provider insert 审计（audit_hooks 只读 ORM 列），
         AuditLog.details_json 也只含 encrypted_api_key 密文 repr，无明文 api_key、
         无 provider_config 结构（R-04 钩子捕获不到明文，R-02 lease 不回传）。
    """
    _maybe_register_audit_hooks()
    from app.modules.workflow.model import AuditLog

    user_id = await _create_user(db_session, suffix="audit")
    runtime = await _create_runtime(db_session, user_id)
    plaintext = "sk-audit-plaintext-eeeeeeee1234567890"

    count_before = len((await db_session.execute(select(AuditLog))).scalars().all())

    # 注入 audit_context + 创建 provider → 触发 llm_provider.insert 审计行（证明 audit 在工作）
    db_session.info["audit_context"] = {"actor_id": user_id, "workspace_id": None}
    try:
        await _create_default_provider(db_session, user_id, plaintext=plaintext)
    finally:
        db_session.info.pop("audit_context", None)

    count_after_create = len((await db_session.execute(select(AuditLog))).scalars().all())
    # provider insert 至少落 1 条审计（证明 audit_hooks 真生效，下面的"无明文"断言不空洞）
    assert count_after_create >= count_before + 1

    lease = await _make_interactive_lease(db_session, runtime, provider="claude_code")
    payload = await build_claim_payload(db_session, lease)

    # payload 确实拿到了明文（R-02 是"不下发到审计/日志"，不是"不下发到 daemon"）
    assert payload["provider_config"]["api_key"] == plaintext

    # build_claim_payload 只读 → 不新增 AuditLog 行
    count_after_claim = len((await db_session.execute(select(AuditLog))).scalars().all())
    assert count_after_claim == count_after_create

    # 所有 AuditLog.details_json 不得含明文 api_key / provider_config 结构
    rows = (await db_session.execute(select(AuditLog))).scalars().all()
    for row in rows:
        blob = row.details_json or ""
        assert plaintext not in blob, "明文 api_key 泄漏到 AuditLog.details_json（违反 R-02）"
        assert "provider_config" not in blob, "provider_config 结构泄漏到 AuditLog（违反 R-02）"
