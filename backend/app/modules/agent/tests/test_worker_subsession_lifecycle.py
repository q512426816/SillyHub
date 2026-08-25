"""task-15（2026-08-25-team-subsession-governance）：分身子会话生命周期闭环集成。

单条链路把 task-01~task-13 的各段按生命周期契约表（design §5.D）串起来：

派发（dispatch_worker 子会话三元组）→ 首轮完成（run 终态 ≠ 分身完成）→
worker_done（全完成 + 主控唤醒 #1）→ 追问重开工（is_worker_complete 回未完成、
mission_derive_status 回 running、converge busy 不误判完成且不删副本）→
重开工干完再 done（重复完成周期，DEL→SETNX 二次唤醒）→ converge 收口
（converged 置位 + 子会话 ended + interactive lease completed + SESSION_END
下发 + worktree 副本清理）。

与分件单测的分工：test_worker_subsession_dispatch（三元组派发）/ _done
（worker_done 端点语义）/ _converge_close（收口分支矩阵）/ _status（判据替换
单点）/ _patrol_orphan（孤儿补收口）各自钉死单点行为，本文件只验**组合时序**——
同一 mission 同一分身在生命周期各时点的状态迁移与判据联动（FR-01~FR-06 验收
串测，plan 全局验收标准 2/3）。

测试隔离：worktree/merge 走假 delegate；worker_done 唤醒链用 FakeRedis +
FakeSessionService（converge 前恢复真实 SessionService 走 end_session 真实链）；
WS 下发录音 hub；GLM 隔离零网络。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MISSION_WORKER_STAGE
from app.modules.agent.mission import is_worker_complete, mission_derive_status
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END
from app.modules.workspace.model import Workspace

_TS = "2026-08-25T00:00:00+00:00"


# ---------------------------------------------------------------------------
# 播种与隔离 helpers
# ---------------------------------------------------------------------------


async def _make_user(db: AsyncSession) -> uuid.UUID:
    uid = uuid.uuid4()
    db.add(
        User(
            id=uid,
            email=f"lc-{uid.hex[:10]}@example.com",
            password_hash="x",
            display_name="lc",
            status="active",
        )
    )
    await db.commit()
    return uid


async def _stub_online_runtime(
    db: AsyncSession, *, user_id: uuid.UUID, provider: str = "claude"
) -> dict:
    """造一台在线机器（instance online + runtime online，归 user）。"""
    from sqlalchemy import text

    di_id = uuid.uuid4()
    rt_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO daemon_instances (id, user_id, hostname, server_url, allowed_roots, status, created_at, updated_at)"
            " VALUES (:id, :uid, 'h1', 'http://t', '[\"~/.sillyhub\"]', 'online', :ts, :ts)"
        ),
        {"id": di_id.hex, "uid": user_id.hex, "ts": _TS},
    )
    await db.execute(
        text(
            "INSERT INTO daemon_runtimes (id, user_id, daemon_instance_id, provider, status, last_heartbeat_at, created_at, updated_at)"
            " VALUES (:id, :uid, :di, :prov, 'online', :ts, :ts, :ts)"
        ),
        {"id": rt_id.hex, "uid": user_id.hex, "di": di_id.hex, "prov": provider, "ts": _TS},
    )
    await db.commit()
    return {"runtime_id": rt_id, "daemon_id": di_id}


async def _stub_member_binding(
    db: AsyncSession, ws_id: uuid.UUID, user_id: uuid.UUID, daemon_id: uuid.UUID
) -> None:
    """工作区成员机器绑定行（派发前在线绑定预检 + 代表解析用）。"""
    from sqlalchemy import text

    await db.execute(
        text(
            "INSERT INTO workspace_member_runtimes (workspace_id, user_id, root_path, path_source, daemon_id, shared, created_at, updated_at)"
            " VALUES (:wid, :uid, '/tmp/w', 'manual', :di, false, :ts, :ts)"
        ),
        {"wid": ws_id.hex, "uid": user_id.hex, "di": daemon_id.hex, "ts": _TS},
    )
    await db.commit()


def _fake_delegate() -> MagicMock:
    """HostFsDelegate mock：probe 恒 git；worktree add/remove 恒 ok；merge 记录调用。"""
    delegate: MagicMock = MagicMock()
    delegate.probe_workspace_git_mode = AsyncMock(return_value="git")
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": True, "worktree_path": None, "error": None}
    )
    delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})

    async def _git_merge(workspace, *, worker_branch):
        delegate.merge_calls.append((workspace.id, worker_branch))
        return {"ok": True, "conflicts": [], "merged_files": [], "error": None}

    delegate.git_merge = _git_merge
    delegate.merge_calls = []
    return delegate


def _recording_ws_hub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any, str, dict]]:
    """把 ws_hub 换成录音 hub，捕获全部 WS 下发（同 converge_close 测试模式）。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    captured: list[tuple[str, Any, str, dict]] = []

    class _RecordingHub:
        def is_connected(self, daemon_id):
            return True  # SESSION_END / 唤醒下发走录音分支

        async def send_session_control(self, daemon_id, msg_type, payload):
            captured.append(("session_control", daemon_id, msg_type, payload))
            return True

        async def send_wakeup(self, daemon_id, **kwargs):
            captured.append(("wakeup", daemon_id, "", kwargs))
            return True

        async def send_to_runtime(self, daemon_id, message):
            captured.append(("to_runtime", daemon_id, message))
            return True

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())
    return captured


def _isolate_glm(monkeypatch: pytest.MonkeyPatch) -> None:
    """GLM 隔离（对齐 test_integration_cross_workspace._isolate_glm）——converge
    的 ``GLMConfig.from_env`` 在宿主 shell 设有 ANTHROPIC_* 时会向真实 LLM 网关
    发 HTTP，patch 源 module 使 from_env 返 None 走确定性回退，零网络。"""
    from app.modules.agent import delegation

    class _FakeGLMConfig:
        @staticmethod
        def from_env():
            return None

    monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)


class _FakeRedis:
    """记录操作序列的 Redis 假体（SETNX / DELETE），唤醒幂等键断言用。"""

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


def _lease_meta(lease: DaemonTaskLease) -> dict:
    raw = lease.metadata_
    if isinstance(raw, str):
        import json

        return json.loads(raw)
    return dict(raw or {})


async def _seed_root(
    db: AsyncSession,
) -> tuple[Workspace, AgentSession, AgentMission, AgentRun, uuid.UUID, dict]:
    """owner + ws + 主控根会话 + 会话 mission（created_by=owner）+ orchestrator
    锚点 run + owner 自有在线 runtime + 成员绑定（dispatch 全链路可走真实
    prepare_interactive_dispatch）。"""
    owner_id = await _make_user(db)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_branch="main",
        default_agent="claude",
        status="active",
    )
    db.add(ws)
    root = AgentSession(user_id=owner_id, provider="claude", status="active", workspace_id=ws.id)
    db.add(root)
    await db.flush()
    mission = AgentMission(
        workspace_id=ws.id,
        objective="生命周期闭环",
        session_id=root.id,
        created_by=owner_id,
        constraints={"mode": "team"},
    )
    db.add(mission)
    anchor = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        status="completed",
        role="orchestrator",
        agent_session_id=root.id,
        objective="主控",
    )
    db.add(anchor)
    await db.commit()
    await db.refresh(mission)
    own_rt = await _stub_online_runtime(db, user_id=owner_id)
    await _stub_member_binding(db, ws.id, owner_id, own_rt["daemon_id"])
    return ws, root, mission, anchor, owner_id, own_rt


# ---------------------------------------------------------------------------
# 生命周期闭环
# ---------------------------------------------------------------------------


class TestWorkerSubsessionLifecycle:
    @pytest.mark.asyncio
    async def test_dispatch_first_round_rework_redone_converge(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """派发 → 首轮完成 → done → 追问重开工（busy 不误判）→ 再 done →
        converge 收口（子会话 ended + lease completed + SESSION_END + 副本清理）。"""
        ws, root, mission, _anchor, owner_id, own_rt = await _seed_root(db_session)

        fake_redis = _FakeRedis()
        injected: list[tuple[uuid.UUID, str]] = []
        import app.core.redis as _redis_mod

        monkeypatch.setattr(_redis_mod, "get_redis", lambda: fake_redis)
        # worker_done 唤醒链隔离（FakeSessionService 记录注入）；converge 前恢复
        # 真实 SessionService——end_session 收口要走真实链（lease completed/WS）。
        import app.modules.daemon.session.service as _svc_mod

        real_session_service = _svc_mod.SessionService

        class _FakeSessionService:
            def __init__(self, db) -> None:
                pass

            async def inject_session_as_service(self, session_id, *, prompt):
                injected.append((session_id, prompt))

        monkeypatch.setattr(_svc_mod, "SessionService", _FakeSessionService)

        delegate = _fake_delegate()
        monkeypatch.setattr("app.modules.agent.mcp_tools.new_host_fs_delegate", lambda _s: delegate)
        monkeypatch.setattr("app.modules.agent.finalizer.new_host_fs_delegate", lambda _s: delegate)
        captured = _recording_ws_hub(monkeypatch)
        _isolate_glm(monkeypatch)

        # ── 1) 派发：子会话三元组（parent/owner/lease stage/首 run 双标记）──
        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "首轮实现", "role": "impl"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        dispatch_data = resp.json()
        assert dispatch_data["status"] == "pending"

        sub = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == root.id)
                )
            )
            .scalars()
            .one()
        )
        assert sub.user_id == owner_id  # FR-07 归属 = mission 创建者
        assert sub.status == "active"
        assert sub.runtime_id == own_rt["runtime_id"]
        lease = await db_session.get(DaemonTaskLease, sub.lease_id)
        assert lease is not None and lease.kind == "interactive"
        assert _lease_meta(lease)["stage"] == MISSION_WORKER_STAGE
        first_run = await db_session.get(AgentRun, uuid.UUID(dispatch_data["id"]))
        assert first_run is not None
        assert first_run.agent_session_id == sub.id
        assert first_run.role == "impl"
        assert first_run.worktree_branch == f"workers/{str(first_run.id)[:8]}"

        # idle 未 done：判据替换（FR-05）——分身不因首 run pending 被误判完成
        assert await is_worker_complete(db_session, sub) is False
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "running"

        # ── 2) 首轮完成（daemon 回报终态）──
        first_run.status = "completed"
        first_run.finished_at = datetime.now(UTC)
        first_run.diff_summary = "diff --git a/x b/x\n+pass"
        db_session.add(first_run)
        await db_session.commit()

        # 首 run 终态 ≠ 分身完成（worker_done_at 才是完成信号，D-002@v1）
        await db_session.refresh(sub)
        assert await is_worker_complete(db_session, sub) is False
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "running"

        # ── 3) worker_done：全完成 + 主控唤醒 #1 ──
        r1 = await client.post(
            f"/api/sessions/{sub.id}/missions/worker_done",
            json={"summary": "首轮完成：产出 backend/app/foo.py"},
            headers={**auth_headers, "X-Session-Id": str(sub.id)},
        )
        assert r1.status_code == 200, r1.text
        assert r1.json()["all_workers_done"] is True
        assert r1.json()["orchestrator_notified"] is True
        # 端点另会话提交，refresh 后再断言（identity map 不自动刷新）
        await db_session.refresh(sub)
        assert sub.worker_done_at is not None
        # 会话 mission 分身全完成 + 主控空档 → awaiting_input 档（_converge_core
        # 的 should_converge 含该档：分身全完成即可收敛）
        assert (
            await mission_derive_status(db_session, mission.id, workers_only=True)
            == "awaiting_input"
        )
        assert len(injected) == 1 and injected[0][0] == root.id

        # ── 4) 追问重开工：回未完成 + converge busy 不误判完成 ──
        followup = AgentRun(
            agent_type="claude_code",
            status="running",
            agent_session_id=sub.id,
            objective="追问补充",
        )
        db_session.add(followup)
        await db_session.commit()

        await db_session.refresh(sub)
        assert await is_worker_complete(db_session, sub) is False
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "running"
        busy = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/converge",
            headers=auth_headers,
        )
        assert busy.status_code == 200, busy.text
        assert busy.json()["status"] == "busy"
        assert busy.json()["converged"] is False
        await db_session.refresh(mission)
        assert mission.converged_at is None
        # 不删未完成分身 worktree（FR-05 验收：副本保留供后续轮次）
        assert delegate.git_worktree_remove.await_count == 0
        assert delegate.merge_calls == []

        # ── 5) 重开工干完 → 再 done（重复完成周期，DEL→SETNX 二次唤醒）──
        followup_run = await db_session.get(AgentRun, followup.id)
        assert followup_run is not None
        followup_run.status = "completed"
        followup_run.finished_at = datetime.now(UTC)
        db_session.add(followup_run)
        await db_session.commit()

        r2 = await client.post(
            f"/api/sessions/{sub.id}/missions/worker_done",
            json={"summary": "二轮完成：追问已补充"},
            headers={**auth_headers, "X-Session-Id": str(sub.id)},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["all_workers_done"] is True
        assert r2.json()["orchestrator_notified"] is True
        notify_key = f"mission:workers_done_notified:{mission.id}"
        assert fake_redis.ops.count(("set_nx", notify_key)) == 2
        assert ("delete", notify_key) in fake_redis.ops
        assert len(injected) == 2
        await db_session.refresh(sub)
        assert (
            await mission_derive_status(db_session, mission.id, workers_only=True)
            == "awaiting_input"
        )

        # ── 6) converge 收口：converged + 子会话 ended + lease completed ──
        monkeypatch.setattr(_svc_mod, "SessionService", real_session_service)
        conv = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/converge",
            headers=auth_headers,
        )
        assert conv.status_code == 200, conv.text
        conv_body = conv.json()
        assert conv_body["status"] == "converged"
        assert conv_body["converged"] is True
        assert conv_body["merged_branches"] == [first_run.worktree_branch]

        # merge 单组（anchor ws × 首 run 分支；converge 内部与端点各跑一遍
        # finalize，幂等重试均落同组，对齐 test_integration_cross_workspace 口径）
        assert set(delegate.merge_calls) == {(ws.id, first_run.worktree_branch)}
        # 副本清理：未完成期零清理（上方 busy 段已断言），收口后双路径各清一遍
        # （converge 内部自动收敛 + 端点 merged 分支 _cleanup_mission），幂等重试
        assert delegate.git_worktree_remove.await_count == 2
        assert all(
            c.args[0].id == ws.id
            and c.kwargs["sibling_path"] == f"{ws.root_path}/.worktrees/{str(first_run.id)[:8]}"
            for c in delegate.git_worktree_remove.await_args_list
        )

        await db_session.refresh(mission)
        assert mission.converged_at is not None
        await db_session.refresh(sub)
        assert sub.status == "ended"
        lease_after = await db_session.get(DaemonTaskLease, sub.lease_id)
        assert lease_after is not None
        await db_session.refresh(lease_after)
        assert lease_after.status == "completed"

        # SESSION_END 下发（P0-2 链），payload 携对应 session/lease
        ends = [c[3] for c in captured if c[2] == DAEMON_MSG_SESSION_END]
        assert {p["session_id"] for p in ends} == {str(sub.id)}
        assert {p["lease_id"] for p in ends} == {str(sub.lease_id)}

        # 收口后 mission 状态经 mission_derive_status 落终态档（done 优先于
        # 终态 failed 映射，FR-05）
        assert await mission_derive_status(db_session, mission.id, workers_only=True) == "done"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
