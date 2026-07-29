"""task-06 单测：close_interactive_run 接收并存储模型错误详情（FR-02 / D-009）。

钉死三层透传链路（router → facade → run_sync）写入 ``AgentRun.error_detail``：
- 传 error（daemon classifyModelError 回传）→ error_detail 填充 ModelError 序列化
  + run 转 failed（daemon 契约 error 总伴随 is_error=true，design §7.5）。
- 不传 error（旧 daemon / 成功 run）→ error_detail 保持 None，不崩（design §9 兼容）。
- D-009 正交：error_code（调度层/系统错误，status 映射设置）与 error_detail（模型层
  ModelError）共存不互覆 —— 传 error 时 error_code 仍按 status 映射保留。

参照 test_close_interactive_run_session_status.py 的 _seed_session_and_run +
DaemonService facade + mocked_redis 范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.model_error import ModelErrorDTO, ModelErrorType
from app.modules.daemon.router import InteractiveRunResultRequest
from app.modules.daemon.service import DaemonService

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task06-{uid}@example.com",
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
    # close_interactive_run 的 get_redis 从 run_sync.service 取；_publish_session_event
    # 从 session.service 取。patch 两处指向同一 mock（对齐 lifecycle_patch 范式）。
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
    """构造 quick-chat session + lease + running run，返回 (lease_id, run_id, token, session_id)。

    change_id=None 跳过 stage 回写，聚焦 error_detail 写入本身。
    """
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


def _sample_error() -> ModelErrorDTO:
    """构造一个典型的模型层错误（auth_failed）。"""
    return ModelErrorDTO(
        type=ModelErrorType.AUTH_FAILED,
        code="401",
        message="API 凭证无效或已失效",
        retryable=False,
        hint="请检查并更新该供应商的 API Key",
        raw="API Error: 401 invalid api key",
    )


# ── 传 error → error_detail 填充 + run failed ──────────────────────────────


@pytest.mark.asyncio
async def test_close_with_error_writes_error_detail_and_marks_failed(
    db_session: AsyncSession, mocked_redis
) -> None:
    """传 error（is_error=true，对齐 design §7.5 契约）→ error_detail 填充 ModelError
    序列化值，run 转 failed。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_during_execution",
        is_error=True,
        error=_sample_error(),
    )
    assert run.status == "failed"
    assert run.error_detail is not None
    # model_dump(mode='json') → StrEnum 转成原生字符串，JSON 列原样存读。
    assert run.error_detail["type"] == "auth_failed"
    assert run.error_detail["code"] == "401"
    assert run.error_detail["message"] == "API 凭证无效或已失效"
    assert run.error_detail["retryable"] is False
    assert run.error_detail["hint"] == "请检查并更新该供应商的 API Key"
    assert run.error_detail["raw"] == "API Error: 401 invalid api key"

    # 重读 run 规避 identity map 缓存，确认真正落库。
    refreshed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_detail is not None
    assert refreshed.error_detail["type"] == "auth_failed"


# ── D-009 正交：error_code 与 error_detail 共存不互覆 ───────────────────────


@pytest.mark.asyncio
async def test_error_detail_orthogonal_to_error_code(
    db_session: AsyncSession, mocked_redis
) -> None:
    """D-009：error_code（调度层/系统错误，status 映射设置）与 error_detail（模型层
    ModelError）正交。传 error 时 error_code 仍按 status 映射保留，两者共存。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    # status=error_during_execution → error_code='interactive_interrupted'；同时传
    # 模型层 error → error_detail 填充。两条互不覆盖。
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_during_execution",
        is_error=True,
        error=_sample_error(),
    )
    assert run.status == "failed"
    # error_code 由 status 映射保留（未被 error_detail 写入触碰）。
    assert run.error_code == "interactive_interrupted"
    # error_detail 同时存在（正交共存，D-009）。
    assert run.error_detail is not None
    assert run.error_detail["type"] == "auth_failed"


@pytest.mark.asyncio
async def test_error_detail_orthogonal_other_is_error_branch(
    db_session: AsyncSession, mocked_redis
) -> None:
    """另一条 failed 分支（非 error_during_execution 的 is_error）→ error_code
    ='interactive_failed'，error_detail 同样共存。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_max_turns",
        is_error=True,
        error=ModelErrorDTO(
            type=ModelErrorType.QUOTA_EXCEEDED,
            code="429",
            message="额度已耗尽",
            retryable=False,
        ),
    )
    assert run.status == "failed"
    assert run.error_code == "interactive_failed"
    assert run.error_detail is not None
    assert run.error_detail["type"] == "quota_exceeded"
    assert run.error_detail["retryable"] is False


# ── 不传 error → error_detail=None 不崩（兼容）──────────────────────────────


@pytest.mark.asyncio
async def test_close_without_error_keeps_error_detail_none(
    db_session: AsyncSession, mocked_redis
) -> None:
    """旧 daemon / 成功 run 不传 error → error_detail 保持 None，不崩（design §9）。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    # 失败但不传 error（旧 daemon）：error_detail 仍 None，error_code 照常设置。
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="error_during_execution",
        is_error=True,
    )
    assert run.status == "failed"
    assert run.error_code == "interactive_interrupted"
    assert run.error_detail is None


@pytest.mark.asyncio
async def test_close_success_without_error_no_error_detail(
    db_session: AsyncSession, mocked_redis
) -> None:
    """成功 run（is_error=false，不传 error）→ completed，error_detail/error_code 均 None。"""
    lease_id, run_id, token, _ = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
    )
    assert run.status == "completed"
    assert run.error_detail is None
    assert run.error_code is None


# ── router 契约：InteractiveRunResultRequest.error 可选 ──────────────────────


def test_request_model_error_field_optional() -> None:
    """InteractiveRunResultRequest.error 可选：不传默认 None（旧 daemon 兼容）。"""
    req = InteractiveRunResultRequest(status="success", is_error=False)
    assert req.error is None


def test_request_model_error_field_parsed() -> None:
    """传 error dict → pydantic 解析成 ModelErrorDTO（daemon 上行契约对齐）。"""
    req = InteractiveRunResultRequest(
        status="error_during_execution",
        is_error=True,
        error={
            "type": "quota_exceeded",
            "code": "429",
            "message": "额度耗尽",
            "retryable": False,
            "hint": "请充值或更换供应商",
            "raw": "API Error: 429",
        },
    )
    assert isinstance(req.error, ModelErrorDTO)
    assert req.error.type is ModelErrorType.QUOTA_EXCEEDED
    assert req.error.retryable is False
