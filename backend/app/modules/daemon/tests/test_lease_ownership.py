"""task-03（security-audit-remediation）：claim / pending-leases / heartbeat 归属校验。

锁定 D-001@v1 owner-only 约定（跨用户与不存在同语义 404，沿 287eed60 sessions
端点先例）在 daemon lease 生命周期三个端点上的行为：

* 他人 claim 本人 runtime 的 lease → 404（不泄露存在性）；
* 他人 GET pending-leases → 404；
* 他人 heartbeat（daemon_local_id 归属不匹配）→ 404；
* 本人三条路径行为回归不变（pending 流转 / 列表 / 心跳刷新）；
* interactive 预派发 lease（runtime_id NULL）按 metadata.actor_user_id 锚点
  （task-08 补写）校验，锚点缺失（存量脏行）统一 404 拒绝（step-14 QA M-2）；
* claim_token 校验错误值 403（compare_digest 改造后行为不变，无时序捷径）。

测试走 HTTP 面（root ``client`` fixture + 手签 JWT），归属漏洞的修复面在
router → service 传参链，服务层直调的既有测试见 test_lease_service /
test_register_heartbeat_daemon（actor_user_id 可选，不破坏）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease

# llm_providers 表：claim payload 的 _inject_provider_config 查该表（conftest
# 已 import 模型建表，此处 import 仅为镜像 test_lease_service 惯例显式声明依赖）。
from app.modules.llm_provider.model import LlmProvider  # noqa: F401

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user_with_token(db_session: AsyncSession, *, name: str) -> tuple[User, str]:
    """插入普通用户并手签 15min JWT（get_current_principal Bearer 路径）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token

    user = User(
        id=uuid.uuid4(),
        email=f"lease-owner-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    settings = get_settings()
    token, _payload = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=settings,
    )
    return user, token


async def _seed_runtime(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str = "owner-host",
    provider: str = "claude_code",
) -> tuple[DaemonInstance, DaemonRuntime]:
    """创建 instance + 挂其下的单 runtime（镜像 _legacy_register_runtime）。"""
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=user_id,
        name=hostname,
        provider=provider,
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    await db_session.refresh(rt)
    return instance, rt


async def _seed_batch_lease(
    db_session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    status: str = "pending",
) -> DaemonTaskLease:
    """创建挂 AgentRun 的 pending batch lease（build_claim_payload 需要 run 行）。"""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="pending",
        spec_strategy="oneshot",
    )
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run.id,
        kind="batch",
        status=status,
        lease_expires_at=None,
        metadata_={},
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([run, lease])
    await db_session.commit()
    await db_session.refresh(lease)
    return lease


async def _seed_interactive_lease_no_runtime(
    db_session: AsyncSession,
    *,
    actor_user_id: uuid.UUID | None,
) -> DaemonTaskLease:
    """创建 runtime_id=NULL 的 interactive lease（legacy 预派发形态）。

    actor_user_id 非空时写入 metadata 锚点（task-08 补写口径）；None 模拟
    无锚点的存量行（claim 一律 404 拒绝，step-14 QA M-2）。
    """
    now = datetime.now(UTC)
    metadata: dict = {
        "session_id": str(uuid.uuid4()),
        "run_id": str(uuid.uuid4()),
        "prompt": "hello",
        "provider": "claude_code",
        "claim_token": uuid.uuid4().hex + uuid.uuid4().hex,
    }
    if actor_user_id is not None:
        metadata["actor_user_id"] = str(actor_user_id)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=None,
        agent_run_id=None,
        kind="interactive",
        status="pending",
        lease_expires_at=None,
        metadata_=metadata,
        created_at=now,
        updated_at=now,
    )
    db_session.add(lease)
    await db_session.commit()
    await db_session.refresh(lease)
    return lease


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── POST /api/daemon/leases/{lease_id}/claim ────────────────────────────────


class TestClaimLeaseOwnership:
    """claim 归属校验（D-001@v1 owner-only 404）。"""

    @pytest.mark.asyncio
    async def test_non_owner_claim_returns_404(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """他人 runtime 上的 pending lease 被另一用户 claim → 404（同不存在语义）。"""
        owner, owner_token = await _create_user_with_token(db_session, name="owner")
        _intruder, intruder_token = await _create_user_with_token(db_session, name="intruder")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_batch_lease(db_session, rt.id)

        resp = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(rt.id)},
            headers=_headers(intruder_token),
        )
        assert resp.status_code == 404, resp.text
        # 响应不回显 runtime/owner 信息（不泄露存在性）
        assert str(rt.id) not in resp.text
        _ = owner_token  # owner 本人在下方回归用例验证

    @pytest.mark.asyncio
    async def test_owner_claim_succeeds(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """本人回归：owner claim 自己 runtime 的 lease → 200 + claim_token 下发。"""
        owner, owner_token = await _create_user_with_token(db_session, name="owner2")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_batch_lease(db_session, rt.id)

        resp = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(rt.id)},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["lease_id"] == str(lease.id)
        assert len(body["claim_token"]) == 64  # secrets.token_hex(32)

    @pytest.mark.asyncio
    async def test_null_runtime_lease_with_matching_metadata_actor_succeeds(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """runtime_id NULL 的 interactive lease：metadata.actor_user_id 与本人一致 → 200。"""
        owner, owner_token = await _create_user_with_token(db_session, name="owner3")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_interactive_lease_no_runtime(db_session, actor_user_id=owner.id)

        resp = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(rt.id)},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_null_runtime_lease_with_mismatched_metadata_actor_404(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """runtime_id NULL + metadata.actor_user_id 是他人 → 404（锚点校验）。"""
        owner, _owner_token = await _create_user_with_token(db_session, name="owner4")
        _intruder, intruder_token = await _create_user_with_token(db_session, name="intruder4")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_interactive_lease_no_runtime(db_session, actor_user_id=owner.id)

        resp = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(rt.id)},
            headers=_headers(intruder_token),
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_null_runtime_lease_without_anchor_rejected_404(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """runtime_id NULL 且无锚点（存量脏行）→ 统一 404 拒绝（step-14 QA M-2）。

        原 fallback 校验 body runtime_id 归属——任何用户对自己的 runtime 恒通过，
        等于无锚点脏行可被任意本人凭据 claim。收紧后不问 body 归属一律 404
        （D-001 owner-only：与不存在同语义）。存量无锚行未上线可重置
        （CLAUDE.md 规则 11），合法路径不受影响（task-08 已补写锚点）。
        """
        owner, owner_token = await _create_user_with_token(db_session, name="owner5")
        intruder, _intruder_token = await _create_user_with_token(db_session, name="intruder5")
        _inst, owner_rt = await _seed_runtime(db_session, owner.id, hostname="o5")
        _inst2, intruder_rt = await _seed_runtime(db_session, intruder.id, hostname="i5")

        lease = await _seed_interactive_lease_no_runtime(db_session, actor_user_id=None)

        # 本人 runtime 也拒（无锚点行不可信，不因 body 归属放行）
        resp_owner = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(owner_rt.id)},
            headers=_headers(owner_token),
        )
        assert resp_owner.status_code == 404, resp_owner.text

        lease2 = await _seed_interactive_lease_no_runtime(db_session, actor_user_id=None)
        resp_intruder = await client.post(
            f"/api/daemon/leases/{lease2.id}/claim",
            json={"runtime_id": str(intruder_rt.id)},
            headers=_headers(owner_token),  # owner 拿别人 runtime claim
        )
        assert resp_intruder.status_code == 404, resp_intruder.text


# ── GET /api/daemon/runtimes/{runtime_id}/pending-leases ────────────────────


class TestPendingLeasesOwnership:
    """pending-leases 归属校验。"""

    @pytest.mark.asyncio
    async def test_non_owner_pending_leases_returns_404(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """他人 runtime 的 pending-leases → 404（同不存在语义，不回 lease 列表）。"""
        owner, _owner_token = await _create_user_with_token(db_session, name="owner6")
        _intruder, intruder_token = await _create_user_with_token(db_session, name="intruder6")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        await _seed_batch_lease(db_session, rt.id)

        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-leases",
            headers=_headers(intruder_token),
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_owner_pending_leases_returns_list(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """本人回归：owner 查询 → 200 + pending lease 在列表中。"""
        owner, owner_token = await _create_user_with_token(db_session, name="owner7")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_batch_lease(db_session, rt.id)

        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-leases",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body, list)
        assert any(item["lease_id"] == str(lease.id) for item in body)

    @pytest.mark.asyncio
    async def test_pending_leases_excludes_reopen_lease(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """ql-20260823-007：reopen 租约（metadata 带 reopened_from_status）不进轮询列表。

        reopen 租约只经 daemon:session_resume WS 消费；混进 pending-leases 会被
        daemon 轮询兜底认领，随后因无 prompt/run_id 走 interactive_missing_fields
        裸退，租约永挂 claimed（2026-08-23 bdec91a4 事故排查发现）。
        """
        owner, owner_token = await _create_user_with_token(db_session, name="owner10")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        normal = await _seed_batch_lease(db_session, rt.id)
        now = datetime.now(UTC)
        reopen_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            kind="interactive",
            status="pending",
            lease_expires_at=None,
            metadata_={
                "reopened_from_status": "failed",
                "session_id": str(uuid.uuid4()),
                "provider": "claude",
            },
            created_at=now,
            updated_at=now,
        )
        db_session.add(reopen_lease)
        await db_session.commit()

        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-leases",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        ids = [item["lease_id"] for item in resp.json()]
        assert str(normal.id) in ids
        assert str(reopen_lease.id) not in ids

    @pytest.mark.asyncio
    async def test_pending_leases_unknown_runtime_returns_404(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """runtime 不存在 → 404（与无权同语义）。"""
        _owner, owner_token = await _create_user_with_token(db_session, name="owner8")

        resp = await client.get(
            f"/api/daemon/runtimes/{uuid.uuid4()}/pending-leases",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 404, resp.text


# ── POST /api/daemon/heartbeat ──────────────────────────────────────────────


class TestHeartbeatOwnership:
    """per-daemon heartbeat 归属校验（daemon_local_id 归属 user 比对）。"""

    @pytest.mark.asyncio
    async def test_non_owner_heartbeat_returns_404(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """他人 daemon_local_id 心跳 → 404（同不存在语义，不刷新 last_heartbeat_at）。"""
        owner, _owner_token = await _create_user_with_token(db_session, name="owner9")
        _intruder, intruder_token = await _create_user_with_token(db_session, name="intruder9")
        inst, _rt = await _seed_runtime(db_session, owner.id)

        resp = await client.post(
            "/api/daemon/heartbeat",
            json={"daemon_local_id": str(inst.id), "providers": []},
            headers=_headers(intruder_token),
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_owner_heartbeat_succeeds(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """本人回归：owner 心跳 → 200 + last_heartbeat_at 刷新。"""
        owner, owner_token = await _create_user_with_token(db_session, name="owner10")
        inst, _rt = await _seed_runtime(db_session, owner.id)
        inst.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=120)
        db_session.add(inst)
        await db_session.commit()
        old_hb = inst.last_heartbeat_at

        resp = await client.post(
            "/api/daemon/heartbeat",
            json={"daemon_local_id": str(inst.id), "providers": []},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["daemon_instance_id"] == str(inst.id)
        assert body["status"] == "online"

        # 请求走独立 session（conftest _override_session）；用列查询直读库
        # （绕过本测试 session 的 identity map），确认请求事务已落新值。
        from sqlalchemy import select as sa_select

        new_hb = (
            await db_session.execute(
                sa_select(DaemonInstance.last_heartbeat_at).where(DaemonInstance.id == inst.id)
            )
        ).scalar_one()
        assert new_hb is not None
        if new_hb.tzinfo is None:
            new_hb = new_hb.replace(tzinfo=UTC)
        assert new_hb > old_hb


# ── claim_token 校验（compare_digest 行为等价性） ────────────────────────────


class TestClaimTokenVerification:
    """task-03：claim_token 比较改 secrets.compare_digest 后行为不变。"""

    @pytest.mark.asyncio
    async def test_lease_heartbeat_wrong_token_403_right_token_200(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """错误 token 403 / 正确 token 200（常量时间比较不改变可见行为）。"""
        owner, owner_token = await _create_user_with_token(db_session, name="owner11")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_batch_lease(db_session, rt.id)

        claim = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(rt.id)},
            headers=_headers(owner_token),
        )
        assert claim.status_code == 200, claim.text
        good_token = claim.json()["claim_token"]

        wrong = await client.post(
            f"/api/daemon/leases/{lease.id}/heartbeat",
            json={"claim_token": "0" * 64},
            headers=_headers(owner_token),
        )
        assert wrong.status_code == 403, wrong.text

        right = await client.post(
            f"/api/daemon/leases/{lease.id}/heartbeat",
            json={"claim_token": good_token},
            headers=_headers(owner_token),
        )
        assert right.status_code == 200, right.text

    @pytest.mark.asyncio
    async def test_non_str_stored_token_rejected(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """metadata 存的 token 非 str（脏数据）→ 403，不抛 TypeError 500。

        compare_digest 对 str/bytes 混合会抛 TypeError，实现须先 isinstance 收窄。
        """
        owner, owner_token = await _create_user_with_token(db_session, name="owner12")
        _inst, rt = await _seed_runtime(db_session, owner.id)
        lease = await _seed_batch_lease(db_session, rt.id)

        claim = await client.post(
            f"/api/daemon/leases/{lease.id}/claim",
            json={"runtime_id": str(rt.id)},
            headers=_headers(owner_token),
        )
        assert claim.status_code == 200, claim.text

        # 脏数据：把存储 token 改成非字符串（模拟历史脏行）
        lease.metadata_ = {"claim_token": 12345}
        db_session.add(lease)
        await db_session.commit()

        resp = await client.post(
            f"/api/daemon/leases/{lease.id}/heartbeat",
            json={"claim_token": "anything"},
            headers=_headers(owner_token),
        )
        assert resp.status_code == 403, resp.text
