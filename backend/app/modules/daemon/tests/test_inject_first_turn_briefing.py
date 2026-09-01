"""task-08（2026-08-24-session-team-mission-context）：inject 路径主控首轮简报前缀。

design §5.A / D-004@v1 / D-013@v1（FR-01 inject 侧落地）：
- 命中轮 SESSION_INJECT payload 的 prompt = 简报 + "\\n\\n---\\n\\n" + 用户消息
  （简报在前，任务卡验收原文）；AgentRunLog(user_input) 与前端展示保持干净用户
  原文（不含简报）。
- 判定调用 task-06 ``resolve_first_turn_briefing``（活跃 mission ∧ prompt 非空 ∧
  无已消耗 orchestrator run）：空 prompt 纯切换轮不注入不消耗一次性名额；mission
  已有 pending/running/completed orchestrator run 的轮不再注入；failed 轮不烧断
  ——首轮派发失败（run→failed 收敛）后下一条带文本消息重新注入。
- 无活跃 mission 普通会话 SESSION_INJECT payload 的 prompt 逐字节不变（零回归）。
- SESSION_SWITCH_CONFIG 分支的 prompt 保持原值不动（本卡仅改 inject payload）。

简报内容与格式由 mission_context（task-06）产出——本文件只断言结构特征段
（团队任务简报标题 / mission_id / 目标）与 "---" 拼接形态，不重复钉文案。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import DAEMON_MSG_SESSION_SWITCH_CONFIG

# ── Fixtures / helpers（镜像 test_inject_orchestrator_tagging.py 同款范式）────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"t08-{uid}@example.com",
            password_hash="x",
            display_name="T08",
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


async def _make_mission(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    objective: str,
) -> AgentMission:
    """按 task-01 后的列结构直接落活跃 mission（无 scope → 简报无派发范围段，
    不触 git 探测回调，断言与探测通道解耦）。"""
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        session_id=session_id,
        objective=objective,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


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


async def _finish_run(db_session: AsyncSession, run: AgentRun) -> None:
    run.status = "completed"
    run.finished_at = datetime.now(UTC)
    await db_session.commit()


async def _setup_injectable_session(db_session: AsyncSession, *, first_prompt: str = "first"):
    """建用户/runtime/会话并完结首 turn，返回 (svc, uid, created)。"""
    uid = await _create_user(db_session)
    await _create_runtime(db_session, uid)
    svc = DaemonService(db_session)
    created = await svc.create_session(uid, provider="claude", prompt=first_prompt)
    await _finish_run(db_session, created.agent_run)
    return svc, uid, created


def _inject_payload_for_run(hub: MagicMock, run: AgentRun) -> dict:
    """从 hub mock 里取指定 run 的 SESSION_INJECT payload（按 run_id 过滤，
    规避 create_session 首 turn 派发的同类型消息干扰）。"""
    for call in hub.send_session_control.call_args_list:
        args = call.args
        if (
            len(args) >= 3
            and args[1] == DAEMON_MSG_SESSION_INJECT
            and args[2].get("run_id") == str(run.id)
        ):
            return args[2]
    raise AssertionError(f"no SESSION_INJECT payload dispatched for run {run.id}")


def _switch_payload_for_run(hub: MagicMock, run: AgentRun) -> dict:
    """从 hub mock 里取指定 run 的 SESSION_SWITCH_CONFIG payload（camelCase runId）。"""
    for call in hub.send_session_control.call_args_list:
        args = call.args
        if (
            len(args) >= 3
            and args[1] == DAEMON_MSG_SESSION_SWITCH_CONFIG
            and args[2].get("runId") == str(run.id)
        ):
            return args[2]
    raise AssertionError(f"no SESSION_SWITCH_CONFIG payload dispatched for run {run.id}")


async def _user_input_logs(db_session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    return list(
        (
            await db_session.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == run_id,
                    AgentRunLog.channel == "user_input",
                )
            )
        )
        .scalars()
        .all()
    )


# ── 1. 命中轮：SESSION_INJECT prompt=简报+---+用户消息，user_input 干净 ─────────


class TestBriefingInjected:
    @pytest.mark.asyncio
    async def test_first_orchestrator_turn_gets_briefing_prefix(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """活跃 mission + 非空 prompt + 无 orchestrator run → payload prompt 组装为
        简报+\\n\\n---\\n\\n+用户消息（简报在前含 mission_id/目标特征段）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        mission = await _make_mission(db_session, session_id=sid, objective="重构登录模块")

        result = await svc.inject_session(sid, uid, prompt="开始推进任务")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        dispatched = payload["prompt"]
        briefing, sep, user_part = dispatched.partition("\n\n---\n\n")
        assert sep == "\n\n---\n\n"  # 恰一处分隔（简报在前，用户消息在后）
        assert user_part == "开始推进任务"
        assert "团队任务简报" in briefing
        assert str(mission.id) in briefing
        assert "目标: 重构登录模块" in briefing
        # 本轮 run 即双标记主控 run（task-04 既有语义不受本卡影响）。
        assert result.agent_run.mission_id == mission.id
        assert result.agent_run.role == "orchestrator"

    @pytest.mark.asyncio
    async def test_user_input_log_stays_clean(self, db_session, mocked_hub, mocked_redis) -> None:
        """命中轮 AgentRunLog(user_input)=干净用户原文（不含简报，D-004@v1 展示层干净）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective="干净断言目标")

        result = await svc.inject_session(sid, uid, prompt="用户原始消息")

        logs = await _user_input_logs(db_session, result.agent_run.id)
        assert len(logs) == 1
        assert logs[0].content_redacted == "用户原始消息"
        assert "团队任务简报" not in logs[0].content_redacted

    @pytest.mark.asyncio
    async def test_second_turn_after_consumed_not_injected(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """一次性（D-002@v1）：首轮已注入（run pending 即已消耗）→ 第二条消息不再注入。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective="一次性目标")

        first = await svc.inject_session(sid, uid, prompt="首条指令")
        await _finish_run(db_session, first.agent_run)
        mocked_hub.send_session_control.reset_mock()
        second = await svc.inject_session(sid, uid, prompt="第二条追问")

        payload = _inject_payload_for_run(mocked_hub, second.agent_run)
        assert payload["prompt"] == "第二条追问"


# ── 2. 无 mission → SESSION_INJECT prompt 逐字节不变（零回归） ────────────────


class TestNoMissionUnchanged:
    @pytest.mark.asyncio
    async def test_no_mission_prompt_byte_identical(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """无活跃 mission 普通会话：payload prompt 与入参逐字节相同。"""
        svc, uid, created = await _setup_injectable_session(db_session)

        result = await svc.inject_session(created.agent_session.id, uid, prompt="普通追问原文")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        assert payload["prompt"] == "普通追问原文"

    @pytest.mark.asyncio
    async def test_terminal_mission_prompt_byte_identical(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """已收敛 mission 不算活跃——prompt 原样透传。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective="已收敛目标")
        mission = (
            await db_session.execute(select(AgentMission).where(AgentMission.session_id == sid))
        ).scalar_one()
        mission.converged_at = datetime.now(UTC)
        await db_session.commit()

        result = await svc.inject_session(sid, uid, prompt="收敛后普通轮")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        assert payload["prompt"] == "收敛后普通轮"


# ── 3. 空 prompt 切换轮：不注入不消耗（D-013@v1 / CC-12） ─────────────────────


class TestBlankPromptSwitchRound:
    @pytest.mark.asyncio
    async def test_blank_switch_round_skips_and_does_not_burn(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """空 prompt 纯切换轮：SESSION_SWITCH_CONFIG prompt 保持空原值；随后首条
        带文本消息仍命中注入（一次性名额未烧）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective="切换轮目标")
        provider_row = await _seed_provider(db_session, uid)

        switch = await svc.inject_session(sid, uid, prompt="", llm_provider_id=str(provider_row.id))
        switch_payload = _switch_payload_for_run(mocked_hub, switch.agent_run)
        assert switch_payload["prompt"] == ""  # 切换分支 prompt 原值不动
        assert switch.agent_run.status == "completed"  # 静默切换轮无 LLM turn

        mocked_hub.send_session_control.reset_mock()
        first_text = await svc.inject_session(sid, uid, prompt="切换后的首条消息")
        payload = _inject_payload_for_run(mocked_hub, first_text.agent_run)
        assert payload["prompt"].endswith("\n\n---\n\n切换后的首条消息")
        assert "团队任务简报" in payload["prompt"]


# ── 4. 已消耗 orchestrator run → 不注入（懒建回填同款短路，D-003/D-002） ──────


class TestConsumedRunBlocks:
    @pytest.mark.parametrize("consumed_status", ["pending", "running", "completed"])
    @pytest.mark.asyncio
    async def test_consumed_orchestrator_run_blocks_injection(
        self, db_session, mocked_hub, mocked_redis, consumed_status: str
    ) -> None:
        """mission 已有非 failed orchestrator run（pending/running/completed 任一）
        → 判定不命中，prompt 原样透传。seed 的 run 不带 agent_session_id——带列的
        pending/running 会被 turn 冲突守卫先拦（与懒建回填短路一致的时序），本用例
        专测判定层命中后 inject 侧的透传形态。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        mission = await _make_mission(db_session, session_id=sid, objective="已消耗目标")
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status=consumed_status,
                role="orchestrator",
            )
        )
        await db_session.commit()

        result = await svc.inject_session(sid, uid, prompt="后续轮消息")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        assert payload["prompt"] == "后续轮消息"


# ── 5. failed 轮后重注（D-013@v1 边界二：派发失败不烧断一次性） ───────────────


class TestFailedTurnReinject:
    @pytest.mark.asyncio
    async def test_dispatch_failure_then_next_message_reinjects(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """首轮派发失败（daemon 离线 → run 收敛 failed + DaemonRuntimeOffline）→
        下一条带文本消息重新注入简报（failed 不烧断）。"""
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective="失败重注目标")

        offline_hub = _mock_hub(connected=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=offline_hub):
            with pytest.raises(DaemonRuntimeOffline):
                await svc.inject_session(sid, uid, prompt="首轮派发失败")
        failed_runs = list(
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sid)))
            .scalars()
            .all()
        )
        assert any(r.status == "failed" for r in failed_runs)

        online_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=online_hub):
            retried = await svc.inject_session(sid, uid, prompt="重试这条消息")

        payload = _inject_payload_for_run(online_hub, retried.agent_run)
        assert payload["prompt"].endswith("\n\n---\n\n重试这条消息")
        assert "团队任务简报" in payload["prompt"]
        assert "目标: 失败重注目标" in payload["prompt"]


async def _seed_provider(session: AsyncSession, user_id: uuid.UUID):
    from app.core.crypto import get_cipher
    from app.modules.llm_provider.model import LlmProvider

    cipher = get_cipher()
    ct, key_id = cipher.encrypt("sk-test-key")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name="GLM",
        agent_kind="claude",
        encrypted_api_key=ct,
        key_id=key_id,
        model="glm-4.7",
        is_default=False,
        api_format="anthropic",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


# ── 5. ql-20260901-002：/team 前缀——展示层留原文、派发层剥离 ──────────────────


class TestTeamCommandPrefixStrip:
    """/team 平台 UI 指令前缀：前端发原始输入（气泡/回放显示 "/team 目标"），
    agent 永不接收字面前缀——剥离收口在本层派发组装点。

    - AgentRunLog(user_input) 与 mission objective 回填：保留原文/剥后文本语义；
    - SESSION_INJECT payload（inject 与 create 首 turn）用户消息段：无 "/team"。
    """

    @pytest.mark.asyncio
    async def test_inject_strips_prefix_in_payload_keeps_log(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """活跃 mission 轮 inject "/team 目标"：payload 用户消息段无前缀，
        user_input 日志保留 "/team" 原文，objective 占位回填剥后文本。"""
        from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER

        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective=SESSION_OBJECTIVE_PLACEHOLDER)

        result = await svc.inject_session(sid, uid, prompt="/team 分析两个工作区")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        # 派发文本：简报在前（active mission 首主控轮）+ 用户消息段无 /team 前缀。
        assert "团队任务简报" in payload["prompt"]
        assert payload["prompt"].endswith("\n\n---\n\n分析两个工作区")
        assert "/team" not in payload["prompt"]
        # 展示层：user_input 日志保留用户原文（气泡/回放显示前缀）。
        logs = await _user_input_logs(db_session, result.agent_run.id)
        assert len(logs) == 1
        assert logs[0].content_redacted == "/team 分析两个工作区"
        # objective 占位回填：剥后文本（briefing 目标段不带平台指令字面）。
        from sqlalchemy import select as _select

        refreshed = (
            await db_session.execute(_select(AgentMission).where(AgentMission.session_id == sid))
        ).scalar_one()
        assert refreshed.objective == "分析两个工作区"

    @pytest.mark.asyncio
    async def test_inject_no_mission_still_strips(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """无 mission 普通会话 inject "/team 目标"：服务端同样剥离（/team 是
        平台 UI 指令永不透传 agent 的统一语义），日志仍留原文。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id

        result = await svc.inject_session(sid, uid, prompt="/team 普通会话目标")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        assert payload["prompt"] == "普通会话目标"
        logs = await _user_input_logs(db_session, result.agent_run.id)
        assert logs[0].content_redacted == "/team 普通会话目标"

    @pytest.mark.asyncio
    async def test_inject_similar_commands_not_stripped(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """/teams 等非整条指令不误伤（正则要求 /team 后跟空白或结尾）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id

        result = await svc.inject_session(sid, uid, prompt="/teams 并不是指令")

        payload = _inject_payload_for_run(mocked_hub, result.agent_run)
        assert payload["prompt"] == "/teams 并不是指令"

    @pytest.mark.asyncio
    async def test_bare_team_prefix_keeps_placeholder_objective(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """裸 "/team"（剥后空文本）不回填空 objective——占位保留给下一条带
        文本轮（API 直发防御；前端裸 /team 无内容不发送）。"""
        from app.modules.agent.orchestrator import SESSION_OBJECTIVE_PLACEHOLDER

        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        mission = await _make_mission(
            db_session, session_id=sid, objective=SESSION_OBJECTIVE_PLACEHOLDER
        )

        result = await svc.inject_session(sid, uid, prompt="/team")

        assert mission.objective == SESSION_OBJECTIVE_PLACEHOLDER
        logs = await _user_input_logs(db_session, result.agent_run.id)
        assert logs[0].content_redacted == "/team"

    @pytest.mark.asyncio
    async def test_create_strips_prefix_in_dispatch_keeps_log(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """create 首句 "/team 目标"：dispatch（SESSION_INJECT payload 的
        dispatch_prompt）无前缀，user_input 日志保留原文。"""
        svc, uid = DaemonService(db_session), None
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        created = await svc.create_session(uid, provider="claude", prompt="/team 首句目标")

        payload = _inject_payload_for_run(mocked_hub, created.agent_run)
        # create 路径拼接用户前导（【当前用户信息】等）——只断言末段用户消息
        # 剥前缀 + 全文无 /team 字面。
        assert payload["prompt"].endswith("\n\n---\n\n首句目标")
        assert "/team" not in payload["prompt"]
        logs = await _user_input_logs(db_session, created.agent_run.id)
        assert logs[0].content_redacted == "/team 首句目标"
