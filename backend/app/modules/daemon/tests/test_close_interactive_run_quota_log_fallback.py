"""2026-10-24-close-run-quota-fallback 单测：旧 daemon 失败轮错误详情日志兜底。

FR-01：close_interactive_run 收到 is_error=true 且 error=None 时，从该 run 已落
库日志的 [ASSISTANT] 行提取 API Error 文本，命中限额特征（429 + 上限/额度/配额
/quota/usage limit 等）时补写 error_detail（type=quota_exceeded，语义与 daemon
model-error/classifier 对齐）——实证 run 0278895b（2026-10-23 OpenCode Go 限额
轮，daemon 旧版未回传 error，前端只见「运行失败 · unknown」）。

FR-02：daemon 已回传 error 时不覆盖。
FR-03：无 API Error 行 / 非限额（如 401）不伪造，error_detail 保持 NULL、既有
兜底文案照旧。

参照 test_close_interactive_run_model_error.py 的 _seed_session_and_run +
DaemonService facade + mocked_redis 范式；日志行按 run 0278895b 实测文本构造。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.model_error import ModelErrorDTO, ModelErrorType
from app.modules.daemon.service import DaemonService

# 2026-10-23 run 0278895b 实证日志文本（GLM 1308 限额，含重置时刻）。
QUOTA_LOG_LINE = (
    "[ASSISTANT] API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。"
    "您的限额将在 2026-10-23 13:27:04 重置。][20261023112014df4b539296144375]"
)


# ── Fixtures（对齐 test_close_interactive_run_model_error.py）────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"quota-fallback-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_session_and_run(
    db_session: AsyncSession,
    *,
    run_status: str = "running",
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy="quick-chat",
        agent_session_id=session_id,
        change_id=None,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id


async def _seed_log_line(
    db_session: AsyncSession,
    run_id: uuid.UUID,
    content: str,
) -> None:
    """种一条 stdout 日志行（对齐 daemon 落库形态：channel='stdout'）。"""
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            timestamp=datetime.now(UTC),
            channel="stdout",
            content_redacted=content,
        )
    )
    await db_session.commit()


# ── FR-01：限额错误日志兜底补写 ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_quota_error_log_inferred_into_error_detail(
    db_session: AsyncSession, mocked_redis
) -> None:
    """run 0278895b 实证形态：日志留有 429/1308 限额文本、daemon 未回传 error
    → 收口时兜底补写 error_detail（type=quota_exceeded + code + reset_at + raw）。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    await _seed_log_line(db_session, run_id, QUOTA_LOG_LINE)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_max_turns",
        is_error=True,
        error=None,
        result_summary=None,
    )
    assert run.status == "failed"
    assert run.error_code == "interactive_failed"
    assert run.error_detail is not None
    assert run.error_detail["type"] == "quota_exceeded"
    assert run.error_detail["code"] == "1308"
    assert run.error_detail["message"] == "额度或配额已耗尽"
    assert run.error_detail["retryable"] is False
    assert run.error_detail["hint"] == "额度耗尽，需充值或切换供应商"
    assert QUOTA_LOG_LINE in run.error_detail["raw"]
    # daemon extractResetAt 同款解析：GLM 中文重置时刻 → +08:00 ISO-8601。
    assert run.error_detail["reset_at"] == "2026-10-23T13:27:04+08:00"

    refreshed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.error_detail is not None
    assert refreshed.error_detail["type"] == "quota_exceeded"


@pytest.mark.asyncio
async def test_quota_error_via_result_summary_inferred(
    db_session: AsyncSession, mocked_redis
) -> None:
    """无日志行时 result_summary 携带限额文本同样兜底；重置时刻解析失败 → None。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_max_turns",
        is_error=True,
        error=None,
        result_summary="API Error: Request rejected (429) · weekly usage limit reached",
    )
    assert run.status == "failed"
    assert run.error_detail is not None
    assert run.error_detail["type"] == "quota_exceeded"
    assert run.error_detail["code"] is None
    assert run.error_detail["reset_at"] is None
    assert "weekly usage limit reached" in run.error_detail["raw"]


# ── FR-02：daemon 已回传 error 不覆盖 ────────────────────────────────────────


@pytest.mark.asyncio
async def test_daemon_error_takes_precedence_over_log_inference(
    db_session: AsyncSession, mocked_redis
) -> None:
    """daemon 已回传 error（auth_failed）+ 日志含限额文本 → error_detail 保持
    daemon 回传值（禁止被日志推断的 quota_exceeded 覆盖，FR-02）。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    await _seed_log_line(db_session, run_id, QUOTA_LOG_LINE)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_during_execution",
        is_error=True,
        error=ModelErrorDTO(
            type=ModelErrorType.AUTH_FAILED,
            code="401",
            message="API 凭证无效或已失效",
            retryable=False,
            hint="请检查并更新该供应商的 API Key",
        ),
    )
    assert run.status == "failed"
    assert run.error_detail is not None
    assert run.error_detail["type"] == "auth_failed"
    assert run.error_detail["code"] == "401"


# ── FR-03：非限额 / 无日志行为不变 ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_quota_api_error_not_inferred(db_session: AsyncSession, mocked_redis) -> None:
    """日志含 API Error 但非限额（401，无 429）→ 不伪造 error_detail，既有
    兜底文案照旧（FR-03）。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    await _seed_log_line(db_session, run_id, "[ASSISTANT] API Error: 401 invalid api key")
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_max_turns",
        is_error=True,
        error=None,
        result_summary=None,
    )
    assert run.status == "failed"
    assert run.error_code == "interactive_failed"
    assert run.error_detail is None
    assert "未回传" in (run.output_redacted or "")


@pytest.mark.asyncio
async def test_no_api_error_log_keeps_legacy_behavior(
    db_session: AsyncSession, mocked_redis
) -> None:
    """无任何含 API Error 的日志行、result_summary=None → error_detail 保持
    NULL，error_code 与 output_redacted 兜底文案逐字不变（FR-03 / 兼容既有
    test_close_without_error_keeps_error_detail_none 断言）。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_max_turns",
        is_error=True,
        error=None,
        result_summary=None,
    )
    assert run.status == "failed"
    assert run.error_code == "interactive_failed"
    assert run.error_detail is None
    assert run.output_redacted == "本轮执行失败（执行端未回传详细原因）"
