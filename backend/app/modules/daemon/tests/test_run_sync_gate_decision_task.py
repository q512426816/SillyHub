"""task-01/task-07 测试：_run_gate_decision_task（gate 决策后台任务核心，形态A）。

2026-08-08-change-center-on-demand task-01（design §4.1 调用点① / §5.2 / §7 / §7.5 /
§10 R5-R7）：砍 auto_dispatch 自动连轴后，``_run_gate_decision_task`` 只做
「存 gate_result + gate_status=decided + 发 gate_status_changed SSE」，**不再内联
sync_stage_status / auto_dispatch_next_step**（H2 修订：原内联块已删），current_stage
不变，推进交 ``advance_change_stage`` tool 读 gate_result 显式决策。

覆盖场景（对齐 design §7.5 生命周期契约表 + task-01 验收）：

1. cas 命中（pending→running→decided + gate_result 落库 + gate_status_changed SSE）。
2. cas miss（gate_status 已被抢 / 非 pending → rowcount==0 直接 return，不跑 gate）—— R3 防双发。
3. 不自动连轴：成功路径**不调** sync_stage_status / _dispatch_execute_team / dispatch /
   _trigger_stage_completion_callback（H2 修订 grep 证据，current_stage 不变）。
4. 异常路径：gate_status='failed' + gate_result.exit_code=2 + errors 含异常信息；
   rollback 已执行（fail-loud，design §7 异常分支）。
5. H1：全程用 get_session_factory()() 独立 session，不触碰 self._session。
6. gate 完成（decided/failed）发 gate_status_changed SSE（task-11 / design §5.7）。

Mock 策略：_run_gate_via_delegate 全 patch 成 AsyncMock（不真起 daemon RPC / 不真读
sillyspec.db）。gate_session 由 conftest._redirect_session_factory 落到与 db_session
同一 in-memory 引擎（autouse），所以 cas UPDATE rowcount 在 SQLite 真实生效（R9：
生产 PG 原子可靠；SQLite 测试用真 UPDATE 验 rowcount）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import RunSyncService

# ── Fixtures（对齐 test_run_sync_gate_enqueue.py 的种子模式） ────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"gate-task-{uid}@example.com",
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
    """patch run_sync.service.get_redis（close_interactive_run 之外的 publish 不影响）。"""
    redis = _mock_redis()
    with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
        yield redis


async def _seed_gate_run(
    db_session: AsyncSession,
    *,
    gate_status: str = "pending",
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """建 user/runtime/workspace/change/agent_run，返回 (run_id, workspace_id, change_id)。

    gate_status 参数控制初始态（默认 pending，测 cas miss 时传 running/decided）。
    change.spec_root 经 SpecWorkspace 表关联（_resolve_gate_spec_root 查 spec_ws）。
    """
    from app.modules.change.model import Change
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.model import Workspace

    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)

    workspace_id = uuid.uuid4()
    workspace = Workspace(
        id=workspace_id,
        name="ws-gate-task",
        slug=f"ws-gate-task-{uuid.uuid4().hex[:6]}",
        root_path="/host-projects/demo",
        status="active",
    )
    change_id = uuid.uuid4()
    run_id = uuid.uuid4()
    session_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=workspace_id,
        change_key=f"gate-task-{uuid.uuid4().hex[:6]}",
        title="gate decision task test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/gate-task",
        current_stage="verify",
        stages={},
        owner_id=uid,
    )
    agent_session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        spec_strategy="interactive",
        agent_session_id=session_id,
        change_id=change_id,
        gate_status=gate_status,
    )
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        spec_root="/home/user/.sillyhub/daemon/specs/demo",
        strategy="platform-managed",
    )
    db_session.add_all([workspace, change, agent_session, run, spec_ws])
    await db_session.commit()
    return run_id, workspace_id, change_id


def _gate_exit_zero_result() -> dict:
    """构造 _run_gate_via_delegate 成功返回（exit 0）。"""
    return {
        "exit_code": 0,
        "errors": [],
        "raw_envelope": {
            "schema_version": 1,
            "command": "gate",
            "change": "demo",
            "ok": True,
            "errors": [],
        },
    }


# ── Tests ────────────────────────────────────────────────────────────────────


class TestRunGateDecisionTaskCasAndSuccess:
    """R3 cas 命中 + 成功 decided + gate_result 落库（形态A：不推进 stage）。"""

    @pytest.mark.asyncio
    async def test_cas_pending_to_running_then_decided_with_gate_result(
        self, db_session, mocked_redis
    ) -> None:
        """pending → cas 命中 → 跑 gate（exit 0）→ decided + gate_result 落库。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        gate_result = _gate_exit_zero_result()
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                new_callable=AsyncMock,
                return_value=gate_result,
            ) as gate_mock,
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        # gate 被调一次（cwd=spec_root，stage=verify）
        gate_mock.assert_awaited_once()
        # 重读 DB 验终态（gate_session 与 db_session 同引擎，row 已 commit）
        run_after = await db_session.get(AgentRun, run_id)
        assert run_after is not None
        assert run_after.gate_status == "decided"
        assert run_after.gate_result is not None
        assert run_after.gate_result["exit_code"] == 0
        assert run_after.gate_result["raw_envelope"]["ok"] is True

    @pytest.mark.asyncio
    async def test_cas_miss_when_already_running_returns_without_running_gate(
        self, db_session, mocked_redis
    ) -> None:
        """R3：gate_status 已被抢（running）→ rowcount==0 → return，不跑 gate。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session, gate_status="running")

        svc = RunSyncService(db_session)
        gate_mock = AsyncMock(return_value=_gate_exit_zero_result())
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                gate_mock,
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        gate_mock.assert_not_awaited()
        # 状态未被改动（仍 running，未翻 decided/failed）
        run_after = await db_session.get(AgentRun, run_id)
        assert run_after is not None
        assert run_after.gate_status == "running"
        assert run_after.gate_result is None

    @pytest.mark.asyncio
    async def test_cas_miss_when_decided_returns_without_running_gate(
        self, db_session, mocked_redis
    ) -> None:
        """R3：gate_status='decided'（已完成）→ rowcount==0 → return。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session, gate_status="decided")

        svc = RunSyncService(db_session)
        gate_mock = AsyncMock()
        with patch("app.modules.daemon.run_sync.service._run_gate_via_delegate", gate_mock):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        gate_mock.assert_not_awaited()


class TestRunGateDecisionTaskNoAutoAdvance:
    """H2 修订（task-01 形态A）：gate 任务不内联 sync / 不自动连轴。

    成功路径只存 gate_result + decided + 发 SSE；**不调** sync_stage_status /
    _dispatch_execute_team / dispatch / _trigger_stage_completion_callback。
    current_stage 不变，推进交 advance_change_stage tool 显式决策。
    """

    @pytest.mark.asyncio
    async def test_does_not_call_trigger_stage_completion_callback(
        self, db_session, mocked_redis
    ) -> None:
        """grep 证据：方法体内无 _trigger_stage_completion_callback 调用。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        callback_spy = AsyncMock()
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
            patch.object(
                RunSyncService,
                "_trigger_stage_completion_callback",
                callback_spy,
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        callback_spy.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_does_not_sync_or_dispatch_next_stage(self, db_session, mocked_redis) -> None:
        """形态A：不内联 sync_stage_status、不自动 dispatch 下一 stage。

        原 H2 内联 sync_stage_status + auto_dispatch_next_step 块已删（task-01）。
        gate 结果只落库 + 发 SSE，current_stage 不变。
        """
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
            patch(
                "app.modules.change.dispatch.SillySpecStageDispatchService.sync_stage_status",
                new_callable=AsyncMock,
            ) as sync_mock,
            patch(
                "app.modules.change.dispatch._dispatch_execute_team",
                new_callable=AsyncMock,
            ) as team_dispatch_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as dispatch_mock,
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        # 不内联 sync / 不自动连轴
        sync_mock.assert_not_awaited()
        team_dispatch_mock.assert_not_awaited()
        dispatch_mock.assert_not_awaited()

        # current_stage 不变（仍 verify，未自动推进）
        from app.modules.change.model import Change

        change = await db_session.get(Change, change_id)
        assert change is not None
        assert change.current_stage == "verify"


class TestRunGateDecisionTaskExceptionFailed:
    """异常分支：gate_status='failed' + gate_result.exit_code=2 + rollback。"""

    @pytest.mark.asyncio
    async def test_gate_raises_exception_sets_failed_exit_two(
        self, db_session, mocked_redis
    ) -> None:
        """_run_gate_via_delegate 抛异常 → failed + exit 2 + errors 含异常信息。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        boom = RuntimeError("daemon WS 断开")
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(side_effect=boom),
            ),
        ):
            # 异常被 gate 任务内部 catch（fail-loud），不向调用方抛
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        run_after = await db_session.get(AgentRun, run_id)
        assert run_after is not None
        assert run_after.gate_status == "failed"
        assert run_after.gate_result is not None
        assert run_after.gate_result["exit_code"] == 2
        assert any("daemon WS 断开" in e for e in run_after.gate_result["errors"])

    @pytest.mark.asyncio
    async def test_workspace_not_found_sets_failed_exit_two(self, db_session, mocked_redis) -> None:
        """非 gate 异常（workspace 查不到）→ failed + exit 2（fail-loud 覆盖非 gate 阶段）。"""
        run_id, _workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
        ):
            # workspace_id 指向不存在的 workspace → gate 任务内部 catch → fail-loud
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=uuid.uuid4(),
                change_id=change_id,
            )

        run_after = await db_session.get(AgentRun, run_id)
        assert run_after is not None
        assert run_after.gate_status == "failed"
        assert run_after.gate_result is not None
        assert run_after.gate_result["exit_code"] == 2


class TestRunGateDecisionTaskH1IndependentSession:
    """H1：全程用 get_session_factory()() 独立 session。"""

    @pytest.mark.asyncio
    async def test_uses_get_session_factory_independent_session(
        self, db_session, mocked_redis
    ) -> None:
        """spy get_session_factory 确认被调，gate 操作用其产出的 session 而非 self._session。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        # 真用 get_session_factory（conftest._redirect_session_factory 已指向测试引擎），
        # 仅 spy 调用次数；spy 包装原工厂返回真实 session（cas UPDATE 要真生效）。
        from app.core import db as db_module

        real_factory = db_module.get_session_factory()
        spy = MagicMock(return_value=real_factory)
        with (
            patch("app.modules.daemon.run_sync.service.get_session_factory", spy),
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        spy.assert_called_once()


class TestRunGateDecisionTaskGateExitOne:
    """gate exit 1（打回）：仍 decided + gate_result.exit_code=1（交显式决策）。"""

    @pytest.mark.asyncio
    async def test_gate_exit_one_decided_with_errors_stored(self, db_session, mocked_redis) -> None:
        """gate ok=False（exit 1）→ decided + gate_result.exit_code=1 + errors 透传。

        gate_result 已落库，advance_change_stage tool / review 据此显式决策
        （exit 1 打回，design §5.4）。此处仅验 gate_result 落库正确。
        """
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        gate_result = {
            "exit_code": 1,
            "errors": ["verify-result.md 不存在"],
            "raw_envelope": {"ok": False, "errors": ["verify-result.md 不存在"]},
        }
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=gate_result),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        run_after = await db_session.get(AgentRun, run_id)
        assert run_after is not None
        assert run_after.gate_status == "decided"
        assert run_after.gate_result["exit_code"] == 1
        assert "verify-result.md 不存在" in run_after.gate_result["errors"]


class TestRunGateDecisionTaskGateStatusChangedSse:
    """task-01/task-11：gate 完成（decided/failed）发 Redis gate_status_changed SSE。

    design §5.7：gate 后台任务 27s+，close 的 SSE 只发 turn_completed，gate 完成无 SSE
    → 前端 "客观核验中" 徽标卡住。task-11 在 gate_result 落库 + gate_status 置
    decided/failed 之后，发 gate_status_changed 事件，复用现有 agent_run:{id} channel
    （task-12 前端按 event 字段分流）。对齐 close_interactive_run:955-975 的
    try/except 容错模式（Redis 抖动不影响已 commit 的 gate_result）。

    覆盖 task-11 验收 5 条：
      1. decided 时 publish gate_status_changed（gate_status=decided）
      2. failed 时同样 publish（gate_status=failed）
      3. errors_summary 截断（gate_result.errors 超 500 字符截断到 500）
      4. Redis publish 失败不抛（try/except 兜底，只 warning）
      5. 复用 agent_run:{id} channel（无新 channel 字符串）
    """

    @staticmethod
    def _find_gate_event(redis: AsyncMock, run_id: uuid.UUID) -> tuple[str, str] | None:
        """从 mocked_redis.publish 调用记录里找 gate_status_changed 事件。

        返回 (channel, gate_status)；找不到返回 None。publish 形如
        publish(channel: str, payload_json: str)。
        """
        import json

        for call in redis.publish.call_args_list:
            args, _ = call
            if len(args) < 2:
                continue
            channel, payload = args[0], args[1]
            if channel != f"agent_run:{run_id}":
                continue
            try:
                data = json.loads(payload)
            except (TypeError, ValueError):
                continue
            if isinstance(data, dict) and data.get("event") == "gate_status_changed":
                return channel, str(data.get("gate_status"))
        return None

    @pytest.mark.asyncio
    async def test_decided_publishes_gate_status_changed(self, db_session, mocked_redis) -> None:
        """decided 路径：gate_result 落库后发 gate_status_changed（gate_status=decided）。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        found = self._find_gate_event(mocked_redis, run_id)
        assert found is not None, "decided 路径未发 gate_status_changed 事件"
        _channel, gate_status = found
        assert gate_status == "decided"

    @pytest.mark.asyncio
    async def test_failed_publishes_gate_status_changed(self, db_session, mocked_redis) -> None:
        """failed 路径：异常分支置 failed commit 后同样发 gate_status_changed。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(side_effect=RuntimeError("daemon WS 断开")),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        found = self._find_gate_event(mocked_redis, run_id)
        assert found is not None, "failed 路径未发 gate_status_changed 事件"
        _channel, gate_status = found
        assert gate_status == "failed"

    @pytest.mark.asyncio
    async def test_errors_summary_truncated_to_500(self, db_session, mocked_redis) -> None:
        """gate_result.errors 超 500 字符 → errors_summary 截断到 500（防超大 payload）。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        # 构造 errors 列表，单条字符串 > 500 字符。
        long_error = "X" * 800
        gate_result = {
            "exit_code": 1,
            "errors": [long_error],
            "raw_envelope": {"ok": False, "errors": [long_error]},
        }
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=gate_result),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        # 解析 publish payload，取 errors_summary。
        import json

        gate_payload = None
        for call in mocked_redis.publish.call_args_list:
            args, _ = call
            if len(args) < 2 or args[0] != f"agent_run:{run_id}":
                continue
            data = json.loads(args[1])
            if isinstance(data, dict) and data.get("event") == "gate_status_changed":
                gate_payload = data
                break
        assert gate_payload is not None
        errors_summary = gate_payload.get("errors_summary")
        assert errors_summary is not None
        assert len(errors_summary) <= 500, "errors_summary 未截断到 500"
        # str(errors) 即 str(["XXX..."])，以 '[' 开头（list repr），截断保留 errors 内容。
        # 验证含 errors 内容（X 字符）+ 长度恰好被 500 上限截断。
        assert "X" in errors_summary
        assert len(errors_summary) == 500

    @pytest.mark.asyncio
    async def test_errors_summary_none_when_errors_empty(self, db_session, mocked_redis) -> None:
        """gate_result.errors 为空列表 → errors_summary=None（truthy 判定）。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        import json

        gate_payload = None
        for call in mocked_redis.publish.call_args_list:
            args, _ = call
            if len(args) < 2 or args[0] != f"agent_run:{run_id}":
                continue
            data = json.loads(args[1])
            if isinstance(data, dict) and data.get("event") == "gate_status_changed":
                gate_payload = data
                break
        assert gate_payload is not None
        # exit 0 的 errors=[] → errors_summary=None
        assert gate_payload.get("errors_summary") is None

    @pytest.mark.asyncio
    async def test_redis_publish_failure_does_not_raise(self, db_session, mocked_redis) -> None:
        """Redis publish 抛异常 → try/except 兜底，不向调用方抛，gate_result 已落库不受影响。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        # publish 抛异常模拟 Redis 抖动。
        mocked_redis.publish = AsyncMock(side_effect=RuntimeError("redis down"))

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
        ):
            # 不抛异常（try/except 兜底，只 warning）
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        # gate_result 仍正常落库（Redis 抖动不影响已 commit 的数据）
        run_after = await db_session.get(AgentRun, run_id)
        assert run_after is not None
        assert run_after.gate_status == "decided"
        assert run_after.gate_result is not None
        assert run_after.gate_result["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_reuses_agent_run_channel_no_new_channel(self, db_session, mocked_redis) -> None:
        """复用 agent_run:{id} channel——无新 channel 字符串（前端按 event 字段分流）。"""
        run_id, workspace_id, change_id = await _seed_gate_run(db_session)

        svc = RunSyncService(db_session)
        with (
            patch(
                "app.modules.daemon.run_sync.service._run_gate_via_delegate",
                AsyncMock(return_value=_gate_exit_zero_result()),
            ),
        ):
            await svc._run_gate_decision_task(
                agent_run_id=run_id,
                workspace_id=workspace_id,
                change_id=change_id,
            )

        # 所有 publish 调用的 channel 都必须是 agent_run:{id}（不出现 gate_run 等新 channel）
        channels = {call.args[0] for call in mocked_redis.publish.call_args_list if call.args}
        assert channels, "decided 路径应有 publish 调用"
        forbidden = {c for c in channels if not c.startswith("agent_run:")}
        assert not forbidden, f"发现非 agent_run: channel：{forbidden}"
