# tests: task-13（2026-08-29-usage-by-provider-model）全链路串联自测。
#
# 跨层拼装验证（design 验收口径 1/2 的 backend 半边 + 统计口径）：
#   create_session（预会话级联带 model）→ close_interactive_run（真实形态
#   model_usage[]，含子代理模型）→ agent_run_model_usage 明细四维 == run 四维
#   → get_runtimes_usage by_provider 分组正确。
# daemon 侧半边（真实 SDK result → payload 拆行/计数）由
# daemon-interactive-bridge 真实用例承载（task-06），本文件只钉 backend 拼装。

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.schema import ModelUsageItemRead
from app.modules.daemon.service import DaemonService
from app.modules.daemon.tests.test_run_sync_model_usage import (
    _create_runtime,
    _create_user,
    _mock_redis,
)


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


@pytest.fixture()
def mocked_hub():
    """复用 create_config 的 ws hub mock（create_session 唤醒 daemon 走它）。"""
    from app.modules.daemon.tests.test_session_create_config import _mock_hub

    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


async def _seed_provider(db_session: AsyncSession, uid: uuid.UUID) -> uuid.UUID:
    from app.core.crypto import get_cipher
    from app.modules.llm_provider.model import LlmProvider

    cipher = get_cipher()
    ct, key_id = cipher.encrypt("sk-e2e")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=uid,
        name="智谱 GLM(实测)",
        agent_kind="claude",
        encrypted_api_key=ct,
        key_id=key_id,
        model="glm-4.7",
        api_format="anthropic",
        is_default=False,
    )
    db_session.add(row)
    await db_session.commit()
    return row.id


@pytest.mark.asyncio
async def test_e2e_create_close_and_by_provider_statistics(
    db_session: AsyncSession, mocked_hub, mocked_redis
) -> None:
    """端到端串联：预会话带模型创建 → 终态明细落库 → 统计分组。"""
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    provider_id = await _seed_provider(db_session, uid)

    # ── 1. 预会话级联首句创建（带供应商 + 模型）──
    created = await DaemonService(db_session).create_session(
        uid,
        provider=None,
        prompt="用子代理算 17*23",
        runtime_id=str(rt.id),
        llm_provider_id=str(provider_id),
        model="glm-4.6",
    )
    sess = created.agent_session
    assert sess.llm_provider_id == provider_id
    # D-002@v1：快照 model 显式优先（供应商原配 glm-4.7 不遮蔽）。
    assert (sess.config_snapshot or {}).get("model") == "glm-4.6"

    # ── 2. 终态 close（真实形态 payload：主模型 + 子代理模型两行）──
    # seed 沿用 task-05 已验证能被统计命中的构造方式（session.runtime_id 钉定
    # + run 双挂 agent_session_id），created_at 显式 now(UTC) 对齐其口径。
    from app.modules.agent.model import AgentRun
    from app.modules.daemon.model import DaemonTaskLease
    from app.modules.daemon.tests.test_runtime_usage_by_provider import (
        _create_session,
    )

    sess2 = await _create_session(db_session, user_id=uid, runtime_id=rt.id)
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="quick-chat",
            agent_session_id=sess2.id,
            llm_provider_id=provider_id,
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    # close 需要 lease + claim token：为该 run 建一个 interactive lease 并绑 session。
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        status="claimed",
        kind="interactive",
        claimed_at=datetime.now(UTC),
        lease_expires_at=None,
        metadata_={"claim_token": "e2e-tok", "session_id": str(sess2.id)},
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(lease)
    sess2.lease_id = lease.id
    await db_session.commit()
    lease_id, claim_token = lease.id, "e2e-tok"
    model_usage = [
        # 主循环 + 主模型（参考真实 GLM 子代理任务实测形态：主 49273 含大头）
        ModelUsageItemRead(
            model="glm-4.6",
            input_tokens=49273,
            output_tokens=264,
            cache_read_tokens=38784,
            cache_creation_tokens=0,
            api_requests=8,
        ),
        ModelUsageItemRead(
            model="glm-4.5-air",
            input_tokens=5726,
            output_tokens=482,
            cache_read_tokens=17888,
            cache_creation_tokens=0,
            api_requests=2,
        ),
    ]
    await DaemonService(db_session).close_interactive_run(
        lease_id,
        run_id,
        claim_token,
        status="success",
        is_error=False,
        input_tokens=54999,
        output_tokens=746,
        cache_read_tokens=56672,
        cache_creation_tokens=0,
        model_usage=model_usage,
        api_requests=10,
    )

    # ── 3. 验收口径 1：明细四维总和 == run 四维；分摊 requests 守恒 ──
    from sqlalchemy import select

    from app.modules.agent.model import AgentRun, AgentRunModelUsage

    rows = (
        (
            await db_session.execute(
                select(AgentRunModelUsage).where(AgentRunModelUsage.run_id == run_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2
    assert sum(r.input_tokens for r in rows) == 54999
    assert sum(r.output_tokens for r in rows) == 746
    assert sum(r.cache_read_tokens for r in rows) == 56672
    assert sum(r.api_requests for r in rows) == 10
    run = await db_session.get(AgentRun, run_id)
    assert run is not None
    assert run.model == "glm-4.6"  # 最大消耗行
    assert run.llm_provider_id == provider_id

    # ── 4. 验收口径 3：by_provider 分组（同一 runtime 桶）──
    # 窗口取 7d（对齐 task-05 测试）：SQLite 方言下 created_at 丢 tz 存 naive UTC，
    # 1d 窗 since=本地 0 点（UTC+8）在凌晨时段会误滤 UTC 时刻行（_since_param
    # 的已知时区语义，生产 PG 为 timestamptz 原生比较无此问题）。
    from app.modules.daemon.runtime.service import RuntimeService

    usage_svc = RuntimeService(db_session)
    result = await usage_svc.get_runtimes_usage("7d")
    # SQLite 测试库 rid 字符串化丢连字符（PG 无此形态差），归一化后比较。
    hit = [u for u in result if u.runtime_id.replace("-", "") == str(rt.id).replace("-", "")]
    assert hit, "runtime 未出现在统计结果"
    by_provider = hit[0].by_provider
    target = [p for p in by_provider if p.provider_id == provider_id and p.model == "glm-4.6"]
    assert target, f"glm-4.6 分组缺失：{[p.model for p in by_provider]}"
    assert target[0].input_tokens == 49273
    assert target[0].api_requests == 8
    assert target[0].provider_name == "智谱 GLM(实测)"
