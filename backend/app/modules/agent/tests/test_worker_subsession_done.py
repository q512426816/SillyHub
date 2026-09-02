"""task-07（2026-08-25-team-subsession-governance）：worker_done 端点单测。

design §5.C.2 / FR-04 / D-002@v1——分身显式完成信号（分身受限 MCP server 的
唯一写入落点）：

- 置位 + summary 挂首 run：worker_done_at 置位（可重复置位取最新）；summary 落
  AgentArtifact（kind=summary）挂**首 run**（该子会话下 mission_id=本 mission
  且带 role 的最早 run，design §5.A 双标记锚），经 get_worker_result 既有链路
  可读（零新查询路径）；
- 最后完成分身触发恰好一次主控唤醒（is_worker_complete 单源全完成判定）；
- 追问重开工（新轮 run 无 mission_id）后再次 worker_done——worker_done_at
  刷新、唤醒幂等键经时间戳比较（新波 done_at 严格大于键值 → 覆盖重投）可
  再次触发（重复完成周期，D-002@v1；2026-08-26 审计 F04：替代旧 DEL→SETNX
  两步非原子，同波双完成不再双注入主控）；
- 迟到调用（mission 已 converged/cancelled）409 且零写入零唤醒；
- 存量 mission（batch run 形态，无子会话）既有端点与收敛行为零回归（FR-09）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun, AgentSession
from app.modules.workspace.model import Workspace

# ── 播种 helpers ─────────────────────────────────────────────────────────────


async def _seed_tree(
    db: AsyncSession,
    *,
    converged_at: datetime | None = None,
    cancelled_at: datetime | None = None,
) -> tuple[Workspace, AgentSession, AgentMission]:
    """建 workspace + 主控根会话 + 会话 mission（session_id 落根）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex}",
    )
    db.add(ws)
    await db.commit()

    root = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=ws.id,
    )
    db.add(root)
    await db.commit()

    mission = AgentMission(
        workspace_id=ws.id,
        objective="团队目标",
        session_id=root.id,
        converged_at=converged_at,
        cancelled_at=cancelled_at,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)
    return ws, root, mission


async def _add_worker(
    db: AsyncSession,
    root: AgentSession,
    *,
    worker_done_at: datetime | None = None,
    parent: AgentSession | None = None,
) -> AgentSession:
    """建分身子会话（parent 缺省挂根；传 ``parent`` 建孙层——嵌套逐级回叫
    用例形态，design §5.E 全树口径）。"""
    w = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=root.workspace_id,
        parent_session_id=(parent.id if parent is not None else root.id),
        worker_done_at=worker_done_at,
    )
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


async def _add_run(
    db: AsyncSession,
    *,
    status: str,
    agent_session_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    role: str | None = None,
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role=role,
        objective="o",
        agent_session_id=agent_session_id,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


class _FakeRedis:
    """记录操作序列的 Redis 假体（SETNX / GET / SET 覆盖），断言时间戳比较唤醒序用。

    2026-08-26 审计 F04：唤醒幂等从「DEL → SETNX」改「SETNX + 新波时间戳比较
    （GET 后严格大于才 SET 覆盖）」——假体随之提供 get 与无 nx 的 set（记录为
    ``set_overwrite``），键值即时间戳字符串（notify 内统一格式）。
    """

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ops: list[tuple[str, str]] = []

    async def set(self, key, val, nx=None, ex=None):
        if nx:
            self.ops.append(("set_nx", key))
            if key in self.store:
                return None
        else:
            self.ops.append(("set_overwrite", key))
        self.store[key] = val
        return True

    async def get(self, key):
        return self.store.get(key)

    async def delete(self, *keys):
        for key in keys:
            self.ops.append(("delete", key))
            self.store.pop(key, None)
        return len(keys)


@pytest.fixture()
def notify_env(monkeypatch: pytest.MonkeyPatch):
    """隔离唤醒链依赖：FakeRedis（DEL/SETNX 可观测）+ FakeSessionService（记录注入）。

    返回 (fake_redis, injected)——injected 为 (session_id, prompt) 列表。
    """
    fake_redis = _FakeRedis()
    injected: list[tuple[uuid.UUID, str]] = []

    import app.core.redis as _redis_mod

    monkeypatch.setattr(_redis_mod, "get_redis", lambda: fake_redis)

    import app.modules.daemon.session.service as _svc_mod

    class _FakeSessionService:
        def __init__(self, db) -> None:
            pass

        async def inject_session_as_service(self, session_id, *, prompt):
            injected.append((session_id, prompt))

    monkeypatch.setattr(_svc_mod, "SessionService", _FakeSessionService)
    return fake_redis, injected


# ── 1. 置位 + summary 挂首 run ───────────────────────────────────────────────


class TestWorkerDoneSetsFlagAndSummary:
    @pytest.mark.asyncio
    async def test_sets_flag_summary_on_first_run_and_notifies(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """单分身完成：worker_done_at 置位、summary 挂首 run（get_worker_result
        可读）、恰好一次主控唤醒。"""
        _fake_redis, injected = notify_env
        _ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        first_run = await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=mission.id,
            role="impl",
        )

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/worker_done",
            json={"summary": "发现 X；产出 backend/app/foo.py；无风险"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mission_id"] == str(mission.id)
        assert body["session_id"] == str(worker.id)
        assert body["run_id"] == str(first_run.id)
        assert uuid.UUID(body["artifact_id"])
        assert body["all_workers_done"] is True
        assert body["orchestrator_notified"] is True

        # worker_done_at 置位
        await db_session.refresh(worker)
        assert worker.worker_done_at is not None

        # summary artifact 挂首 run（kind=summary）
        arts = list(
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == first_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(arts) == 1
        assert arts[0].kind == "summary"
        assert arts[0].content_ref == "发现 X；产出 backend/app/foo.py；无风险"

        # 经 get_worker_result 既有链路可读（零新查询路径）
        result = await client.get(
            f"/api/sessions/{root.id}/missions/workers/{first_run.id}/result",
            headers={**auth_headers, "X-Session-Id": str(root.id)},
        )
        assert result.status_code == 200, result.text
        payload = result.json()
        assert payload["worker_id"] == str(first_run.id)
        kinds = [a["kind"] for a in payload["artifacts"]]
        assert "summary" in kinds

        # 恰好一次主控唤醒
        assert len(injected) == 1
        assert injected[0][0] == root.id
        assert "系统通知·团队任务" in injected[0][1]

    @pytest.mark.asyncio
    async def test_last_worker_done_triggers_exactly_one_notify(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """双分身：先完成者不唤醒（all_workers_done=False），最后完成分身触发
        恰好一次唤醒。显式 ws+mid 路由 + X-Session-Id 会话定位。"""
        _fake_redis, injected = notify_env
        ws, root, mission = await _seed_tree(db_session)
        w1 = await _add_worker(db_session, root)
        w2 = await _add_worker(db_session, root)
        for w in (w1, w2):
            await _add_run(
                db_session,
                status="completed",
                agent_session_id=w.id,
                mission_id=mission.id,
                role="impl",
            )

        r1 = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/worker_done",
            json={"summary": "w1 done"},
            headers={**auth_headers, "X-Session-Id": str(w1.id)},
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["all_workers_done"] is False
        assert r1.json()["orchestrator_notified"] is False
        assert injected == []

        r2 = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/worker_done",
            json={"summary": "w2 done"},
            headers={**auth_headers, "X-Session-Id": str(w2.id)},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["all_workers_done"] is True
        assert r2.json()["orchestrator_notified"] is True
        assert len(injected) == 1

    @pytest.mark.asyncio
    async def test_summary_attaches_to_first_run_not_followup(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """追问轮 run（无 mission_id）不挂 summary——首 run=mission_id+role 双标记
        的最早 run。"""
        _fake_redis, _injected = notify_env
        _ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        first_run = await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=mission.id,
            role="impl",
        )
        await _add_run(db_session, status="completed", agent_session_id=worker.id)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/worker_done",
            json={"summary": "rework done"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["run_id"] == str(first_run.id)

        arts = list(
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == first_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(arts) == 1


# ── 2. 追问重开工 → 重复完成周期（时间戳比较新波覆盖重投）───────────────────


class TestRepeatedCompletionCycle:
    @pytest.mark.asyncio
    async def test_rework_cycle_refreshes_and_renotifies_via_timestamp_compare(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """重复完成周期：done → 追问重开工（新轮 run 无 mission_id）→ 干完再
        worker_done——done_at 刷新、唤醒键值（时间戳）被新波覆盖后二次唤醒主控。

        2026-08-26 审计 F04：幂等机制从「DEL → SETNX」改「SETNX + 新波时间戳
        比较」——新波 done_at 严格大于键内时间戳 → SET 覆盖重投；无 DEL。
        header-only 路由（``POST /api/missions/worker_done``）覆盖。
        """
        fake_redis, injected = notify_env
        _ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=mission.id,
            role="impl",
        )

        # 第一轮完成 → 唤醒 #1（SETNX 抢到，键值=本波 done_at 时间戳）
        r1 = await client.post(
            "/api/missions/worker_done",
            json={"summary": "round 1 done"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["orchestrator_notified"] is True
        done_at_1 = datetime.fromisoformat(r1.json()["worker_done_at"])
        assert len(injected) == 1

        # 追问重开工：新轮 run（无 mission_id）先 running 后 completed
        followup = await _add_run(db_session, status="running", agent_session_id=worker.id)
        assert followup.mission_id is None
        followup.status = "completed"
        db_session.add(followup)
        await db_session.commit()

        # 重开工干完（turn 终态）→ 再次 worker_done → 刷新 + 时间戳覆盖再唤醒
        r2 = await client.post(
            "/api/missions/worker_done",
            json={"summary": "round 2 done"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["all_workers_done"] is True
        assert body["orchestrator_notified"] is True
        done_at_2 = datetime.fromisoformat(body["worker_done_at"])
        assert done_at_2 > done_at_1, "worker_done_at 应刷新为更新的时间"

        # 唤醒 #2 经 SETNX 失败 → GET 比较（新波 done_at 更大）→ SET 覆盖；无 DEL
        assert len(injected) == 2
        key = f"mission:workers_done_notified:{mission.id}"
        ops = fake_redis.ops
        assert ops.count(("set_nx", key)) == 2  # 两波各一次 SETNX 尝试
        assert ops.count(("set_overwrite", key)) == 1  # 第二波覆盖重投
        assert ("delete", key) not in ops  # F04：不再 DEL
        # 键值即时间戳（可比较），且第二波覆盖后为更大值
        assert float(fake_redis.store[key]) > done_at_1.timestamp() - 1
        # 覆盖发生在第二波 set_nx 之后（SETNX 失败才比较覆盖）
        assert ops.index(("set_overwrite", key)) > ops.index(("set_nx", key))

        # summary 两轮各落一条（均挂首 run）
        first_run_id = uuid.UUID(body["run_id"])
        arts = list(
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == first_run_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(arts) == 2  # 两轮完成信号各落一条（均挂首 run）

    @pytest.mark.asyncio
    async def test_done_during_active_turn_does_not_notify(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """重开工 turn 进行中（活跃 run）调 worker_done：置位与 summary 照常写，
        但全完成判定为 False → 不唤醒（该轮结束的唤醒归 lease 完成路径，task-09）。"""
        _fake_redis, injected = notify_env
        _ws, root, _mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=_mission.id,
            role="impl",
        )
        await _add_run(db_session, status="running", agent_session_id=worker.id)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/worker_done",
            json={"summary": "mid-turn"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["all_workers_done"] is False
        assert resp.json()["orchestrator_notified"] is False
        await db_session.refresh(worker)
        assert worker.worker_done_at is not None
        assert injected == []

    @pytest.mark.asyncio
    async def test_redundant_done_without_new_turn_does_not_renotify(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """无新 turn 的重复 worker_done（非重开工周期）不重复唤醒——DEL 只服务
        重开工重复完成周期，冗余信号不烧主控 token。"""
        _fake_redis, injected = notify_env
        _ws, root, _mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=_mission.id,
            role="impl",
        )

        for _ in range(2):
            resp = await client.post(
                f"/api/sessions/{worker.id}/missions/worker_done",
                json={"summary": "dup"},
                headers={**auth_headers, "X-Session-Id": str(worker.id)},
            )
            assert resp.status_code == 200, resp.text
        # 第二次为冗余信号（old_done_at 已晚于全部 run 创建时间）→ 不再唤醒
        assert len(injected) == 1


# ── 3. 迟到调用 409（零写入）────────────────────────────────────────────────


class TestLateArrivalRejected:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal_field", ["converged_at", "cancelled_at"])
    async def test_late_worker_done_409_zero_writes(
        self, client, db_session, auth_headers, notify_env, terminal_field: str
    ) -> None:
        """mission 已 converged/cancelled 的迟到调用 → 409、零状态变更、不唤醒。"""
        _fake_redis, injected = notify_env
        ts = datetime.now(UTC)
        kwargs = {terminal_field: ts}
        _ws, root, mission = await _seed_tree(db_session, **kwargs)
        worker = await _add_worker(db_session, root)
        first_run = await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=mission.id,
            role="impl",
        )

        resp = await client.post(
            f"/api/missions/{mission.id}/worker_done",
            json={"summary": "late"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 409, resp.text
        assert "已收敛" in resp.json()["message"] or "已取消" in resp.json()["message"]

        # 零写入：worker_done_at 未置位、无 artifact、零唤醒、零 Redis 操作
        await db_session.refresh(worker)
        assert worker.worker_done_at is None
        arts = list(
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == first_run.id)
                )
            )
            .scalars()
            .all()
        )
        assert arts == []
        assert injected == []
        assert _fake_redis.ops == []


# ── 4. 存量形态回归（FR-09）─────────────────────────────────────────────────


class TestLegacyBatchFormRegression:
    @pytest.mark.asyncio
    async def test_legacy_mission_worker_done_refused_and_flow_intact(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """存量 mission（batch run 形态，无子会话）：worker_done 拒绝（调用会话
        非分身子会话）零写入；converge busy / list_workers 既有行为零回归。"""
        _fake_redis, injected = notify_env
        ws, root, mission = await _seed_tree(db_session)
        # 存量分身 run：mission_id 直挂、非子会话
        legacy_worker = await _add_run(
            db_session, status="running", mission_id=mission.id, role="arch"
        )

        # 主控根会话调 worker_done → 非分身子会话，拒绝且零写入
        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/worker_done",
            json={"summary": "x"},
            headers={**auth_headers, "X-Session-Id": str(root.id)},
        )
        assert resp.status_code == 422, resp.text
        await db_session.refresh(root)
        assert root.worker_done_at is None
        assert injected == []

        # converge busy 前置不变（活跃存量分身 run → 引导等待）
        converge = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/converge",
            headers=auth_headers,
        )
        assert converge.status_code == 200, converge.text
        assert converge.json()["status"] == "busy"

        # list_workers 列 run 状态不变
        listed = await client.get(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
            headers=auth_headers,
        )
        assert listed.status_code == 200, listed.text
        assert [w["id"] for w in listed.json()["workers"]] == [str(legacy_worker.id)]

    @pytest.mark.asyncio
    async def test_session_without_mission_404(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """无 mission 的普通会话调 worker_done → 404。"""
        _fake_redis, injected = notify_env
        ws = Workspace(
            id=uuid.uuid4(),
            name=f"ws-{uuid.uuid4().hex[:8]}",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path=f"/tmp/{uuid.uuid4().hex}",
        )
        db_session.add(ws)
        await db_session.commit()
        plain = AgentSession(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            provider="claude",
            status="active",
            workspace_id=ws.id,
        )
        db_session.add(plain)
        await db_session.commit()

        resp = await client.post(
            "/api/missions/worker_done",
            json={"summary": "x"},
            headers={**auth_headers, "X-Session-Id": str(plain.id)},
        )
        assert resp.status_code == 404, resp.text
        assert injected == []

    @pytest.mark.asyncio
    async def test_missing_session_header_400(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """header-only 路由缺 X-Session-Id → 400（worker_done 必须由分身会话发起）。"""
        resp = await client.post(
            "/api/missions/worker_done",
            json={"summary": "x"},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text

    @pytest.mark.asyncio
    async def test_worker_done_without_first_run_404(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """分身子会话缺首 run（派发链路异常）→ fail-loud 404 零写入。"""
        _fake_redis, _injected = notify_env
        _ws, root, _mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/worker_done",
            json={"summary": "x"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 404, resp.text
        await db_session.refresh(worker)
        assert worker.worker_done_at is None


# ═════════════════════════════════════════════════════════════════════════════
# 2026-08-26 审计修复 F04 守护测试（docs/qa/subsession-backend-audit-2026-08-26.md
# §A.5-1）：同波双完成竞态——两个「最后完成」分身并发（各自 all_done 判定都过、
# 都是新信号）时，二者算得的 signal_at（本波 done_at 最大值）必然相同（任一
# 判定方都必须读到对方已提交的 done_at）→ notify 侧时间戳比较（相等不覆盖）
# 恰好一次注入；旧「DEL → SETNX」两步非原子会双双成功 → 主控双唤醒。
# ═════════════════════════════════════════════════════════════════════════════


class TestSameWaveDoubleSignalRace:
    @pytest.mark.asyncio
    async def test_same_wave_equal_signals_inject_exactly_once(
        self, db_session, notify_env
    ) -> None:
        """同波等 signal_at 双触发 → 恰好一次注入（时间戳比较相等不覆盖）。"""
        _fake_redis, injected = notify_env
        from app.modules.agent.mission_context import notify_orchestrator_workers_done

        mission_id = uuid.uuid4()
        root_id = uuid.uuid4()
        signal = datetime.now(UTC)
        results = await asyncio.gather(
            notify_orchestrator_workers_done(
                mission_id, root_id, completed=2, failed=0, signal_at=signal
            ),
            notify_orchestrator_workers_done(
                mission_id, root_id, completed=2, failed=0, signal_at=signal
            ),
        )
        assert results.count(True) == 1, f"同波双信号只允许一次注入，实际 {results}"
        assert len(injected) == 1

        # 相同 signal_at 的第三次触发（迟到的并发副本）仍被挡。
        again = await notify_orchestrator_workers_done(
            mission_id, root_id, completed=2, failed=0, signal_at=signal
        )
        assert again is False
        assert len(injected) == 1

    @pytest.mark.asyncio
    async def test_newer_signal_wave_renotifies(self, db_session, notify_env) -> None:
        """重开工新波（signal_at 严格更大）→ 覆盖键值重投；兜底触发（无
        signal_at）维持 SETNX「至多一次」。"""
        fake_redis, injected = notify_env
        from app.modules.agent.mission_context import notify_orchestrator_workers_done

        mission_id = uuid.uuid4()
        root_id = uuid.uuid4()
        wave1 = datetime.now(UTC)
        assert (
            await notify_orchestrator_workers_done(
                mission_id, root_id, completed=1, failed=0, signal_at=wave1
            )
            is True
        )
        # 兜底触发（patrol / lease 钩子形态，无 signal_at）：键已占 → False。
        assert (
            await notify_orchestrator_workers_done(mission_id, root_id, completed=1, failed=0)
            is False
        )
        # 新波 done_at 严格大于键内时间戳 → 覆盖重投。
        wave2 = wave1 + timedelta(seconds=30)
        assert (
            await notify_orchestrator_workers_done(
                mission_id, root_id, completed=1, failed=0, signal_at=wave2
            )
            is True
        )
        assert len(injected) == 2
        key = f"mission:workers_done_notified:{mission_id}"
        assert float(fake_redis.store[key]) == pytest.approx(wave2.timestamp(), abs=1e-3)


class TestNestedChildWake:
    """嵌套逐级回叫（生产 ee24ba15 死锁补口）：孙 worker_done → 唤醒直接父
    （中间层分身）——父空闲未 done 时注入「子分身完成」通知，父在轮内/已
    done/根直接子形态不注入；幂等父×子粒度（同波重复 done 不双注入）。"""

    async def _seed_nested(
        self, db_session: AsyncSession
    ) -> tuple[AgentSession, AgentSession, AgentSession, AgentMission]:
        """根 + 中间层分身（空闲未 done，首 run 已终态）+ 孙（首 run 已终态）。"""
        _ws, root, mission = await _seed_tree(db_session)
        mid = await _add_worker(db_session, root)
        grand = await _add_worker(db_session, root, parent=mid)
        await _add_run(
            db_session,
            status="completed",
            agent_session_id=mid.id,
            mission_id=mission.id,
            role="impl",
        )
        await _add_run(
            db_session,
            status="completed",
            agent_session_id=grand.id,
            mission_id=mission.id,
            role="impl",
        )
        return root, mid, grand, mission

    @pytest.mark.asyncio
    async def test_grandchild_done_wakes_idle_parent_not_root(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """孙完成：中间层父空闲未 done → 注入父唤醒；全树未完成（父未 done）
        → 根不通知（orchestrator_notified False 且无 root 注入）。"""
        _fake_redis, injected = notify_env
        root, mid, grand, _mission = await self._seed_nested(db_session)

        resp = await client.post(
            f"/api/sessions/{grand.id}/missions/worker_done",
            json={"summary": "孙产出"},
            headers={**auth_headers, "X-Session-Id": str(grand.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["all_workers_done"] is False
        assert resp.json()["orchestrator_notified"] is False

        wakes = [(sid, p) for sid, p in injected if sid == mid.id]
        assert len(wakes) == 1, "空闲中间层父必须被回叫（死锁主修复）"
        assert "子分身完成" in wakes[0][1]
        assert all(sid != root.id for sid, _ in injected), "全树未完成不得通知根"

    @pytest.mark.asyncio
    async def test_parent_with_active_turn_not_woken(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """父在轮内（有活跃 run）→ 不打扰（父可自查 list_workers）。"""
        _fake_redis, injected = notify_env
        _root, mid, grand, _mission = await self._seed_nested(db_session)
        await _add_run(db_session, status="running", agent_session_id=mid.id)

        resp = await client.post(
            f"/api/sessions/{grand.id}/missions/worker_done",
            json={"summary": "孙产出"},
            headers={**auth_headers, "X-Session-Id": str(grand.id)},
        )
        assert resp.status_code == 200, resp.text
        assert injected == [], "父活跃 turn 不注入；全树未完成也不通知根"

    @pytest.mark.asyncio
    async def test_parent_already_done_wakes_root_instead(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """父已 done（孙补完即全树完成）→ 不回叫父、按既有链路通知根。"""
        _fake_redis, injected = notify_env
        root, mid, grand, _mission = await self._seed_nested(db_session)
        await db_session.execute(
            update(AgentSession)
            .where(AgentSession.id == mid.id)
            .values(worker_done_at=datetime.now(UTC))
        )
        await db_session.commit()

        resp = await client.post(
            f"/api/sessions/{grand.id}/missions/worker_done",
            json={"summary": "孙产出"},
            headers={**auth_headers, "X-Session-Id": str(grand.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["all_workers_done"] is True
        assert resp.json()["orchestrator_notified"] is True
        assert injected and injected[0][0] == root.id
        assert all(sid != mid.id for sid, _ in injected), "已 done 父不再回叫"

    @pytest.mark.asyncio
    async def test_direct_child_done_does_not_wake_root_as_parent(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """根的直接子完成：parent == mission.session_id → 走「通知根」既有链路，
        不把根当「中间层父」重复注入。"""
        _fake_redis, injected = notify_env
        _ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        await _add_run(
            db_session,
            status="completed",
            agent_session_id=worker.id,
            mission_id=mission.id,
            role="impl",
        )

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/worker_done",
            json={"summary": "产出"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["orchestrator_notified"] is True
        # 仅一次注入且目标是根（既有链路），无第二条「子分身完成」注入。
        assert len(injected) == 1 and injected[0][0] == root.id
        assert "团队任务" in injected[0][1]

    @pytest.mark.asyncio
    async def test_redundant_grandchild_done_wakes_parent_once(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """同波冗余 done（无新 turn）不重复回叫父（is_new_signal + SETNX 双挡）。"""
        _fake_redis, injected = notify_env
        _root, mid, grand, _mission = await self._seed_nested(db_session)

        for _ in range(2):
            resp = await client.post(
                f"/api/sessions/{grand.id}/missions/worker_done",
                json={"summary": "孙产出"},
                headers={**auth_headers, "X-Session-Id": str(grand.id)},
            )
            assert resp.status_code == 200, resp.text

        wakes = [sid for sid, _ in injected if sid == mid.id]
        assert wakes == [mid.id], "同一完成波次父只被回叫一次"

    @pytest.mark.asyncio
    async def test_grandchild_rework_second_wave_rewakes_parent(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """孙重开工后再 done（重复完成周期）→ 新波 done_at 严格大于键内时间戳 →
        覆盖重投，父被二次回叫（ql-20260903-002）。

        修复前嵌套回叫键是常量值 "1" 纯 SETNX 无波次语义：孙重开工第二波被
        第一波的键挡死 6h → 父永不再被唤醒 → 全树恒未完成，父只能等 patrol
        30 分钟宽限后强收、孙重开工产出被丢弃（ee24ba15 同型死锁在受支持的
        追问重开工流程里复发）。修复对齐 F04：键值=本波 done_at 时间戳，新波
        严格大于才覆盖重投；同波冗余（上一用例）仍恰好一次。
        """
        fake_redis, injected = notify_env
        _root, mid, grand, _mission = await self._seed_nested(db_session)

        # 第一波：孙完成 → 父唤醒 #1（SETNX 抢到，键值=本波 done_at 时间戳）
        r1 = await client.post(
            f"/api/sessions/{grand.id}/missions/worker_done",
            json={"summary": "round 1 done"},
            headers={**auth_headers, "X-Session-Id": str(grand.id)},
        )
        assert r1.status_code == 200, r1.text
        assert [sid for sid, _ in injected if sid == mid.id] == [mid.id]
        done_at_1 = datetime.fromisoformat(r1.json()["worker_done_at"])

        # 父追问重开工：孙新轮 run（无 mission_id）先 running 后 completed
        followup = await _add_run(db_session, status="running", agent_session_id=grand.id)
        assert followup.mission_id is None
        followup.status = "completed"
        db_session.add(followup)
        await db_session.commit()

        # 第二波：重开工干完再 done → 新波时间戳覆盖键值 → 父唤醒 #2
        r2 = await client.post(
            f"/api/sessions/{grand.id}/missions/worker_done",
            json={"summary": "round 2 done"},
            headers={**auth_headers, "X-Session-Id": str(grand.id)},
        )
        assert r2.status_code == 200, r2.text
        done_at_2 = datetime.fromisoformat(r2.json()["worker_done_at"])
        assert done_at_2 > done_at_1, "worker_done_at 应刷新为更新的时间"

        wakes = [sid for sid, _ in injected if sid == mid.id]
        assert wakes == [mid.id, mid.id], "重开工新波必须再次唤醒父（死锁复发主修复）"

        # Redis 操作序：两波各一次 SETNX 尝试，第二波 SETNX 失败后 GET 比较
        # （新波更大）→ SET 覆盖重投；全程无 DEL。
        key = f"mission:child_wake:{mid.id}:{grand.id}"
        ops = fake_redis.ops
        assert ops.count(("set_nx", key)) == 2
        assert ops.count(("set_overwrite", key)) == 1
        assert ("delete", key) not in ops
        assert float(fake_redis.store[key]) > done_at_1.timestamp() - 1
        assert ops.index(("set_overwrite", key)) > ops.index(("set_nx", key))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
