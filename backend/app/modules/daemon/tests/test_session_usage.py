"""GET /sessions/{id}/usage 端点级测试（2026-08-29-session-usage-stats task-02 / design §测试与验收）。

锁定 ``GET /api/daemon/sessions/{session_id}/usage`` 的聚合三态、空会话与归属语义：

* ① 纯明细：多 run 多模型——跨 run 同模型 SUM 合并、不同模型分组、
  ``by_model`` 按 input+output 降序；
* ② 纯兜底：无明细行 run 的四维 token 列并入（NULL 列 COALESCE 0、
  ``ctx_tokens`` 快照列不参与求和）、兜底桶 ``api_requests=0``、「未记录」桶
  恒排 ``by_model`` 末位（即使 input+output 总量最大）；
* ③ 混合：明细 run + 无明细 run 并存且 ``run.model`` 与明细模型同名——
  同名桶相加不丢、有明细 run 的 run 级列不重复计入；
* ④ 空会话：200，``totals`` 五指标全 0、``by_model`` 空；
* ⑤ 归属：他人会话 404 / 随机 id 404（同码 resource-hiding，不泄露存在性）/
  缺鉴权头 401。

种子构造对齐 test_permission_http_uplink 的 ORM 直插先例（_seed_user /
_admin_uid），fixture 用既有 conftest 的 client / db_session / auth_headers。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunModelUsage, AgentSession

# ── Fixtures / seed helpers ──────────────────────────────────────────────────


async def _seed_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"session-usage-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _admin_uid(db_session: AsyncSession) -> uuid.UUID:
    """auth_headers 背后的平台管理员 id（正向用例的会话归属主体）。

    对齐 test_permission_http_uplink 的 _admin_uid 先例。
    """
    from app.modules.auth.model import User

    user = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .one()
    )
    return user.id


async def _seed_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
) -> AgentSession:
    """最小会话行（usage 聚合只锚 user_id，无需 runtime/lease）。"""
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
        turn_count=0,
        created_at=now,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def _seed_run(
    db_session: AsyncSession,
    *,
    agent_session_id: uuid.UUID,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    ctx_tokens: int | None = None,
) -> AgentRun:
    """run 行（构造字段对齐 _seed_full_session / test_runtime_usage_by_provider 先例）。

    四维 token 列保持 nullable 语义：None = 老 run 未落列（兜底段 COALESCE 0）；
    ``ctx_tokens`` 是提示词大小快照列，置大值验证它不混入任何求和。
    """
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        spec_strategy="interactive",
        agent_session_id=agent_session_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        ctx_tokens=ctx_tokens,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


async def _seed_usage(
    db_session: AsyncSession,
    *,
    run_id: uuid.UUID,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
    api_requests: int = 1,
) -> AgentRunModelUsage:
    """agent_run_model_usage 明细行（UNIQUE(run_id, model)，同 run 同模型一行）。"""
    usage = AgentRunModelUsage(
        id=uuid.uuid4(),
        run_id=run_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        api_requests=api_requests,
    )
    db_session.add(usage)
    await db_session.commit()
    return usage


def _bucket(body: dict, model: str) -> dict:
    """by_model 按模型名取桶（存在性由调用方断言顺序保证）。"""
    return next(item for item in body["by_model"] if item["model"] == model)


# ── Tests ────────────────────────────────────────────────────────────────────


class TestSessionUsageEndpoint:
    """GET /sessions/{session_id}/usage（task-02 / FR-01 / FR-04 / D-004@v1）。"""

    @pytest.mark.asyncio
    async def test_pure_detail_aggregation(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """① 纯明细：3 run × 2 模型，跨 run 同模型 SUM、不同模型分组、降序排序。

        种子手算：
        - claude-sonnet-4-5（run1+run2 同名合并）：input=1000+400=1400，
          output=200+600=800，cache_read=5000+1500=6500，
          cache_creation=300+100=400，api_requests=3+2=5 → input+output=2200；
        - gpt-5-mini（run3）：input=3000，output=100，cache_read=0，
          cache_creation=0，api_requests=1 → input+output=3100；
        - by_model 降序：gpt-5-mini(3100) 在前，claude-sonnet-4-5(2200) 在后；
        - totals：input=4400，output=900，cache_read=6500，cache_creation=400，
          api_requests=6。
        """
        uid = await _admin_uid(db_session)
        sess = await _seed_session(db_session, user_id=uid)

        run1 = await _seed_run(db_session, agent_session_id=sess.id, model="claude-sonnet-4-5")
        run2 = await _seed_run(db_session, agent_session_id=sess.id, model="claude-sonnet-4-5")
        run3 = await _seed_run(db_session, agent_session_id=sess.id, model="gpt-5-mini")
        await _seed_usage(
            db_session,
            run_id=run1.id,
            model="claude-sonnet-4-5",
            input_tokens=1000,
            output_tokens=200,
            cache_read_tokens=5000,
            cache_creation_tokens=300,
            api_requests=3,
        )
        await _seed_usage(
            db_session,
            run_id=run2.id,
            model="claude-sonnet-4-5",
            input_tokens=400,
            output_tokens=600,
            cache_read_tokens=1500,
            cache_creation_tokens=100,
            api_requests=2,
        )
        await _seed_usage(
            db_session,
            run_id=run3.id,
            model="gpt-5-mini",
            input_tokens=3000,
            output_tokens=100,
            api_requests=1,
        )

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        # by_model 两个分组，排序 input+output 降序（3100 > 2200）。
        assert [item["model"] for item in body["by_model"]] == ["gpt-5-mini", "claude-sonnet-4-5"]
        gpt = _bucket(body, "gpt-5-mini")
        assert gpt == {
            "model": "gpt-5-mini",
            "input_tokens": 3000,
            "output_tokens": 100,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 1,
        }
        claude = _bucket(body, "claude-sonnet-4-5")
        assert claude == {
            "model": "claude-sonnet-4-5",
            "input_tokens": 1400,
            "output_tokens": 800,
            "cache_read_tokens": 6500,
            "cache_creation_tokens": 400,
            "api_requests": 5,
        }

        # totals = 两桶之和。
        assert body["totals"] == {
            "model": "totals",
            "input_tokens": 4400,
            "output_tokens": 900,
            "cache_read_tokens": 6500,
            "cache_creation_tokens": 400,
            "api_requests": 6,
        }

    @pytest.mark.asyncio
    async def test_pure_fallback_aggregation(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """② 纯兜底：2 run 无明细行，四维列并入、NULL 列 0、api_requests=0、「未记录」末位。

        种子手算：
        - run4（model=claude-opus-4）：input=100，output=50，cache_read=1000，
          cache_creation=200，ctx_tokens=99999（快照列，不得混入任何维度）；
        - run5（model=NULL → 「未记录」桶）：input=200，output=80，
          cache_read/cache_creation=NULL → COALESCE 0，ctx_tokens=7777；
        - 「未记录」桶 input+output=280 > claude-opus-4 的 150，仍恒排末位；
        - 兜底桶 api_requests 无来源恒 0；
        - totals：input=300，output=130，cache_read=1000，cache_creation=200，
          api_requests=0。
        """
        uid = await _admin_uid(db_session)
        sess = await _seed_session(db_session, user_id=uid)

        await _seed_run(
            db_session,
            agent_session_id=sess.id,
            model="claude-opus-4",
            input_tokens=100,
            output_tokens=50,
            cache_read_tokens=1000,
            cache_creation_tokens=200,
            ctx_tokens=99999,
        )
        await _seed_run(
            db_session,
            agent_session_id=sess.id,
            model=None,
            input_tokens=200,
            output_tokens=80,
            cache_read_tokens=None,
            cache_creation_tokens=None,
            ctx_tokens=7777,
        )

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        # 「未记录」总量更大仍恒排末位（排序规则：unrecorded 标志位优先于降序）。
        assert [item["model"] for item in body["by_model"]] == ["claude-opus-4", "未记录"]
        assert _bucket(body, "claude-opus-4") == {
            "model": "claude-opus-4",
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_read_tokens": 1000,
            "cache_creation_tokens": 200,
            "api_requests": 0,
        }
        assert _bucket(body, "未记录") == {
            "model": "未记录",
            "input_tokens": 200,
            "output_tokens": 80,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 0,
        }

        # totals 不含 ctx_tokens（若混入 input/cache_read 会突破手算值）。
        assert body["totals"] == {
            "model": "totals",
            "input_tokens": 300,
            "output_tokens": 130,
            "cache_read_tokens": 1000,
            "cache_creation_tokens": 200,
            "api_requests": 0,
        }

    @pytest.mark.asyncio
    async def test_mixed_detail_and_fallback_merge(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """③ 混合：明细 run + 无明细 run 同名模型 → 同名桶相加不丢、totals=两段之和。

        种子手算：
        - run6（有明细行）：明细 claude-sonnet-4-5 input=500，output=250，
          cache_read=100，cache_creation=50，api_requests=2；run6 自身四维列
          置 9999 诱饵值——有明细行的 run 走明细段，run 级列不得再并入；
        - run7（无明细行，model 同名 claude-sonnet-4-5）：input=700，output=350，
          cache_read=200，cache_creation=80；
        - 同名桶合并：input=1200，output=600，cache_read=300，cache_creation=130，
          api_requests=2+0=2；
        - totals=桶之和（input=1200，output=600，cache_read=300，
          cache_creation=130，api_requests=2）。
        """
        uid = await _admin_uid(db_session)
        sess = await _seed_session(db_session, user_id=uid)

        run6 = await _seed_run(
            db_session,
            agent_session_id=sess.id,
            model="claude-sonnet-4-5",
            input_tokens=9999,
            output_tokens=9999,
            cache_read_tokens=9999,
            cache_creation_tokens=9999,
        )
        await _seed_run(
            db_session,
            agent_session_id=sess.id,
            model="claude-sonnet-4-5",
            input_tokens=700,
            output_tokens=350,
            cache_read_tokens=200,
            cache_creation_tokens=80,
        )
        await _seed_usage(
            db_session,
            run_id=run6.id,
            model="claude-sonnet-4-5",
            input_tokens=500,
            output_tokens=250,
            cache_read_tokens=100,
            cache_creation_tokens=50,
            api_requests=2,
        )

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert [item["model"] for item in body["by_model"]] == ["claude-sonnet-4-5"]
        assert _bucket(body, "claude-sonnet-4-5") == {
            "model": "claude-sonnet-4-5",
            "input_tokens": 1200,
            "output_tokens": 600,
            "cache_read_tokens": 300,
            "cache_creation_tokens": 130,
            "api_requests": 2,
        }
        assert body["totals"] == {
            "model": "totals",
            "input_tokens": 1200,
            "output_tokens": 600,
            "cache_read_tokens": 300,
            "cache_creation_tokens": 130,
            "api_requests": 2,
        }

    @pytest.mark.asyncio
    async def test_empty_session_all_zero(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """④ 空会话：200，totals 五指标全 0、by_model 空。"""
        uid = await _admin_uid(db_session)
        sess = await _seed_session(db_session, user_id=uid)

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert body["by_model"] == []
        assert body["totals"] == {
            "model": "totals",
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 0,
        }

    @pytest.mark.asyncio
    async def test_cross_user_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """⑤ 他人会话 → 404（与不存在同码，不泄露存在性）。"""
        other = await _seed_user(db_session)
        sess = await _seed_session(db_session, user_id=other)

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/usage", headers=auth_headers)
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_unknown_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """随机 id → 404（resource-hiding 同码）。"""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/usage", headers=auth_headers)
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_no_auth_401(
        self,
        client: AsyncClient,
    ) -> None:
        """缺鉴权头 → 401。"""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/usage")
        assert resp.status_code == 401
