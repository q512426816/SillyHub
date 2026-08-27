"""submit_messages 跨轮归位单测（task-08 / FR-05 / D-003@v1）。

变更 2026-08-27-background-subagent-progress task-06：后台子代理的日志行（带
``parent_tool_use_id``）经同 session 的**后续 run** 上报，``submit_messages``
落库时把这类行的 run_id 归写**派发 run**（派发 tool_use 行所在的 run，
design §5 Phase 2 P2.2），消除前端子代理目录的孤儿 stub。tool_use_id →
派发 run_id 的映射两级供给：进程级 LRU（``_tool_use_run_lru`` 热路径零查询）
+ 冷启动反查 agent_run_logs（``_resolve_dispatch_run_id``）；仍失败保持当前
run_id 兜底不抛错（N4 历史行不迁移）。

测试模式对齐 ``test_run_sync_assistant_override.py``（submit_messages via
DaemonService facade + db_session + mocked_redis；helpers 直接复用该文件），
覆盖：

- LRU 命中：run1 落 tool_call 派发行（含 tool_use_id）→ LRU 登记；run2 期间
  submit 带 parent_tool_use_id 的行 → 落库 run_id=run1；
- 冷启动：清 ``_tool_use_run_lru``（模拟进程重启 / 容量逐出）后再 submit 仍
  归位（agent_run_logs DB 反查命中，且反查成功后 LRU 回填）；
- 未命中 parent（不存在的 tool_use_id）：保持当前 run（run2）不抛错；
- 无 parent 行（主 agent 行）：落当前 run，行为不变。

Production code is not modified.
"""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.run_sync.service import _tool_use_run_lru
from app.modules.daemon.service import DaemonService

from .test_run_sync_assistant_override import _fetch_logs, mocked_redis  # noqa: F401

# 派发 tool_use id（run1 内 Task 工具调用派发后台子代理）
_DISPATCH_TUID = "toolu_dispatch_01"


@pytest.fixture(autouse=True)
def _clean_tool_use_run_lru() -> None:
    """每测试前后清进程级 LRU（service.clear() 即为此提供的测试隔离钩子）。

    LRU 是模块级单例（跨 submit_messages 调用共享），不清态会让上一个测试
    登记的 (session_id, tool_use_id) 映射泄漏进后续测试，归位断言互相污染。
    """
    _tool_use_run_lru.clear()
    yield
    _tool_use_run_lru.clear()


class _TwoRuns:
    """同 session 两 run + 各自 lease/claim_token 的种子数据（含原始 id）。"""

    def __init__(
        self,
        session_id: uuid.UUID,
        run1_id: uuid.UUID,
        run2_id: uuid.UUID,
        lease1_id: uuid.UUID,
        token1: str,
        lease2_id: uuid.UUID,
        token2: str,
    ) -> None:
        self.session_id = session_id
        self.run1_id = run1_id
        self.run2_id = run2_id
        self.lease1_id = lease1_id
        self.token1 = token1
        self.lease2_id = lease2_id
        self.token2 = token2


async def _seed_two_runs_same_session(db_session: AsyncSession) -> _TwoRuns:
    """建 user/runtime + 一个 agent_session + 同 session 的 run1/run2（各配 lease）。

    对齐 ``test_run_sync_assistant_override._seed_interactive_run_for_submit`` 的
    最小构造（不引入 RunPlacementService）；run2 即「后台子代理行经后续 run 上报」
    的上报 run，lease 与 run 一一对应（submit_messages 校验 lease+token）。
    """
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"attr-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)

    session_id = uuid.uuid4()
    run1_id = uuid.uuid4()
    run2_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=session_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=0,
            runtime_id=rt.id,
            created_at=datetime.now(UTC),
            last_active_at=datetime.now(UTC),
        )
    )
    for rid in (run1_id, run2_id):
        db_session.add(
            AgentRun(
                id=rid,
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy="interactive",
                agent_session_id=session_id,
            )
        )
    token1, token2 = secrets.token_hex(32), secrets.token_hex(32)
    lease1_id, lease2_id = uuid.uuid4(), uuid.uuid4()
    for lid, rid, tok in (
        (lease1_id, run1_id, token1),
        (lease2_id, run2_id, token2),
    ):
        db_session.add(
            DaemonTaskLease(
                id=lid,
                runtime_id=rt.id,
                agent_run_id=rid,
                kind="batch",
                status="pending",
                lease_expires_at=None,
                metadata_={"claim_token": tok},
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
    await db_session.commit()
    return _TwoRuns(session_id, run1_id, run2_id, lease1_id, token1, lease2_id, token2)


def _dispatch_tool_call_message(tuid: str = _DISPATCH_TUID) -> dict:
    """run1 的派发 tool_use 行（channel=tool_call 的 JSON 卡）。

    顶层 ``tool_use_id`` 走 LRU 热路径登记（interactive 风格 flat record）；
    content JSON 内的 ``"tool_use_id"`` 键供冷启动 DB 反查（LIKE %\"id\"% 匹配
    JSON 字符串值）——同一行同时满足两条供给路径。
    """
    return {
        "event_type": "tool_use",
        "channel": "tool_call",
        "content": json.dumps(
            {
                "tool": "Task",
                "args": {"subagent_type": "general-purpose", "prompt": "扫描 backend 目录"},
                "tool_use_id": tuid,
            },
            ensure_ascii=False,
        ),
        "tool_use_id": tuid,
        "tool_kind": "task",
    }


def _subagent_row(content: str, *, parent_tuid: str | None = _DISPATCH_TUID) -> dict:
    """后台子代理日志行（带 parent_tool_use_id，经后续 run 上报）。"""
    msg: dict = {
        "event_type": "text",
        "channel": "stdout",
        "content": content,
    }
    if parent_tuid is not None:
        msg["parent_tool_use_id"] = parent_tuid
        msg["subagent_type"] = "general-purpose"
        msg["depth"] = 1
    return msg


# ── 归位主链路 ───────────────────────────────────────────────────────────────


class TestParentRowAttribution:
    """task-06 / FR-05：带 parent_tool_use_id 的行归写派发 run。"""

    @pytest.mark.asyncio
    async def test_lru_hit_parent_row_lands_in_dispatch_run(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """LRU 命中：run1 落 tool_call 派发行（登记 LRU）→ run2 期间 submit 带
        parent_tool_use_id 的行 → 落库 run_id=run1（前端按派发 tool_use 聚合
        子代理行不再出孤儿 stub）。"""
        seed = await _seed_two_runs_same_session(db_session)
        svc = DaemonService(db_session)

        # run1：派发 tool_use 行落库 + LRU 登记（(session_id, tuid) → run1）。
        count1 = await svc.submit_messages(
            seed.lease1_id,
            seed.token1,
            seed.run1_id,
            [_dispatch_tool_call_message()],
        )
        assert count1 == 1
        assert _tool_use_run_lru.get((seed.session_id, _DISPATCH_TUID)) == seed.run1_id

        # run2：后台子代理进度行（带 parent_tool_use_id）经后续 run 上报。
        count2 = await svc.submit_messages(
            seed.lease2_id,
            seed.token2,
            seed.run2_id,
            [_subagent_row("[TASK_PROGRESS] 子代理扫描中")],
        )
        assert count2 == 1

        # 归位断言：行落派发 run1，而非上报 run2。
        run1_rows = await _fetch_logs(db_session, seed.run1_id)
        run2_rows = await _fetch_logs(db_session, seed.run2_id)
        assert [r.content_redacted for r in run1_rows if r.channel == "stdout"] == [
            "[TASK_PROGRESS] 子代理扫描中"
        ], "parent 行应归位到派发 run1"
        assert run2_rows == [], "上报 run2 不应残留子代理行"
        # 归位行的归属三列照常落库（前端子代理目录渲染依赖）。
        attributed = next(r for r in run1_rows if r.content_redacted.startswith("[TASK_PROGRESS]"))
        assert attributed.parent_tool_use_id == _DISPATCH_TUID
        assert attributed.subagent_type == "general-purpose"
        assert attributed.depth == 1

    @pytest.mark.asyncio
    async def test_cold_start_db_backfill_after_lru_clear(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """冷启动：清 ``_tool_use_run_lru``（模拟进程重启 / 容量逐出）后再 submit
        仍归位——LRU 未命中时走 ``_resolve_dispatch_run_id`` 从 agent_run_logs
        反查（tool_call 行 content JSON 含该 tool_use_id），且反查成功后 LRU 回填
        （同 id 后续行不再打 DB）。"""
        seed = await _seed_two_runs_same_session(db_session)
        svc = DaemonService(db_session)

        # run1 派发行先落库（LRU 登记后随即清空，模拟冷启动）。
        await svc.submit_messages(
            seed.lease1_id, seed.token1, seed.run1_id, [_dispatch_tool_call_message()]
        )
        _tool_use_run_lru.clear()
        assert _tool_use_run_lru.get((seed.session_id, _DISPATCH_TUID)) is None

        # run2 带 parent 行：LRU miss → DB 反查命中 run1 → 归位。
        count2 = await svc.submit_messages(
            seed.lease2_id,
            seed.token2,
            seed.run2_id,
            [_subagent_row("[TASK_NOTIFICATION] 子代理完成")],
        )
        assert count2 == 1

        run1_rows = await _fetch_logs(db_session, seed.run1_id)
        run2_rows = await _fetch_logs(db_session, seed.run2_id)
        assert any(r.content_redacted == "[TASK_NOTIFICATION] 子代理完成" for r in run1_rows), (
            "冷启动反查应把 parent 行归位到派发 run1"
        )
        assert run2_rows == []
        # 反查成功后 LRU 回填（两级供给的衔接：下次同 id 直接热路径命中）。
        assert _tool_use_run_lru.get((seed.session_id, _DISPATCH_TUID)) == seed.run1_id


# ── 兜底口径（不抛错） ────────────────────────────────────────────────────────


class TestAttributionFallbacks:
    """未命中 / 无 parent 的兜底行为：保持当前 run、不抛错、行为不变。"""

    @pytest.mark.asyncio
    async def test_unknown_parent_keeps_current_run_no_raise(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """parent_tool_use_id 指向不存在的 id（LRU miss + DB 反查 miss）→ 行保持
        当前 run（run2）落库，不抛错（design §5 P2.2 / N4：查不到不阻塞上报）。"""
        seed = await _seed_two_runs_same_session(db_session)
        svc = DaemonService(db_session)

        # 不存在的派发 id：两级映射都未命中。
        unknown_tuid = "toolu_nonexistent_404"
        count = await svc.submit_messages(
            seed.lease2_id,
            seed.token2,
            seed.run2_id,
            [_subagent_row("[TASK_PROGRESS] 孤儿上报", parent_tuid=unknown_tuid)],
        )
        assert count == 1, "未命中 parent 不抛错、照常落库"

        # 保持当前 run：行落上报 run2 本身（兜底口径）。
        run2_rows = await _fetch_logs(db_session, seed.run2_id)
        assert [r.content_redacted for r in run2_rows] == ["[TASK_PROGRESS] 孤儿上报"]
        assert (await _fetch_logs(db_session, seed.run1_id)) == []
        # 未命中不写负缓存（同 id 后续上报在派发行迟到时仍可反查归位）。
        assert _tool_use_run_lru.get((seed.session_id, unknown_tuid)) is None

    @pytest.mark.asyncio
    async def test_row_without_parent_lands_in_current_run(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """无 parent_tool_use_id 的行（主 agent 行）不经归位分支，落当前 run——
        行为不变（batch run / 主 agent 场景零回归）。"""
        seed = await _seed_two_runs_same_session(db_session)
        svc = DaemonService(db_session)

        count = await svc.submit_messages(
            seed.lease2_id,
            seed.token2,
            seed.run2_id,
            [_subagent_row("[ASSISTANT] 主 agent 回复", parent_tuid=None)],
        )
        assert count == 1

        run2_rows = await _fetch_logs(db_session, seed.run2_id)
        assert [r.content_redacted for r in run2_rows] == ["[ASSISTANT] 主 agent 回复"]
        assert run2_rows[0].parent_tool_use_id is None
        assert (await _fetch_logs(db_session, seed.run1_id)) == []
