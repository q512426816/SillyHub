"""会话任意点分叉 backend 全链测试（2026-09-22-session-fork-continuation task-05）。

覆盖矩阵（design §接口定义 + D-012 + task-05 acceptance）：

- 四重校验：404 会话不存在 / 他人会话 / run 不属于该会话；409 run 进行中；
  422 caps sessionFork=none（cursor）/ claude 锚点缺失 / pi 下一轮锚点缺失 /
  源引擎会话 id 缺失——各形态独立断言（含结构化 code）；
- D-012 mode 分派三态：claude→resume_at（resume_at_uuid+fork_session+fork_mode
  +resume_session_id）；pi 中段轮→rpc_fork（fork_anchor_entry_id=下一轮锚）；
  pi 末轮→clone（无锚键）；codex→seed（零 fork 键 + 种子 prompt 落 B 首
  user_input）；
- 种子组装帽：build_seed_prompt 纯函数（头行/用户轮全文/助手轮截断/非对话
  channel 跳过/总量帽 + 截尾声明，len ≤ 帽不变量）；
- A 零字段改动：fork 成功后源会话全列快照逐字段一致（D-005）；
- 快照继承：workspace_id / agent_profile_id / llm_provider_id / model 四维；
- 白名单：build_claim_payload interactive 分支 fork 四键进 payload；存量
  （非 fork）lease 无 fork 键（零回归）。

夹具范式镜像 ``test_session_compact_endpoint.py``（mocked hub/redis + svc
create_session 建源会话；额外 run/log 直接 ORM 落行，锚点/task-04 回填链不在
本卡范围）。Production code: app/modules/daemon/session/service/fork.py。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.session.service import (
    FORK_SEED_MAX_CHARS,
    build_seed_prompt,
)

from .test_session_switch_config import (
    _create_runtime,
    _create_user,
    _finish_first_turn,
)

# patch 目标（create 链派发走 ws_hub；sessions_changed 走 redis；同 compact 测试）。
_WS_HUB_GETTER = "app.modules.daemon.ws_hub.get_daemon_ws_hub"
_REDIS_GETTER = "app.modules.daemon.session.service.get_redis"


# ── Fixtures / helpers（镜像 test_session_compact_endpoint.py）──────────────


@pytest.fixture()
def mocked_hub():
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    hub.send_rpc = AsyncMock(return_value=None)
    with patch(_WS_HUB_GETTER, return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch(_REDIS_GETTER, return_value=redis):
        yield redis


async def _admin_user_id(db_session: AsyncSession) -> uuid.UUID:
    """conftest ``auth_admin_token`` 建的 admin（auth_headers 对应身份）。"""
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _append_completed_run(
    db_session: AsyncSession,
    session: AgentSession,
    *,
    engine_anchor: str | None = None,
    sdk_session_id: str | None = None,
    created_at: datetime | None = None,
    status: str = "completed",
) -> AgentRun:
    """直接 ORM 追加一轮（锚点/task-04 回填链不在本卡，测试手工定值）。"""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider=session.provider,
        status=status,
        spec_strategy="interactive",
        agent_session_id=session.id,
        user_id=session.user_id,
        engine_anchor=engine_anchor,
        session_id=sdk_session_id,
        created_at=created_at or datetime.now(UTC) + timedelta(seconds=uuid.uuid4().int % 1000),
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


async def _add_log(
    db_session: AsyncSession,
    run_id: uuid.UUID,
    channel: str,
    content: str,
    *,
    offset_sec: float = 0.0,
) -> None:
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel=channel,
            content_redacted=content,
            timestamp=datetime.now(UTC) + timedelta(seconds=offset_sec),
        )
    )


async def _seed_source_session(
    db_session: AsyncSession,
    *,
    provider: str = "claude",
    owner_id: uuid.UUID | None = None,
    finish_first: bool = True,
) -> AgentSession:
    """svc create_session 建 owner 的源会话 A（首 run completed=可分叉态）。

    追加的 A 属性（sdk id / 锚点）由各测试按场景手工落（见 _append_completed_run
    / 直接 update），此处只铺底座。需在 mocked hub/redis patch 生效期内调用。
    """
    from app.modules.daemon.service import DaemonService

    if owner_id is None:
        owner_id = await _admin_user_id(db_session)
    rt = await _create_runtime(db_session, owner_id, provider=provider)
    svc = DaemonService(db_session)
    created = await svc.create_session(
        owner_id, provider=provider, prompt="first turn", runtime_id=str(rt.id)
    )
    if finish_first:
        await _finish_first_turn(db_session, created)
    return created.agent_session


def _session_row_snapshot(session: AgentSession) -> dict[str, object]:
    """A 全列快照（D-005 零字段改动断言用；含全部 ORM 列原值）。"""
    state = inspect(session)
    return {attr.key: getattr(session, attr.key) for attr in state.mapper.column_attrs}


def _make_log(
    run_id: uuid.UUID,
    channel: str,
    content: str,
) -> AgentRunLog:
    """构造内存 AgentRunLog（build_seed_prompt 纯函数测试，不入库）。"""
    return AgentRunLog(
        run_id=run_id,
        channel=channel,
        content_redacted=content,
        timestamp=datetime.now(UTC),
    )


async def _lease_metadata(db_session: AsyncSession, lease_id: uuid.UUID) -> dict:
    lease = await db_session.get(DaemonTaskLease, lease_id)
    assert lease is not None
    return dict(lease.metadata_ or {})


# ════════════════════════════════════════════════════════════════════════════
# 四重校验矩阵（404 / 409 / 422）
# ════════════════════════════════════════════════════════════════════════════


class TestForkValidationMatrix:
    @pytest.mark.asyncio
    async def test_unauthenticated_401(self, client: AsyncClient) -> None:
        resp = await client.post(f"/api/daemon/sessions/{uuid.uuid4()}/fork", json={})
        assert resp.status_code == 401, resp.text

    @pytest.mark.asyncio
    async def test_session_missing_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/fork",
            json={"at_run_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_non_owner_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """他人会话 → 404 不泄露存在性（归属谓词对齐 get_agent_session 主路径）。"""
        other = await _create_user(db_session)
        source = await _seed_source_session(db_session, owner_id=other)
        first_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == source.id)
                )
            )
            .scalars()
            .first()
        )
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(first_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_run_from_other_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """run 存在但不属于目标会话 → 404（不泄露 run 存在性）。"""
        source = await _seed_source_session(db_session)
        other = await _seed_source_session(db_session)
        other_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == other.id)
                )
            )
            .scalars()
            .first()
        )
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(other_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_FORK_RUN_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_run_active_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """分叉点 run 仍在进行中（ACTIVE_RUN_STATUSES）→ 409。"""
        source = await _seed_source_session(db_session, finish_first=False)
        first_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == source.id)
                )
            )
            .scalars()
            .first()
        )
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(first_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["code"] == "HTTP_409_DAEMON_SESSION_FORK_RUN_ACTIVE"

    @pytest.mark.asyncio
    async def test_caps_none_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """cursor（caps sessionFork=none，task-03 定值）→ 422 结构化拒绝。"""
        source = await _seed_source_session(db_session, provider="cursor")
        first_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == source.id)
                )
            )
            .scalars()
            .first()
        )
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(first_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["code"] == "HTTP_422_DAEMON_SESSION_FORK_UNSUPPORTED"

    @pytest.mark.asyncio
    async def test_claude_anchor_missing_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """claude at_run.engine_anchor 缺失 → 422（文案提示可退种子档）。"""
        source = await _seed_source_session(db_session, provider="claude")
        source.agent_session_id = "sdk-src-claude"
        await db_session.commit()
        first_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == source.id)
                )
            )
            .scalars()
            .first()
        )
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(first_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_422_DAEMON_SESSION_FORK_ANCHOR_MISSING"
        assert body["details"]["reason"] == "at_run_anchor_missing"

    @pytest.mark.asyncio
    async def test_source_sdk_id_missing_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """native 档源会话从未产出引擎会话 id（session 行 + 全部 run 均 NULL）
        → 422（resume/fork 无目标）。"""
        source = await _seed_source_session(db_session, provider="claude")
        run = await _append_completed_run(db_session, source, engine_anchor="anchor-1")
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_422_DAEMON_SESSION_FORK_ANCHOR_MISSING"
        assert body["details"]["reason"] == "source_sdk_session_id_missing"

    @pytest.mark.asyncio
    async def test_pi_next_run_anchor_missing_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """pi 中段轮分叉但下一轮锚缺失 → 422（退 clone 会多带分叉点后内容，
        不静默降级）。"""
        source = await _seed_source_session(db_session, provider="pi")
        source.agent_session_id = "sdk-src-pi"
        await db_session.commit()
        # 首轮（=at_run，有锚）+ 下一轮（无锚）。
        at_run = await _append_completed_run(db_session, source, engine_anchor="pi-entry-1")
        await _append_completed_run(
            db_session,
            source,
            engine_anchor=None,
            created_at=datetime.now(UTC) + timedelta(hours=1),
        )
        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(at_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_422_DAEMON_SESSION_FORK_ANCHOR_MISSING"
        assert body["details"]["reason"] == "next_run_anchor_missing"


# ════════════════════════════════════════════════════════════════════════════
# D-012 mode 分派三态 + tier/lineage/B 行三件套
# ════════════════════════════════════════════════════════════════════════════


class TestForkModeDispatch:
    @pytest.mark.asyncio
    async def test_claude_resume_at(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """claude+锚 → mode=resume_at：B 行 origin/fork 三件套 + lease
        resume_at_uuid/fork_session/fork_mode/resume_session_id 四键 + tier/lineage。"""
        source = await _seed_source_session(db_session, provider="claude")
        source.agent_session_id = "sdk-src-claude"
        await db_session.commit()
        at_run = await _append_completed_run(db_session, source, engine_anchor="chain-entry-uuid-1")

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(at_run.id), "title": "分叉副本"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "native"
        assert body["lineage"] == {
            "source_session_id": str(source.id),
            "source_title": str(body["lineage"]["source_title"]),
            "at_run_seq": 2,
        }
        assert body["run_id"] is not None

        forked = await db_session.get(AgentSession, uuid.UUID(body["forked_session_id"]))
        assert forked is not None
        assert forked.origin == "fork"
        assert forked.fork_of_session_id == source.id
        assert forked.fork_at_run_id == at_run.id
        assert forked.engine_fork_anchor == "chain-entry-uuid-1"
        # fork 不入分身树（design §数据模型）。
        assert forked.parent_session_id is None
        assert forked.tree_depth == 0
        # 请求携带的 title 落 B 行。
        assert forked.title == "分叉副本"

        meta = await _lease_metadata(db_session, uuid.UUID(body["lease_id"]))
        assert meta["fork_mode"] == "resume_at"
        assert meta["fork_session"] is True
        assert meta["resume_at_uuid"] == "chain-entry-uuid-1"
        assert meta["resume_session_id"] == "sdk-src-claude"

    @pytest.mark.asyncio
    async def test_pi_rpc_fork_middle_run(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """pi 中段轮+下一轮锚 → mode=rpc_fork：fork_anchor_entry_id=下一轮
        engine_anchor（D-012 position before 语义），engine_fork_anchor=同值。"""
        source = await _seed_source_session(db_session, provider="pi")
        source.agent_session_id = "sdk-src-pi"
        await db_session.commit()
        at_run = await _append_completed_run(db_session, source, engine_anchor="pi-entry-at")
        await _append_completed_run(
            db_session,
            source,
            engine_anchor="pi-entry-next",
            created_at=datetime.now(UTC) + timedelta(hours=1),
        )

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(at_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "native"
        assert body["lineage"]["at_run_seq"] == 2

        forked = await db_session.get(AgentSession, uuid.UUID(body["forked_session_id"]))
        assert forked is not None
        assert forked.origin == "fork"
        # B 行锚=下一轮 entryId（分叉定位锚，非 at_run 自身锚）。
        assert forked.engine_fork_anchor == "pi-entry-next"

        meta = await _lease_metadata(db_session, uuid.UUID(body["lease_id"]))
        assert meta["fork_mode"] == "rpc_fork"
        assert meta["fork_session"] is True
        assert meta["fork_anchor_entry_id"] == "pi-entry-next"
        assert "resume_at_uuid" not in meta
        assert meta["resume_session_id"] == "sdk-src-pi"

    @pytest.mark.asyncio
    async def test_pi_clone_last_run(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """pi 末轮分叉 → mode=clone：无锚键（fork_session+fork_mode 两基础键），
        engine_fork_anchor=NULL（全量分叉无定位锚）。"""
        source = await _seed_source_session(db_session, provider="pi")
        source.agent_session_id = "sdk-src-pi"
        await db_session.commit()
        last_run = await _append_completed_run(db_session, source, engine_anchor="pi-entry-last")

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(last_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "native"

        forked = await db_session.get(AgentSession, uuid.UUID(body["forked_session_id"]))
        assert forked is not None
        assert forked.engine_fork_anchor is None

        meta = await _lease_metadata(db_session, uuid.UUID(body["lease_id"]))
        assert meta["fork_mode"] == "clone"
        assert meta["fork_session"] is True
        assert "fork_anchor_entry_id" not in meta
        assert "resume_at_uuid" not in meta

    @pytest.mark.asyncio
    async def test_codex_seed(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """codex（caps=seed）→ 零 fork 键 + 种子 prompt 落 B 首 user_input 行。"""
        source = await _seed_source_session(db_session, provider="codex")
        at_run = await _append_completed_run(db_session, source)
        await _add_log(db_session, at_run.id, "user_input", "帮我分析这个方案")
        await _add_log(db_session, at_run.id, "stdout", "好的，方案分析如下：……", offset_sec=1.0)
        await db_session.commit()

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(at_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "seed"

        forked = await db_session.get(AgentSession, uuid.UUID(body["forked_session_id"]))
        assert forked is not None
        assert forked.origin == "fork"
        assert forked.engine_fork_anchor is None

        meta = await _lease_metadata(db_session, uuid.UUID(body["lease_id"]))
        for key in (
            "fork_mode",
            "fork_session",
            "resume_at_uuid",
            "fork_anchor_entry_id",
            "resume_session_id",
        ):
            assert key not in meta

        # 种子 prompt 落 B 首 run 的 user_input 行（前情转述头行 + 截至轮内容）。
        first_log = (
            (
                await db_session.execute(
                    select(AgentRunLog)
                    .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
                    .where(AgentRun.agent_session_id == forked.id)
                    .order_by(AgentRunLog.timestamp.asc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        assert first_log is not None
        assert first_log.channel == "user_input"
        assert "前情转述（非原生上下文）" in (first_log.content_redacted or "")
        assert "帮我分析这个方案" in (first_log.content_redacted or "")


# ════════════════════════════════════════════════════════════════════════════
# A 零字段改动（D-005）+ 快照继承
# ════════════════════════════════════════════════════════════════════════════


class TestSourceInvariants:
    @pytest.mark.asyncio
    async def test_source_zero_mutation(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """fork 成功后源会话 A 全列逐字段一致（D-005：A 零状态变化，可继续对话）。"""
        source = await _seed_source_session(db_session, provider="claude")
        source.agent_session_id = "sdk-src-claude"
        await db_session.commit()
        at_run = await _append_completed_run(db_session, source, engine_anchor="chain-entry-uuid-1")
        await db_session.refresh(source)
        before = _session_row_snapshot(source)

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(at_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text

        after_row = await db_session.get(AgentSession, source.id)
        assert after_row is not None
        after = _session_row_snapshot(after_row)
        assert after == before, (
            "源会话 A 在 fork 后发生字段变化（D-005 违约）："
            f"{ {k: (before[k], after[k]) for k in before if before[k] != after[k]} }"
        )

    @pytest.mark.asyncio
    async def test_snapshot_inheritance(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """B 继承 A 当前值四维：workspace_id / agent_profile_id / llm_provider_id
        / model（经 create 既有参数链，FR-02）。"""
        from app.modules.agent.profile.model import (
            AgentProfile,
            AgentProfileVisibility,
        )
        from app.modules.llm_provider.model import LlmProvider
        from app.modules.workspace.model import Workspace

        owner = await _admin_user_id(db_session)
        ws = Workspace(
            id=uuid.uuid4(),
            name="fork-ws",
            slug="fork-ws",
            root_path="/tmp/fork-ws",
            owner_user_id=owner,
        )
        db_session.add(ws)
        profile = AgentProfile(
            id=uuid.uuid4(),
            name="分叉人格",
            owner_user_id=owner,
            visibility=AgentProfileVisibility.PRIVATE,
            provider="claude",
            system_prompt="You are forksome.",
            mcp_refs=[],
            skill_refs=[],
        )
        db_session.add(profile)
        from app.core.crypto import get_cipher

        cipher = get_cipher()
        ct, key_id = cipher.encrypt("sk-fork-test")
        provider_row = LlmProvider(
            id=uuid.uuid4(),
            user_id=owner,
            name="GLM-Fork",
            agent_kind="claude",
            encrypted_api_key=ct,
            key_id=key_id,
            model="glm-4.7",
            is_default=False,
            api_format="anthropic",
        )
        db_session.add(provider_row)
        await db_session.commit()

        # 直接 ORM 建 A（带全四维当前值），绕开 create 链的入口差异。
        rt = await _create_runtime(db_session, owner, provider="claude")
        source = AgentSession(
            id=uuid.uuid4(),
            user_id=owner,
            runtime_id=rt.id,
            provider="claude",
            status="ended",
            turn_count=1,
            config={"manual_approval": True, "model": "glm-4.7"},
            workspace_id=ws.id,
            agent_profile_id=profile.id,
            llm_provider_id=provider_row.id,
            agent_session_id="sdk-src-inherit",
        )
        db_session.add(source)
        await db_session.commit()
        at_run = await _append_completed_run(
            db_session, source, engine_anchor="chain-entry-inherit"
        )

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/fork",
            json={"at_run_id": str(at_run.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        forked = await db_session.get(AgentSession, uuid.UUID(body["forked_session_id"]))
        assert forked is not None
        assert forked.workspace_id == ws.id
        assert forked.agent_profile_id == profile.id
        assert forked.llm_provider_id == provider_row.id
        assert forked.config is not None and forked.config.get("model") == "glm-4.7"
        assert forked.provider == "claude"


# ════════════════════════════════════════════════════════════════════════════
# claim payload 白名单（Grill B-1 断链点守护）
# ════════════════════════════════════════════════════════════════════════════


class TestClaimPayloadWhitelist:
    @pytest.mark.asyncio
    async def test_fork_keys_in_claim_payload(
        self,
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """native fork lease → build_claim_payload interactive 分支透传 fork 四键
        + resume_session_id（daemon execPayload 消费面，task-06 契约）。"""
        owner = await _create_user(db_session)
        source = await _seed_source_session(db_session, owner_id=owner)
        source.agent_session_id = "sdk-src-claude"
        await db_session.commit()
        at_run = await _append_completed_run(
            db_session, source, engine_anchor="chain-entry-uuid-claim"
        )

        from app.modules.daemon.service import DaemonService
        from app.modules.daemon.session.service.fork import fork_session

        svc = DaemonService(db_session)
        result = await fork_session(
            svc,
            owner,
            session_id=source.id,
            at_run_id=at_run.id,
        )
        assert result.tier == "native"

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        payload = await build_claim_payload(db_session, lease)
        assert payload["resume_at_uuid"] == "chain-entry-uuid-claim"
        assert payload["fork_session"] is True
        assert payload["fork_mode"] == "resume_at"
        assert payload["resume_session_id"] == "sdk-src-claude"
        # resume_at 档不带 pi 锚键（按 mode 只写相关键）。
        assert "fork_anchor_entry_id" not in payload

    @pytest.mark.asyncio
    async def test_non_fork_lease_zero_fork_keys(
        self,
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """存量（普通 create）lease → claim payload 无任何 fork 键（零回归，
        undefined 穿透不伪造默认值）。"""
        owner = await _create_user(db_session)
        source = await _seed_source_session(db_session, owner_id=owner)
        lease = await db_session.get(DaemonTaskLease, source.lease_id)
        assert lease is not None
        payload = await build_claim_payload(db_session, lease)
        for key in ("fork_session", "fork_mode", "resume_at_uuid", "fork_anchor_entry_id"):
            assert key not in payload


# ════════════════════════════════════════════════════════════════════════════
# build_seed_prompt 纯函数（种子帽 / 截尾声明 / 通道筛选）
# ════════════════════════════════════════════════════════════════════════════


class TestBuildSeedPrompt:
    def test_header_and_channels(self) -> None:
        """头行标注 + 用户轮全文 + 助手轮收录 + 非对话 channel（stderr/
        tool_call）跳过。"""
        rid = uuid.uuid4()
        rows = [
            _make_log(rid, "user_input", "第一问：帮我审这个设计"),
            _make_log(rid, "stderr", "[warn] noise"),
            _make_log(rid, "tool_call", '{"tool": "Read"}'),
            _make_log(rid, "stdout", "第一答：设计有三处风险……"),
        ]
        prompt = build_seed_prompt(rows)
        assert prompt.startswith("【前情转述（非原生上下文）】")
        assert "【用户】第一问：帮我审这个设计" in prompt
        assert "【助手】第一答：设计有三处风险……" in prompt
        assert "[warn] noise" not in prompt
        assert '"tool"' not in prompt

    def test_assistant_per_turn_truncation(self) -> None:
        """助手轮单轮超 2000 截断（用户轮全文不受单轮帽）。"""
        rid = uuid.uuid4()
        long_assistant = "x" * 3000
        rows = [
            _make_log(rid, "user_input", "u" * 2500),
            _make_log(rid, "stdout", long_assistant),
        ]
        prompt = build_seed_prompt(rows)
        assert "u" * 2500 in prompt  # 用户轮全文保留
        assert "x" * 2100 not in prompt  # 助手轮已截
        assert "本轮输出过长已截断" in prompt

    def test_total_cap_with_truncation_note(self) -> None:
        """总量超帽截尾 + 显式截尾声明，len ≤ 帽不变量（含声明行）。"""
        rid = uuid.uuid4()
        rows = [_make_log(rid, "user_input", f"第{i}轮用户输入" + "u" * 4000) for i in range(10)]
        prompt = build_seed_prompt(rows)
        assert len(prompt) <= FORK_SEED_MAX_CHARS
        assert "【截尾声明】" in prompt
        assert prompt.rstrip().endswith("内容省略。")

    def test_under_cap_no_note(self) -> None:
        """未超帽：无截尾声明。"""
        rid = uuid.uuid4()
        rows = [_make_log(rid, "user_input", "短问"), _make_log(rid, "stdout", "短答")]
        prompt = build_seed_prompt(rows)
        assert "【截尾声明】" not in prompt
        assert len(prompt) < FORK_SEED_MAX_CHARS

    def test_empty_rows(self) -> None:
        """零可用行（全空/全非对话 channel）仍产头行（合法首 prompt）。"""
        rid = uuid.uuid4()
        prompt = build_seed_prompt([_make_log(rid, "tool_call", "{}")])
        assert prompt.startswith("【前情转述（非原生上下文）】")
        assert len(prompt) > 0
