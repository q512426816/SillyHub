"""2026-08-25 会话路径第二轮优化（F5）回归测试。

覆盖五项：

1. P1 二审 #1——inject_session 附件校验 + gate 解析 + MinIO 组装移到会话行锁
   之前：组装先于 FOR UPDATE 取锁（顺序断言）；预组装期间会话被并发 end →
   取锁后锁内重校验拒绝（DaemonSessionNotActive），不落新 run、附件保持草稿。
2. P1 二审 #2——tool_report 懒激活分支透传切换字段（agent_profile_id /
   llm_provider_id 照 create_session 语义落 config + 首轮快照 + lease metadata）
   与附件（标记行 + draft→bound + SESSION_INJECT attachments）；空 prompt 一律
   中文拒绝（daemon _startInteractiveSession 拒建空 prompt 会话）。
3. P2 二审 #3——活跃 run 状态词表单源 ``agent.model.ACTIVE_RUN_STATUSES``
   （pending/running/pending_approval）：审批中的 run 在 current_run_id 判定与
   _session_has_active_turn（daemon/router、agent/finalizer、agent/patrol）均算
   活跃。
4. P2 二审 #5——create_session 的 change/page 前导组装提前到写事务外：前导
   组装完毕后立即 commit 收口只读事务，首个 flush（AgentSession INSERT 写块）
   晚于该 commit——写事务窗口不含前导的磁盘遍历 IO。
5. P2 二审 #6——pg_trgm GIN 索引迁移冒烟：revision 链接前一头、SQLite 方言
   跳过、PG 方言建扩展+索引且 downgrade 对称 drop。

fixture 范式参照 test_session_review_fixes.py / test_tool_report_activation.py
（in-memory SQLite + mock hub/redis）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionNotActive,
    SessionService,
)
from app.modules.session_attachment.model import SessionAttachment

# ── 表基座（platform_agent_logs 未在根 conftest 注册，激活路径查询需要）─────


@pytest.fixture(autouse=True)
async def _ensure_agent_log_table(db_engine) -> None:
    """单独建 ``platform_agent_logs`` 表（镜像 test_tool_report_activation.py）。"""
    from app.models.base import BaseModel
    from app.modules.platform_sync import model as _ps_model

    async with db_engine.begin() as conn:
        await conn.run_sync(
            BaseModel.metadata.create_all,
            tables=[_ps_model.AgentSessionLogORM.__table__],
        )


# ── Helpers（镜像 test_session_review_fixes.py / test_tool_report_activation.py）


async def _create_user(session: AsyncSession, email: str | None = None) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=email or f"f5-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _make_active_session(
    db_session: AsyncSession,
    uid: uuid.UUID,
    runtime: DaemonRuntime,
) -> AgentSession:
    """已激活会话（lease/runtime 绑定 + 一条历史 completed run）。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        kind="interactive",
        status="claimed",
        created_at=now,
        updated_at=now,
        metadata_={"claim_token": "tok"},
    )
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        runtime_id=runtime.id,
        lease_id=lease.id,
        provider="claude",
        status="active",
        turn_count=1,
        created_at=now,
        last_active_at=now,
    )
    db_session.add(lease)
    db_session.add(sess)
    await db_session.flush()
    db_session.add(
        AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=sess.id,
            user_id=uid,
        )
    )
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def _make_tool_report_session(
    db_session: AsyncSession,
    uid: uuid.UUID,
    *,
    provider: str = "claude",
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider=provider,
        status="pending",
        origin="tool_report",
        aggregation_key="claude-code|",
        title="claude-code · 本地活动",
        config_snapshot={"harness": "claude-code"},
        turn_count=0,
        created_at=now,
        last_active_at=now,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def _make_attachment(
    db_session: AsyncSession,
    uid: uuid.UUID,
    *,
    kind: str = "file",
    media_type: str = "text/plain",
    name: str = "notes.txt",
) -> SessionAttachment:
    att = SessionAttachment(
        id=uuid.uuid4(),
        user_id=uid,
        kind=kind,
        media_type=media_type,
        bytes=16,
        name=name,
        object_key=f"attachments/{uid}/{uuid.uuid4().hex}.bin",
        sha256=uuid.uuid4().hex,
    )
    db_session.add(att)
    await db_session.commit()
    await db_session.refresh(att)
    return att


async def _make_profile(db_session: AsyncSession, uid: uuid.UUID):
    from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility

    profile = AgentProfile(
        id=uuid.uuid4(),
        name="猫娘档案",
        owner_user_id=uid,
        visibility=AgentProfileVisibility.PRIVATE,
        provider="claude",
        system_prompt="你是猫娘",
        mcp_refs=[],
        skill_refs=[],
    )
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(profile)
    return profile


async def _make_llm_provider(db_session: AsyncSession, uid: uuid.UUID):
    from app.modules.llm_provider.model import LlmProvider

    lp = LlmProvider(
        id=uuid.uuid4(),
        user_id=uid,
        name="Kimi 中转",
        agent_kind="claude",
        encrypted_api_key=b"key",
        key_id="k1",
        model="kimi-latest",
        multimodal="true",
    )
    db_session.add(lp)
    await db_session.commit()
    await db_session.refresh(lp)
    return lp


# ── 1. P1 二审 #1：附件组装移出会话行锁 ────────────────────────────────────


class TestPrelockedAttachmentAssembly:
    async def test_assembly_happens_before_row_lock(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """MinIO 组装（_preassemble 段）必须先于 FOR UPDATE 取锁执行——锁窗口
        不含对象存储慢读（本轮优化的核心不变量）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_active_session(db_session, uid, rt)
        att = await _make_attachment(db_session, uid)

        order: list[str] = []

        real_lock = SessionService._get_owned_session_for_update

        async def _spy_lock(self, session_id, user_id):
            order.append("lock")
            return await real_lock(self, session_id, user_id)

        import app.modules.session_attachment.service as att_svc

        async def _fake_assemble(rows, *, supports_multimodal, storage):
            order.append("assemble")
            return []

        with (
            patch.object(SessionService, "_get_owned_session_for_update", _spy_lock),
            patch.object(att_svc, "assemble_inject_attachments", _fake_assemble),
        ):
            await DaemonService(db_session).inject_session(
                sess.id, uid, prompt="看下附件", attachment_ids=[att.id]
            )

        assert order == ["assemble", "lock"]

    async def test_concurrent_end_during_preassembly_rejected(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """预组装（锁外 MinIO 读）期间会话被并发 end → 取锁后锁内重校验拒绝：
        DaemonSessionNotActive、不落新 run、附件保持草稿（draft→bound 未发生）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_active_session(db_session, uid, rt)
        att = await _make_attachment(db_session, uid)

        import app.modules.session_attachment.service as att_svc

        async def _assemble_that_ends_session(rows, *, supports_multimodal, storage):
            # 模拟对象存储慢读窗口内的并发 end_session：直接 UPDATE + commit
            # （同一测试连接，SQLite 单连接语义下与真实并发等价）。不在此
            # expire——预组装产物还要读 pre 的属性；失效动作放到取锁前一刻。
            await db_session.execute(
                text("UPDATE agent_sessions SET status = 'ended' WHERE id = :sid"),
                {"sid": sess.id.hex},
            )
            await db_session.commit()
            return []

        real_lock = SessionService._get_owned_session_for_update

        async def _lock_after_expire(self, session_id, user_id):
            # 取锁前 expire 模拟「另一连接的写」：identity map 里的旧 active
            # 快照失效，FOR UPDATE SELECT 按落库后的 ended 刷新（生产环境每
            # 请求独立 session/identity map，无此缓存问题）。
            db_session.expire_all()
            return await real_lock(self, session_id, user_id)

        with (
            patch.object(att_svc, "assemble_inject_attachments", _assemble_that_ends_session),
            patch.object(SessionService, "_get_owned_session_for_update", _lock_after_expire),
        ):
            with pytest.raises(DaemonSessionNotActive):
                await DaemonService(db_session).inject_session(
                    sess.id, uid, prompt="看下附件", attachment_ids=[att.id]
                )

        # 会话保持并发 end 写入的终态（锁内重校验不覆写）。
        await db_session.refresh(sess)
        assert sess.status == "ended"
        # 无新 run（仍只有历史 completed run）——注入被整体拒绝。
        runs = (
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sess.id)))
            .scalars()
            .all()
        )
        assert [r.status for r in runs] == ["completed"]
        # 附件保持草稿（回填发生在锁内校验之后，被拒绝路径跳过）。
        await db_session.refresh(att)
        assert att.session_id is None


# ── 2. P1 二审 #2：tool_report 懒激活透传切换字段与附件 ─────────────────────


class TestToolReportActivationPassthrough:
    async def test_activation_applies_switch_fields(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """激活轮携带 agent_profile_id + llm_provider_id：照 create_session 语义
        落会话三列 + 首轮 run 快照 + lease metadata + config_snapshot 展示键。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        sess = await _make_tool_report_session(db_session, uid)
        profile = await _make_profile(db_session, uid)
        lp = await _make_llm_provider(db_session, uid)

        result = await DaemonService(db_session).inject_session(
            sess.id,
            uid,
            prompt="继续这个会话",
            agent_profile_id=str(profile.id),
            llm_provider_id=str(lp.id),
        )

        # 会话三列 + config_snapshot（保留 harness 键）。
        await db_session.refresh(sess)
        assert sess.status == "active"
        assert sess.agent_profile_id == profile.id
        assert sess.llm_provider_id == lp.id
        snap = sess.config_snapshot or {}
        assert snap.get("harness") == "claude-code"
        assert snap.get("profile_name") == "猫娘档案"
        assert snap.get("provider_name") == "Kimi 中转"
        assert snap.get("engine") == "claude"

        # 首轮 run 配置快照（D-008）。
        run = result.agent_run
        assert run.agent_profile_id == profile.id
        assert (run.agent_profile_snapshot or {}).get("system_prompt") == "你是猫娘"
        assert run.llm_provider_id == lp.id

        # lease metadata：档案提示词维度键 + 会话级供应商独立键。
        lease = await db_session.get(DaemonTaskLease, sess.lease_id)
        assert lease is not None
        meta = lease.metadata_ or {}
        assert meta.get("system_prompt") == "你是猫娘"
        assert meta.get("session_llm_provider_id") == str(lp.id)

    async def test_activation_rejects_switch_only_empty_prompt(self, db_session) -> None:
        """空 prompt 仅带切换字段 → 明确中文 409（提示先发消息激活），不再静默
        丢弃字段建空轮（daemon 拒建空 prompt 会话，会留 pending 死轮）。"""
        uid = await _create_user(db_session)
        sess = await _make_tool_report_session(db_session, uid)
        profile = await _make_profile(db_session, uid)

        with pytest.raises(DaemonSessionNotActive) as exc_info:
            await DaemonService(db_session).inject_session(
                sess.id,
                uid,
                prompt="",
                agent_profile_id=str(profile.id),
            )

        assert "尚未激活" in exc_info.value.message
        # 激活未发生：会话保持 pending、无 run、无 lease。
        await db_session.refresh(sess)
        assert sess.status == "pending"
        assert sess.lease_id is None
        runs = (
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sess.id)))
            .scalars()
            .all()
        )
        assert runs == []

    async def test_activation_attachment_rides_first_turn(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """附件随激活首轮下发：draft→bound 回填 + user_input 标记行 + SESSION_INJECT
        payload attachments 键（对齐主路径 inject 机制；无多模态供应商 → 磁盘
        落盘路由 deliver=disk，无需真实 MinIO）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        sess = await _make_tool_report_session(db_session, uid)
        att = await _make_attachment(
            db_session, uid, kind="image", media_type="image/png", name="shot.png"
        )

        await DaemonService(db_session).inject_session(
            sess.id, uid, prompt="看看这张图", attachment_ids=[att.id]
        )

        await db_session.refresh(sess)
        assert sess.status == "active"
        # 附件 draft→bound。
        await db_session.refresh(att)
        assert att.session_id == sess.id
        # user_input 日志头部带标记行（D-3）。
        log = (
            (
                await db_session.execute(
                    select(AgentRunLog)
                    .where(AgentRunLog.channel == "user_input")
                    .order_by(AgentRunLog.timestamp.desc())
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert log.content_redacted.startswith(f"[附件:{att.id}|image|shot.png]")
        # SESSION_INJECT payload 携带 attachments（deliver=disk 磁盘路由）。
        mocked_hub.send_session_control.assert_awaited()
        payload = mocked_hub.send_session_control.await_args.args[2]
        assert payload["prompt"] == "看看这张图"
        attachments = payload.get("attachments") or []
        assert len(attachments) == 1
        assert attachments[0]["deliver"] == "disk"
        assert attachments[0]["id"] == str(att.id)


# ── 3. P2 二审 #3：pending_approval 算活跃（词表单源回归）────────────────────


class TestPendingApprovalActiveVocabulary:
    async def test_has_active_turn_counts_pending_approval(self, db_session) -> None:
        """三处 _session_has_active_turn（daemon/router、agent/finalizer、
        agent/patrol）对 pending_approval 的 run 均判活跃（修复：审批中被漏判）。"""
        from app.modules.agent import finalizer as finalizer_mod
        from app.modules.agent import patrol as patrol_mod
        from app.modules.daemon import router as router_mod

        uid = await _create_user(db_session)
        now = datetime.now(UTC)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=now,
            last_active_at=now,
        )
        db_session.add(sess)
        await db_session.flush()
        db_session.add(
            AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider="claude",
                status="pending_approval",
                spec_strategy="interactive",
                agent_session_id=sess.id,
                user_id=uid,
            )
        )
        await db_session.commit()

        assert await router_mod._session_has_active_turn(db_session, sess.id) is True
        assert await finalizer_mod._session_has_active_turn(db_session, sess.id) is True
        assert await patrol_mod._session_has_active_turn(db_session, sess.id) is True

    async def test_mcp_tools_vocabulary_single_source(self) -> None:
        """mcp_tools._ACTIVE_RUN_STATUSES 与共享常量同源（含 pending_approval、
        不含 backend 永不落库的 interrupting）。"""
        from app.modules.agent import mcp_tools
        from app.modules.agent.model import ACTIVE_RUN_STATUSES

        assert "pending_approval" in mcp_tools._ACTIVE_RUN_STATUSES
        assert "interrupting" not in mcp_tools._ACTIVE_RUN_STATUSES
        assert mcp_tools._ACTIVE_RUN_STATUSES == ACTIVE_RUN_STATUSES

    async def test_detail_current_run_id_includes_pending_approval(
        self,
        client,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """GET /sessions/{id} 的 current_run_id 对 pending_approval 的 run 非空
        （修复：审批中详情页误判无运行轮、打断按钮消失）。"""
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        now = datetime.now(UTC)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=admin.id,
            provider="claude",
            status="active",
            turn_count=1,
            created_at=now,
            last_active_at=now,
        )
        db_session.add(sess)
        await db_session.flush()
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="pending_approval",
            spec_strategy="interactive",
            agent_session_id=sess.id,
            user_id=admin.id,
        )
        db_session.add(run)
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sess.id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["current_run_id"] == str(run.id)


# ── 4. P2 二审 #5：create_session 前导组装提前到写事务外 ─────────────────────


class TestCreateSessionPreambleBeforeWrite:
    async def test_preamble_assembled_before_write_txn(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """change/page 前导（内部含 asyncio.to_thread 磁盘遍历）组装完毕后立即
        commit 收口只读事务，首个 flush（AgentSession INSERT 写块）晚于该
        commit——写事务窗口不含前导磁盘 IO（本轮优化核心不变量，回归即破坏
        「前导提前 + 只读事务收口」结构）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        order: list[str] = []
        import app.modules.daemon.session.context as ctx_mod

        real_preamble = ctx_mod.build_change_context_preamble

        async def _spy_preamble(dbs, change_id):
            order.append("preamble")
            return await real_preamble(dbs, change_id)

        real_commit = db_session.commit
        real_flush = db_session.flush

        async def _spy_commit():
            order.append("commit")
            return await real_commit()

        async def _spy_flush(*args, **kwargs):
            order.append("flush")
            return await real_flush(*args, **kwargs)

        db_session.commit = _spy_commit
        db_session.flush = _spy_flush

        with patch.object(ctx_mod, "build_change_context_preamble", _spy_preamble):
            await DaemonService(db_session).create_session(uid, provider="claude", prompt="hello")

        # 前导 → 只读事务收口 commit → 首个写 flush，顺序固定且前导只出现一次。
        assert order[:3] == ["preamble", "commit", "flush"]
        assert order.count("preamble") == 1


# ── 5. P2 二审 #6：pg_trgm GIN 索引迁移冒烟 ──────────────────────────────────


class TestTrgmIndexMigration:
    """20260825150000_agent_run_logs_trgm_index.py 的结构 + 方言守卫行为冒烟。

    不跑真实 upgrade（生产 PG 迁移留给部署链路），只验证：revision 链接前一
    头、非 PG 方言 no-op（SQLite 测试环境跳过）、PG 方言建扩展+GIN 索引且
    downgrade 对称 drop、扩展不卸载。
    """

    def _load_module(self):
        import importlib.util
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[4]
            / "migrations"
            / "versions"
            / "20260825150000_agent_run_logs_trgm_index.py"
        )
        spec = importlib.util.spec_from_file_location("mig_20260825150000_trgm", path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module

    def test_revision_chain_links_previous_head(self) -> None:
        module = self._load_module()
        assert module.revision == "20260825150000"
        assert module.down_revision == "20260824130000"

    def test_non_pg_dialect_is_noop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from types import SimpleNamespace

        import alembic.op as op_mod

        module = self._load_module()
        executed: list[str] = []
        bind = SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))
        monkeypatch.setattr(op_mod, "get_bind", lambda: bind)
        monkeypatch.setattr(op_mod, "execute", lambda stmt: executed.append(stmt))

        module.upgrade()
        module.downgrade()
        assert executed == []

    def test_pg_dialect_creates_and_drops_symmetrically(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        import alembic.op as op_mod

        module = self._load_module()
        executed: list[str] = []
        bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
        monkeypatch.setattr(op_mod, "get_bind", lambda: bind)
        monkeypatch.setattr(op_mod, "execute", lambda stmt: executed.append(stmt))

        module.upgrade()
        assert any("CREATE EXTENSION IF NOT EXISTS pg_trgm" in s for s in executed)
        assert any("gin_trgm_ops" in s and module._INDEX_NAME in s for s in executed)

        executed.clear()
        module.downgrade()
        # 对称 drop：仅 drop index，不 DROP EXTENSION（同库其它对象可能已依赖）。
        assert len(executed) == 1
        assert f"DROP INDEX IF EXISTS {module._INDEX_NAME}" in executed[0]
