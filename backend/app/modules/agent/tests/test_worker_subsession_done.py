"""task-07（2026-08-25-team-subsession-governance）：worker_done 端点单测。

design §5.C.2 / FR-04 / D-002@v1——分身显式完成信号（分身受限 MCP server 的
唯一写入落点）：

- 置位 + summary 挂首 run：worker_done_at 置位（可重复置位取最新）；summary 落
  AgentArtifact（kind=summary）挂**首 run**（该子会话下 mission_id=本 mission
  且带 role 的最早 run，design §5.A 双标记锚），经 get_worker_result 既有链路
  可读（零新查询路径）；
- 最后完成分身触发恰好一次主控唤醒（is_worker_complete 单源全完成判定）；
- 追问重开工（新轮 run 无 mission_id）后再次 worker_done——worker_done_at
  刷新、唤醒幂等键经 DEL 后 SETNX 可再次触发（重复完成周期，D-002@v1）；
- 迟到调用（mission 已 converged/cancelled）409 且零写入零唤醒；
- 存量 mission（batch run 形态，无子会话）既有端点与收敛行为零回归（FR-09）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
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
    db: AsyncSession, root: AgentSession, *, worker_done_at: datetime | None = None
) -> AgentSession:
    """建分身子会话（parent 挂根，design §5.A 一层枚举）。"""
    w = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=root.workspace_id,
        parent_session_id=root.id,
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
    """记录操作序列的 Redis 假体（SETNX / DELETE），断言 DEL→SETNX 顺序用。"""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ops: list[tuple[str, str]] = []

    async def set(self, key, val, nx=None, ex=None):
        self.ops.append(("set_nx", key))
        if nx and key in self.store:
            return None
        self.store[key] = val
        return True

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


# ── 2. 追问重开工 → 重复完成周期（DEL 后 SETNX 再唤醒）──────────────────────


class TestRepeatedCompletionCycle:
    @pytest.mark.asyncio
    async def test_rework_cycle_refreshes_and_renotifies_via_del_then_setnx(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """重复完成周期：done → 追问重开工（新轮 run 无 mission_id）→ 干完再
        worker_done——done_at 刷新、唤醒键先 DEL 再 SETNX 二次唤醒主控。

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

        # 第一轮完成 → 唤醒 #1（SETNX 抢到）
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

        # 重开工干完（turn 终态）→ 再次 worker_done → 刷新 + DEL 后 SETNX 再唤醒
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

        # 唤醒 #2 经 DEL → SETNX（键被删后重新抢占）
        assert len(injected) == 2
        ops = fake_redis.ops
        assert ops.count(("set_nx", f"mission:workers_done_notified:{mission.id}")) == 2
        assert ("delete", f"mission:workers_done_notified:{mission.id}") in ops
        # 第二次 set_nx 之前必须先 delete（DEL 重置后 SETNX 才能再次抢占）
        last_set_idx = (
            len(ops)
            - 1
            - ops[::-1].index(("set_nx", f"mission:workers_done_notified:{mission.id}"))
        )
        first_del_idx = ops.index(("delete", f"mission:workers_done_notified:{mission.id}"))
        assert first_del_idx < last_set_idx

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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
