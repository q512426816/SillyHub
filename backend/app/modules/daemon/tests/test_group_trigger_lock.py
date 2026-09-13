"""task-03（2026-09-12-group-trigger-lock-graceful）触发链锁超时优雅降级 + 任务行存活性测试。

覆盖（design §3 三用例）：

- **超时→复用**：段2 FOR UPDATE 等锁超时（55P03 模拟注入——SQLite 无真锁，
  monkeypatch session.execute 按 FOR UPDATE 标记分发）→ 段3 rollback 重读时
  指针已回填（对方在超时窗口内建完）→ 复用既有影子，不新建不抛；
- **超时→报忙**：同注入 + 指针仍空 → GroupChatInvalid（4xx 群错误族、
  AppError 子类——send_group_message gather 部分失败收集既有机制接住，
  不再裸 500；全链收集行为由 task-04 真实环境复验覆盖）；
- **任务行存活性**：use_consensus 消息 + 触发协程抛非 AppError（模拟
  gather fail-loud 500）→ 独立重读断言任务行已落库（rollback 后仍在——
  G-4 同款 rollback+refresh 手法）：消息与任务同生（design §2.2），sweeper
  可见可收口。

夹具范式镜像 ``test_group_consensus.py``（in-memory SQLite db_session）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupConsensusTask,
    AgentGroupMember,
    AgentRun,
    AgentSession,
)
from app.modules.agent.schema import GroupMemberAgentConfig
from app.modules.auth.model import User
from app.modules.daemon.group.service import GroupChatService
from app.modules.daemon.group.service.helpers import AppError, GroupChatInvalid
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# ── 夹具（照 test_group_consensus.py 最小行集）────────────────────────────


async def _make_user(db_session: AsyncSession, name: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"lock-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _make_group_env(db_session: AsyncSession) -> SimpleNamespace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="lock-ws",
        slug=f"lock-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/lock-ws",
        status="active",
    )
    db_session.add(ws)
    owner = await _make_user(db_session, "群主")
    group = AgentGroupChat(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        workspace_id=ws.id,
        project_id=None,
        title="锁降级测试群",
        created_by=owner.id,
        agent_cross_mention=True,
        cross_mention_depth=4,
        context_window=20,
        consensus_mode=True,
        consensus_timeout_seconds=600,
        created_at=datetime.now(UTC),
    )
    db_session.add(group)
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="group",
        agent_session_id=group.session_id,
        user_id=owner.id,
        status="completed",
        started_at=datetime.now(UTC),
        spec_strategy="group_carrier",
    )
    db_session.add(carrier)
    await db_session.flush()
    return SimpleNamespace(ws=ws, owner=owner, group=group, carrier=carrier)


async def _make_member(
    db_session: AsyncSession,
    group: AgentGroupChat,
    *,
    name: str,
    owner_id: uuid.UUID,
    with_shadow: bool = False,
) -> tuple[AgentGroupMember, AgentSession | None]:
    """成员行（默认指针空=未懒建）；with_shadow=True 时另造孤儿影子行
    （模拟对方协程已 commit 影子但指针尚未回填到本事务视角）。"""
    shadow: AgentSession | None = None
    if with_shadow:
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=owner_id,
            name=f"影子-{name}",
            session_kind="group_member",
            provider="claude",
            status="active",
            turn_count=0,
            created_at=datetime.now(UTC),
        )
        db_session.add(shadow)
        await db_session.flush()
    member = AgentGroupMember(
        id=uuid.uuid4(),
        group_id=group.id,
        member_type="agent",
        display_name=name,
        config=GroupMemberAgentConfig(
            display_name=name,
            runtime_id=uuid.uuid4(),
            provider="claude",
        ),
        joined_at=datetime.now(UTC),
        created_by=owner_id,
        shadow_session_id=None,  # 指针空——进段2 FOR UPDATE
    )
    db_session.add(member)
    await db_session.flush()
    return member, shadow


class _FakeLockNotAvailable(Exception):
    """asyncpg LockNotAvailableError 形状（sqlstate 55P03）——不 import asyncpg。"""

    sqlstate = "55P03"


def _lock_timeout_error() -> DBAPIError:
    return DBAPIError(
        "SELECT ... FOR UPDATE",
        {},
        _FakeLockNotAvailable("canceling statement due to lock timeout"),
    )


def _install_lock_timeout(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    *,
    refill_on_reread: bool,
    member_id: uuid.UUID | None = None,
    shadow_id: uuid.UUID | None = None,
) -> dict:
    """monkeypatch session.execute 三段分发：无锁读放行；FOR UPDATE 抛 55P03。

    refill_on_reread=True：段3 无锁重读前真实 UPDATE 回填指针 + commit
    （模拟对方协程在等锁超时窗口内建完 commit）。
    """
    state: dict = {"for_update_calls": 0, "refilled": False}
    real_execute = db_session.execute

    async def fake_execute(stmt, *args, **kwargs):
        if getattr(stmt, "_for_update_arg", None) is not None:
            state["for_update_calls"] += 1
            raise _lock_timeout_error()
        if refill_on_reread and not state["refilled"] and state["for_update_calls"] > 0:
            state["refilled"] = True
            # 对方协程视角的回填（独立于本事务——真 UPDATE + commit）。
            await real_execute(
                update(AgentGroupMember)
                .where(AgentGroupMember.id == member_id)
                .values(shadow_session_id=shadow_id)
            )
            await db_session.commit()
        return await real_execute(stmt, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", fake_execute)
    return state


# ── 用例1：段3 重读指针已回填 → 复用既有影子（design §2.1 段3 分支一）──


async def test_lock_timeout_reread_refilled_reuses_shadow(db_session, monkeypatch):
    env = await _make_group_env(db_session)
    member, shadow = await _make_member(
        db_session, env.group, name="小码", owner_id=env.owner.id, with_shadow=True
    )
    await db_session.commit()  # 造数持久——段3 rollback 不洗

    _install_lock_timeout(
        monkeypatch,
        db_session,
        refill_on_reread=True,
        member_id=member.id,
        shadow_id=shadow.id,
    )

    svc = GroupChatService(db_session)
    shadow_session, first_run_id = await svc._ensure_shadow_session(
        env.group,
        member,
        first_prompt="你好",
        first_turn_metadata={},
    )

    assert first_run_id is None  # 复用路径（非本次懒建）
    assert shadow_session.id == shadow.id


# ── 用例2：段3 重读指针仍空 → 4xx 报忙（AppError 族，落部分失败收集）──


async def test_lock_timeout_reread_empty_raises_busy(db_session, monkeypatch):
    env = await _make_group_env(db_session)
    member, _ = await _make_member(
        db_session, env.group, name="小测", owner_id=env.owner.id, with_shadow=False
    )
    await db_session.commit()

    state = _install_lock_timeout(monkeypatch, db_session, refill_on_reread=False)

    svc = GroupChatService(db_session)
    with pytest.raises(GroupChatInvalid) as exc_info:
        await svc._ensure_shadow_session(
            env.group,
            member,
            first_prompt="你好",
            first_turn_metadata={},
        )

    assert state["for_update_calls"] == 1  # 段2 恰一次等锁尝试（不自动重试，D-2）
    assert "正在被触发中" in str(exc_info.value)
    assert isinstance(exc_info.value, AppError)  # 4xx 群错误族——gather 部分失败收集接住
    assert exc_info.value.details.get("member_id") == str(member.id)


# ── 用例3：触发全炸（非 AppError 500 模拟）后任务行仍在（design §2.2）────


async def test_consensus_task_survives_trigger_failure(db_session, monkeypatch):
    env = await _make_group_env(db_session)
    # 群主自己入群（user 成员行——_require_group_member 两段式判定的成员表命中源）。
    env_owner_member = AgentGroupMember(
        group_id=env.group.id,
        member_type="user",
        display_name="群主",
        user_id=env.owner.id,
        invited_by=env.owner.id,
        joined_at=datetime.now(UTC),
    )
    db_session.add(env_owner_member)
    m1, _ = await _make_member(db_session, env.group, name="小码", owner_id=env.owner.id)
    m2, _ = await _make_member(db_session, env.group, name="小测", owner_id=env.owner.id)
    await db_session.commit()

    import app.modules.daemon.group.service as gsvc
    import app.modules.daemon.group.service.messages as messages_module

    async def _redis_ping():
        raise ConnectionError("no redis in test")

    monkeypatch.setattr(gsvc, "get_redis", lambda: SimpleNamespace(ping=_redis_ping))
    monkeypatch.setattr(
        messages_module, "_publish_group_channel_event", AsyncMock(return_value=None)
    )
    # 触发协程抛非 AppError——gather fail-loud 上抛（模拟旧 500 现场）。
    monkeypatch.setattr(
        GroupChatService,
        "_trigger_member_isolated",
        AsyncMock(side_effect=RuntimeError("boom: 模拟触发链意外失败")),
    )

    with pytest.raises(RuntimeError, match="boom"):
        await GroupChatService(db_session).send_group_message(
            env.group.id,
            env.owner,
            content=f"@{m1.display_name} @{m2.display_name} 讨论一下锁降级",
        )

    # 独立重读（G-4 手法：rollback 清事务态后重新查询）——任务行已先行
    # commit 落库，不再被触发失败回滚吞掉。按 group_id 查（send_group_message
    # 内部自建 carrier，任务不挂 fixture 的 env.carrier）。
    await db_session.rollback()
    task = (
        (
            await db_session.execute(
                select(AgentGroupConsensusTask).where(
                    AgentGroupConsensusTask.group_id == env.group.id
                )
            )
        )
        .scalars()
        .first()
    )
    assert task is not None, "任务行应在触发失败后仍存在（消息与任务同生，sweeper 可收口）"
    assert task.status == "open"


# ── 用例4：任务行 INSERT 撞 FK KEY SHARE 锁 → 降级普通多 @（design §2.2 补盲）─
# 真实 PG 复验抓获：psql 持成员行 FOR UPDATE 时，consensus INSERT 的外键
# （coordinator_member_id）对父行取 KEY SHARE 锁被堵 → 同 55P03 超时。
# 降级：rollback（消息已先 commit 不丢）→ 无任务继续 → 响应 200 无
# consensus_task_id（比 500 丢任务/4xx 撕裂均优）。


async def test_consensus_insert_lock_busy_degrades_to_plain(db_session, monkeypatch):
    env = await _make_group_env(db_session)
    env_owner_member = AgentGroupMember(
        group_id=env.group.id,
        member_type="user",
        display_name="群主",
        user_id=env.owner.id,
        invited_by=env.owner.id,
        joined_at=datetime.now(UTC),
    )
    db_session.add(env_owner_member)
    m1, _ = await _make_member(db_session, env.group, name="小码", owner_id=env.owner.id)
    m2, _ = await _make_member(db_session, env.group, name="小测", owner_id=env.owner.id)
    await db_session.commit()

    import app.modules.daemon.group.service as gsvc
    import app.modules.daemon.group.service.messages as messages_module

    async def _redis_ping():
        raise ConnectionError("no redis in test")

    monkeypatch.setattr(gsvc, "get_redis", lambda: SimpleNamespace(ping=_redis_ping))
    monkeypatch.setattr(
        messages_module, "_publish_group_channel_event", AsyncMock(return_value=None)
    )
    # 触发链打桩（不真触发；本用例焦点在 INSERT 撞锁降级续链——返回
    # GroupMemberTriggerRead 形态，gather 消费 .queued/.run_id 等字段）。
    from app.modules.daemon.group.service.helpers import GroupMemberTriggerRead

    async def _fake_trigger(svc_self, **kwargs):
        # 调用点（messages.py:455）传 member_id 标量；member_name 打桩
        # 返回值只服务响应组装（不较真成员名）。
        return GroupMemberTriggerRead(
            member_id=kwargs["member_id"],
            member_name="stub",
            shadow_session_id=None,
            run_id=None,
            queued=False,
        )

    monkeypatch.setattr(GroupChatService, "_trigger_member_isolated", _fake_trigger)

    # 断言/造参预取标量：send 内部降级 rollback 会过期 identity map 里
    # 的 fixture 对象（env.group/m1/m2 同对象）——之后访问 .id/.display_name
    # 触发 lazy load（MissingGreenlet），一律先取标量。
    group_id_val = env.group.id
    m1_name_val, m2_name_val = m1.display_name, m2.display_name

    # 注入 FK 撞锁：create_consensus_task 抛 55P03 包装 DBAPIError
    # （sqlstate 双口径之一——照 _is_member_lock_wait_timeout 判定面）。
    class _FakeOrig(Exception):
        sqlstate = "55P03"

    async def _blocked_insert(*args, **kwargs):
        raise DBAPIError(
            "INSERT ... FOR KEY SHARE blocked",
            {"params": {}},
            _FakeOrig("canceling statement due to lock timeout"),
        )

    monkeypatch.setattr(messages_module, "create_consensus_task", _blocked_insert)

    # 不炸（降级续跑）——响应无 consensus_task_id（普通多 @ 消息）。
    resp = await GroupChatService(db_session).send_group_message(
        group_id_val,
        env.owner,
        content=f"@{m1_name_val} @{m2_name_val} INSERT 撞锁降级",
    )
    assert resp.consensus_task_id is None, "撞锁降级后应为无共识任务的普通消息"
    # 无任务行留下（本轮没建成）。
    await db_session.rollback()
    task = (
        (
            await db_session.execute(
                select(AgentGroupConsensusTask).where(
                    AgentGroupConsensusTask.group_id == group_id_val
                )
            )
        )
        .scalars()
        .first()
    )
    assert task is None

    # 非 55P03 的 DBAPIError 不降级（原样冒泡）。
    async def _other_db_error(*args, **kwargs):
        raise DBAPIError("pg down", {"params": {}}, Exception("connection reset"))

    monkeypatch.setattr(messages_module, "create_consensus_task", _other_db_error)
    # 第一次 send 的降级 rollback 过期了 identity map 里的 env.owner——
    # 真实生产每请求新 session 新查 user，无此问题；测试复用 fixture 对象
    # 需 refresh 恢复可用。
    await db_session.refresh(env.owner)
    with pytest.raises(DBAPIError):
        await GroupChatService(db_session).send_group_message(
            group_id_val,
            env.owner,
            content=f"@{m1_name_val} @{m2_name_val} 非锁错误不降级",
        )


# ── 用例4：gather 失败登记随请求收口提交（2026-09-13 24h 审查 P0 收尾）────


async def test_consensus_failure_registration_persisted(db_session, monkeypatch):
    """协调人触发失败（AppError 族）→ aborted 登记与成员态须随请求提交落库。

    修复前：「任务行先行提交」只保住任务本体；gather 后对 task.status /
    members / 状态卡的变更仍挂在请求事务——get_session 成功路径不 commit，
    收口即回滚（DB 态停留 OPEN、卡片刷新即失）。修复后：send 返回前统一
    收口 commit（消息 200 部分失败语义不变）。
    """
    from app.modules.agent.model import AgentRunLog
    from app.modules.daemon.group.service import (
        CONSENSUS_MEMBER_FAILED,
        CONSENSUS_TASK_ABORTED,
    )

    env = await _make_group_env(db_session)
    env_owner_member = AgentGroupMember(
        group_id=env.group.id,
        member_type="user",
        display_name="群主",
        user_id=env.owner.id,
        invited_by=env.owner.id,
        joined_at=datetime.now(UTC),
    )
    db_session.add(env_owner_member)
    m1, _ = await _make_member(db_session, env.group, name="小码", owner_id=env.owner.id)
    m2, _ = await _make_member(db_session, env.group, name="小测", owner_id=env.owner.id)
    await db_session.commit()

    import app.modules.daemon.group.service as gsvc
    import app.modules.daemon.group.service.messages as messages_module

    async def _redis_ping():
        raise ConnectionError("no redis in test")

    monkeypatch.setattr(gsvc, "get_redis", lambda: SimpleNamespace(ping=_redis_ping))
    monkeypatch.setattr(
        messages_module, "_publish_group_channel_event", AsyncMock(return_value=None)
    )
    # 两个成员触发全失败（AppError 族——gather 部分失败收集，响应恒 200）。
    monkeypatch.setattr(
        GroupChatService,
        "_trigger_member_isolated",
        AsyncMock(side_effect=GroupChatInvalid("机器未授权，成员触发失败。")),
    )

    resp = await GroupChatService(db_session).send_group_message(
        env.group.id,
        env.owner,
        content=f"@{m1.display_name} @{m2.display_name} 讨论一下失败登记",
    )
    assert resp.consensus_task_id is not None
    assert len(resp.triggered) == 2
    assert all(t.error for t in resp.triggered)

    # 独立重读（rollback 清事务态后重查）——aborted 登记、成员态、状态卡
    # 均须已提交（修复前此处 task.status 仍为 OPEN、状态卡无行）。
    await db_session.rollback()
    task = (
        (
            await db_session.execute(
                select(AgentGroupConsensusTask).where(
                    AgentGroupConsensusTask.group_id == env.group.id
                )
            )
        )
        .scalars()
        .one()
    )
    assert task.status == CONSENSUS_TASK_ABORTED
    states = task.members or []
    assert states and all(s.get("state") == CONSENSUS_MEMBER_FAILED for s in states)
    card = (
        (
            await db_session.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == task.carrier_run_id,
                    AgentRunLog.channel == "system",
                )
            )
        )
        .scalars()
        .first()
    )
    assert card is not None
