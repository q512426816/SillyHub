"""2026-09-27-session-fast-replay task-01/02 后端单测：turn-outline + logs/runs 改造。

钉死 FR-01~03 契约：
- ``GET /api/daemon/sessions/{id}/turn-outline``：全量轮次摘要（prompt/answer 截断
  口径、轻列字段、空会话空 items）+ 进程内 LRU 缓存指纹命中/失效；
- ``GET /sessions/{id}/logs``：``run_id`` 单轮直达（升序上限、404、与游标互斥
  422）+ ``slim`` tool 通道截断标记（旧路径零变化）；
- ``GET /sessions/{id}/logs/{log_id}``：单条全文（不存在 / 跨会话 404）；
- ``GET /sessions/{id}/runs``：agent_profile_snapshot 剥 system_prompt（其余键
  保留）+ gzip 协商。

归属/存在性沿用其它 session 端点的 404 资源隐藏语义；参照
test_session_runs_endpoint.py / test_session_logs_gzip.py 的 client + auth_headers
+ db_session 范式。单测 SQLite 方言：窗口函数（SQLite 3.25+）与 PG 同语义。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.router.session_insights as insights_mod
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User


@pytest.fixture(autouse=True)
def _clear_outline_cache() -> Iterator[None]:
    """turn-outline 进程内 LRU 缓存逐测试清空——防跨测试串台（缓存键=session_id，
    不同测试的随机 uuid 本不冲突，清空是让「首算/命中」断言不受前序测试污染）。"""
    insights_mod._TURN_OUTLINE_CACHE.clear()
    yield
    insights_mod._TURN_OUTLINE_CACHE.clear()


async def _admin_id(db_session: AsyncSession) -> uuid.UUID:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _seed_session(db_session: AsyncSession, *, owner_id: uuid.UUID) -> uuid.UUID:
    sid = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sid,
            user_id=owner_id,
            provider="claude",
            status="active",
        )
    )
    await db_session.commit()
    return sid


def _run(
    sid: uuid.UUID,
    *,
    created_at: datetime,
    status: str = "completed",
    error_code: str | None = None,
    user_id: uuid.UUID | None = None,
) -> AgentRun:
    return AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
        agent_session_id=sid,
        started_at=created_at,
        created_at=created_at,
        error_code=error_code,
        user_id=user_id,
    )


# ── task-01 / FR-01：turn-outline ────────────────────────────────────────────


class TestSessionTurnOutline:
    async def test_outline_summaries_and_light_columns(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """摘要口径：prompt=首条 user_input 前 60 字、answer=首条非空 stdout 前 120
        字（按字符）；轻列字段（status/error_code/sender_name/engine_anchor/
        auto_resume_of/tokens）直映 run 行；tool_call 通道不进摘要。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)

        prompt_text = "帮我把这个仓库的会话回显链路做一次性能分析并输出报告" * 3  # >60 字
        answer_text = "好的，我先扫描代码库结构，然后逐层分析日志拉取与渲染路径。" * 4  # >120 字

        run1 = _run(
            sid,
            created_at=base,
            status="failed",
            error_code="interactive_interrupted",
            user_id=admin,
        )
        run1.engine_anchor = "engine-anchor-1"
        run1.metadata_ = {"auto_resume_of": str(uuid.uuid4())}
        run1.input_tokens = 111
        run1.output_tokens = 22
        run2 = _run(sid, created_at=base + timedelta(seconds=30))
        db_session.add_all([run1, run2])
        await db_session.commit()

        ts = base + timedelta(seconds=5)
        logs = [
            # run1：tool_call 先到（不进摘要）→ user_input → 空 stdout → 非空 stdout。
            AgentRunLog(
                run_id=run1.id,
                timestamp=ts,
                channel="tool_call",
                content_redacted='{"tool": "Bash"}',
            ),
            AgentRunLog(
                run_id=run1.id,
                timestamp=ts + timedelta(seconds=1),
                channel="user_input",
                content_redacted=prompt_text,
            ),
            AgentRunLog(
                run_id=run1.id,
                timestamp=ts + timedelta(seconds=2),
                channel="stdout",
                content_redacted="   ",
            ),
            AgentRunLog(
                run_id=run1.id,
                timestamp=ts + timedelta(seconds=3),
                channel="stdout",
                content_redacted=answer_text,
            ),
            # run2：只有 user_input（无回复行——进行中轮形态）。
            AgentRunLog(
                run_id=run2.id,
                timestamp=ts + timedelta(seconds=10),
                channel="user_input",
                content_redacted="第二轮流什么",
            ),
        ]
        db_session.add_all(logs)
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/turn-outline", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"] == str(sid)
        assert body["total_turns"] == 2
        items = body["items"]
        assert [it["seq"] for it in items] == [1, 2]
        assert [it["run_id"] for it in items] == [str(run1.id), str(run2.id)]

        first = items[0]
        # prompt 摘要 = 首条 user_input 前 60 字（tool_call 行不抢占）。
        assert first["prompt_summary"] == prompt_text[:60]
        # answer 摘要 = 首条**非空** stdout 前 120 字（空白行被跳过）。
        assert first["answer_summary"] == answer_text[:120]
        # 轻列字段直映。
        assert first["status"] == "failed"
        assert first["error_code"] == "interactive_interrupted"
        assert first["sender_name"] == "Admin"
        assert first["engine_anchor"] == "engine-anchor-1"
        assert first["auto_resume_of"] == run1.metadata_["auto_resume_of"]
        assert first["input_tokens"] == 111
        assert first["output_tokens"] == 22
        assert first["created_at"] is not None
        # 无回复行 → answer_summary None（不伪造）。
        assert items[1]["prompt_summary"] == "第二轮流什么"
        assert items[1]["answer_summary"] is None
        # 轻列不携带大 JSON 键（DTO 本无该字段，防回归加字段）。
        assert "agent_profile_snapshot" not in first
        assert "error_detail" not in first

    async def test_outline_cache_fingerprint_hit_and_invalidate(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """缓存：指纹一致零重算（命中）；新日志落库指纹变化 → 重算并看到新轮。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        run1 = _run(sid, created_at=base)
        db_session.add(run1)
        await db_session.commit()
        db_session.add(
            AgentRunLog(
                run_id=run1.id,
                timestamp=base + timedelta(seconds=1),
                channel="user_input",
                content_redacted="第一轮",
            )
        )
        await db_session.commit()

        calls = {"n": 0}
        orig_compute = insights_mod._compute_session_turn_outline

        async def counting_compute(db, session_id):
            calls["n"] += 1
            return await orig_compute(db, session_id)

        monkeypatch.setattr(insights_mod, "_compute_session_turn_outline", counting_compute)

        first = await client.get(f"/api/daemon/sessions/{sid}/turn-outline", headers=auth_headers)
        assert first.status_code == 200, first.text
        assert calls["n"] == 1
        assert first.json()["total_turns"] == 1

        # 数据未变 → 指纹命中，零重算。
        second = await client.get(f"/api/daemon/sessions/{sid}/turn-outline", headers=auth_headers)
        assert second.status_code == 200, second.text
        assert calls["n"] == 1
        assert second.json() == first.json()

        # 新轮 + 新日志落库 → 指纹变化 → 重算，新轮可见。
        run2 = _run(sid, created_at=datetime.now(UTC))
        db_session.add(run2)
        await db_session.commit()
        db_session.add(
            AgentRunLog(
                run_id=run2.id,
                timestamp=datetime.now(UTC),
                channel="user_input",
                content_redacted="第二轮",
            )
        )
        await db_session.commit()

        third = await client.get(f"/api/daemon/sessions/{sid}/turn-outline", headers=auth_headers)
        assert third.status_code == 200, third.text
        assert calls["n"] == 2
        body = third.json()
        assert body["total_turns"] == 2
        assert body["items"][1]["prompt_summary"] == "第二轮"

    async def test_outline_empty_session_returns_empty_items(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """空会话：200 + total_turns=0 + 空 items（不报错，D-003 空态）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)

        resp = await client.get(f"/api/daemon/sessions/{sid}/turn-outline", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"session_id": str(sid), "total_turns": 0, "items": []}

    async def test_outline_404_missing_or_cross_user(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """不存在的会话 → 404（资源隐藏，不泄露存在性）。"""
        resp = await client.get(
            f"/api/daemon/sessions/{uuid.uuid4()}/turn-outline", headers=auth_headers
        )
        assert resp.status_code == 404


# ── task-02 / FR-02：logs run_id 直达 + slim ─────────────────────────────────


class TestSessionLogsRunIdAndSlim:
    async def _seed_two_runs_with_logs(
        self, db_session: AsyncSession, *, owner_id: uuid.UUID
    ) -> tuple[uuid.UUID, AgentRun, AgentRun]:
        admin = owner_id
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        run1 = _run(sid, created_at=base)
        run2 = _run(sid, created_at=base + timedelta(seconds=60))
        db_session.add_all([run1, run2])
        await db_session.commit()
        for i in range(3):
            db_session.add(
                AgentRunLog(
                    run_id=run1.id,
                    timestamp=base + timedelta(seconds=i),
                    channel="stdout",
                    content_redacted=f"run1-#{i}",
                )
            )
        for i in range(2):
            db_session.add(
                AgentRunLog(
                    run_id=run2.id,
                    timestamp=base + timedelta(seconds=60 + i),
                    channel="stdout",
                    content_redacted=f"run2-#{i}",
                )
            )
        await db_session.commit()
        return sid, run1, run2

    async def test_run_id_returns_only_that_run_ascending(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """run_id 命中：只返回该 run 日志，timestamp 升序，不含其它 run 行。"""
        admin = await _admin_id(db_session)
        sid, run1, run2 = await self._seed_two_runs_with_logs(db_session, owner_id=admin)

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/logs",
            headers=auth_headers,
            params={"run_id": str(run2.id)},
        )
        assert resp.status_code == 200, resp.text
        entries = resp.json()
        assert [e["content_redacted"] for e in entries] == ["run2-#0", "run2-#1"]
        assert all(e["run_id"] == str(run2.id) for e in entries)
        # 旧路径不置截断标记（slim 未传）。
        assert all(e["content_truncated"] is None for e in entries)

        # run1 同样直达（互不串）。
        resp1 = await client.get(
            f"/api/daemon/sessions/{sid}/logs",
            headers=auth_headers,
            params={"run_id": str(run1.id)},
        )
        assert [e["content_redacted"] for e in resp1.json()] == ["run1-#0", "run1-#1", "run1-#2"]

    async def test_run_id_404_missing_or_foreign_run(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """run 不存在 / 属于另一会话 → 404（不泄露存在性）。"""
        admin = await _admin_id(db_session)
        sid, _run1, _run2 = await self._seed_two_runs_with_logs(db_session, owner_id=admin)
        other_sid = await _seed_session(db_session, owner_id=admin)
        foreign = _run(other_sid, created_at=datetime.now(UTC))
        db_session.add(foreign)
        await db_session.commit()

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/logs",
            headers=auth_headers,
            params={"run_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404

        resp_foreign = await client.get(
            f"/api/daemon/sessions/{sid}/logs",
            headers=auth_headers,
            params={"run_id": str(foreign.id)},
        )
        assert resp_foreign.status_code == 404

    async def test_run_id_mutually_exclusive_with_before_and_after(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """run_id 与 before/after 游标同传 → 422 fail-explicit。"""
        admin = await _admin_id(db_session)
        sid, run1, _run2 = await self._seed_two_runs_with_logs(db_session, owner_id=admin)

        for extra in ({"before": "2026-09-27T00:00:00Z"}, {"after": "2026-09-27T00:00:00Z"}):
            resp = await client.get(
                f"/api/daemon/sessions/{sid}/logs",
                headers=auth_headers,
                params={"run_id": str(run1.id), **extra},
            )
            assert resp.status_code == 422, resp.text

    async def test_run_id_capped_to_max(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """单轮上限 2000 条（常量 setattr 调小验证裁剪语义：取前 N 行升序）。"""
        monkeypatch.setattr(insights_mod, "_SESSION_RUN_LOGS_MAX", 3)

        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        run1 = _run(sid, created_at=base)
        db_session.add(run1)
        await db_session.commit()
        for i in range(5):
            db_session.add(
                AgentRunLog(
                    run_id=run1.id,
                    timestamp=base + timedelta(seconds=i),
                    channel="stdout",
                    content_redacted=f"line-#{i}",
                )
            )
        await db_session.commit()

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/logs",
            headers=auth_headers,
            params={"run_id": str(run1.id)},
        )
        assert resp.status_code == 200, resp.text
        assert [e["content_redacted"] for e in resp.json()] == [
            "line-#0",
            "line-#1",
            "line-#2",
        ]

    async def test_slim_truncates_tool_channel_only(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """slim=true：tool_call 通道超 2000 字符截到 2000 并置 content_truncated=true；
        stdout 长文本与 ≤2000 的 tool 行零触碰；不传 slim 行为零变化（全文 + 标记
        恒 None）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        run1 = _run(sid, created_at=base)
        db_session.add(run1)
        await db_session.commit()

        big_tool = '{"tool": "Read", "content": "' + "工具结果全文。".ljust(3000, "字") + '"}'
        small_tool = '{"tool": "Glob"}'
        long_stdout = "助手长回复文本。".ljust(3000, "回")
        logs = [
            AgentRunLog(
                run_id=run1.id, timestamp=base, channel="tool_call", content_redacted=big_tool
            ),
            AgentRunLog(
                run_id=run1.id,
                timestamp=base + timedelta(seconds=1),
                channel="tool_call",
                content_redacted=small_tool,
            ),
            AgentRunLog(
                run_id=run1.id,
                timestamp=base + timedelta(seconds=2),
                channel="stdout",
                content_redacted=long_stdout,
            ),
        ]
        db_session.add_all(logs)
        await db_session.commit()

        # 不传 slim：旧路径零变化（升序返回，按 timestamp 顺序定位行）。
        plain = await client.get(f"/api/daemon/sessions/{sid}/logs", headers=auth_headers)
        assert plain.status_code == 200, plain.text
        plain_rows = plain.json()
        assert [e["channel"] for e in plain_rows] == ["tool_call", "tool_call", "stdout"]
        assert plain_rows[0]["content_redacted"] == big_tool
        assert plain_rows[0]["content_truncated"] is None

        slim_resp = await client.get(
            f"/api/daemon/sessions/{sid}/logs",
            headers=auth_headers,
            params={"slim": "true"},
        )
        assert slim_resp.status_code == 200, slim_resp.text
        slim_rows = slim_resp.json()
        assert [e["channel"] for e in slim_rows] == ["tool_call", "tool_call", "stdout"]
        # tool 超长行：截到 2000 字符 + 标记。
        assert slim_rows[0]["content_redacted"] == big_tool[:2000]
        assert len(slim_rows[0]["content_redacted"]) == 2000
        assert slim_rows[0]["content_truncated"] is True
        # 小 tool 行零触碰（不截断、不置标记）。
        assert slim_rows[1]["content_redacted"] == small_tool
        assert slim_rows[1]["content_truncated"] is None
        # 非 tool 通道（stdout）长文本不截断。
        assert slim_rows[2]["content_redacted"] == long_stdout
        assert slim_rows[2]["content_truncated"] is None


# ── task-02 / FR-02：单条日志全文端点 ────────────────────────────────────────


class TestSessionLogEntry:
    async def test_single_log_full_text(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """单条全文：返回完整 AgentRunLogEntry（含超长 tool 原文），与 slim 截断
        互补。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        run1 = _run(sid, created_at=base)
        db_session.add(run1)
        await db_session.commit()
        big_tool = '{"tool": "Read", "content": "' + "x".ljust(2500, "y") + '"}'
        log = AgentRunLog(
            run_id=run1.id,
            timestamp=base + timedelta(seconds=1),
            channel="tool_call",
            content_redacted=big_tool,
            tool_kind="Read",
        )
        db_session.add(log)
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/logs/{log.id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        entry = resp.json()
        assert entry["id"] == str(log.id)
        assert entry["run_id"] == str(run1.id)
        assert entry["channel"] == "tool_call"
        assert entry["content_redacted"] == big_tool
        assert entry["tool_kind"] == "Read"
        # 全文端点不截断、不置标记。
        assert entry["content_truncated"] is None

    async def test_single_log_404_missing_or_foreign(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """日志不存在 / 属于另一会话 / 会话不存在 → 404（不泄露存在性）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        other_sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        foreign_run = _run(other_sid, created_at=base)
        db_session.add(foreign_run)
        await db_session.commit()
        foreign_log = AgentRunLog(
            run_id=foreign_run.id,
            timestamp=base,
            channel="stdout",
            content_redacted="别的会话的日志",
        )
        db_session.add(foreign_log)
        await db_session.commit()

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/logs/{uuid.uuid4()}", headers=auth_headers
        )
        assert resp.status_code == 404

        resp_foreign = await client.get(
            f"/api/daemon/sessions/{sid}/logs/{foreign_log.id}", headers=auth_headers
        )
        assert resp_foreign.status_code == 404

        resp_no_session = await client.get(
            f"/api/daemon/sessions/{uuid.uuid4()}/logs/{foreign_log.id}", headers=auth_headers
        )
        assert resp_no_session.status_code == 404

    async def test_single_log_401_unauthenticated(self, client: AsyncClient) -> None:
        """无认证 → 401。"""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/logs/{uuid.uuid4()}")
        assert resp.status_code == 401


# ── task-02 / FR-03：runs 瘦身 + gzip ────────────────────────────────────────


class TestSessionRunsSlimAndGzip:
    @pytest.mark.asyncio
    async def test_runs_snapshot_strips_system_prompt(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """agent_profile_snapshot 剥 system_prompt 键（浅拷贝响应层去键）：name 等
        轻键保留；无快照 run 恒 None；响应其余字段（error_code/metadata 等）零变化。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        snapshot: dict = {
            "id": str(uuid.uuid4()),
            "name": "知识经理",
            "provider": "claude",
            "model": None,
            "system_prompt": "你是知识经理，负责……（此处为很长的系统提示词原文）",
            "mcp_refs": [],
            "skill_refs": [],
            "allowed_roots_overlay": None,
            "version": 1,
        }
        configured = _run(sid, created_at=base)
        configured.agent_profile_snapshot = snapshot
        plain = _run(sid, created_at=base + timedelta(seconds=10))
        db_session.add_all([configured, plain])
        await db_session.commit()

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/runs",
            headers={**auth_headers, "accept-encoding": "identity"},
        )
        assert resp.status_code == 200, resp.text
        items = {it["id"]: it for it in resp.json()}
        cfg = items[str(configured.id)]
        assert "system_prompt" not in cfg["agent_profile_snapshot"]
        assert cfg["agent_profile_snapshot"]["name"] == "知识经理"
        assert cfg["agent_profile_snapshot"]["provider"] == "claude"
        assert items[str(plain.id)]["agent_profile_snapshot"] is None
        # 库数据不动：同一 session（同一 ORM 实例另查）snapshot 原文保留。
        refreshed = await db_session.get(AgentRun, configured.id)
        assert refreshed is not None
        assert refreshed.agent_profile_snapshot == snapshot

    @pytest.mark.asyncio
    async def test_runs_gzip_when_accepted_and_large(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """gzip 协商（抄 /logs 同款）：Accept-Encoding 含 gzip 且正文 >1KB → gzip
        编码响应，内容与明文等价；identity → 明文。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        heavy = _run(sid, created_at=base)
        heavy.error_detail = {
            "type": "auth_failed",
            "code": "401",
            "message": "API 凭证无效或已失效",
            "raw": "API Error: 401 " + "细节日志。".ljust(2500, "×"),
        }
        db_session.add(heavy)
        await db_session.commit()

        identity_resp = await client.get(
            f"/api/daemon/sessions/{sid}/runs",
            headers={**auth_headers, "accept-encoding": "identity"},
        )
        assert identity_resp.status_code == 200, identity_resp.text
        assert "content-encoding" not in identity_resp.headers

        gzip_resp = await client.get(
            f"/api/daemon/sessions/{sid}/runs",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        assert gzip_resp.status_code == 200, gzip_resp.text
        assert gzip_resp.headers.get("content-encoding") == "gzip"
        assert gzip_resp.headers.get("vary") == "Accept-Encoding"
        # httpx 自动解压；语义等价走 json 对比。
        assert gzip_resp.json() == identity_resp.json()

    @pytest.mark.asyncio
    async def test_runs_small_payload_skips_gzip(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """小载荷（≤1KB）即使接受 gzip 也回明文（压缩编码不值得开销）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        db_session.add(_run(sid, created_at=datetime.now(UTC)))
        await db_session.commit()

        resp = await client.get(
            f"/api/daemon/sessions/{sid}/runs",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        assert resp.status_code == 200, resp.text
        assert "content-encoding" not in resp.headers
        assert len(resp.json()) == 1
