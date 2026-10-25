"""Tests for GET /api/daemon/sessions/{session_id}/git-status（2026-10-21-session-git-branch）.

会话级 git 分支实时查询端点（FR-01/02/03）。覆盖（requirements 测试绑定 +
design 错误面全表）：

- FR-01 主路径：session.cwd → RPC root=cwd → branch 透出；detached 形态
  （detached=true + head_short）；
- FR-02 每请求现查：连续两次请求 → hub 收到两次 git_status（无快照/无缓存）；
- FR-03 空态：无 cwd 且无 workspace → 200 no_root（hub 零调用）；cwd 非 git
  仓库（daemon error 含 "not a git repository"）→ 200 no_git；
- 回退链：cwd 为空 → 成员绑定根 root_path；
- 404：会话不存在 / 跨用户（get_agent_session 属主过滤）；成员未绑定 → 404；
- 403：daemon forbidden（root 越界 allowed_roots）；
- 502：daemon 离线。

造数与 Bearer 手签照 test_session_export.py 先例；FakeHub / 绑定行（含
daemon_instances 真实行，e2b95aad 起 resolver JOIN 过滤幽灵 id）照
git_log/tests/test_router.py 先例。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRuntimeOffline,
)
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.asyncio

# daemon git_status 十四字段契约 fixture（git_log tests _git_status_result 同款）。
_GIT_STATUS_RESULT: dict[str, Any] = {
    "branch": "feature-x",
    "detached": False,
    "upstream": "origin/feature-x",
    "ahead": 1,
    "behind": 0,
    "files_changed": 2,
    "additions": 10,
    "deletions": 4,
    "untracked_count": 1,
    "head_short": "1a2b3c4d",
    "empty": False,
    "fetch_performed": True,
    "fetch_error": None,
    "error": None,
}


class FakeHub:
    """DaemonWsHub 测试替身——记录调用并按 method 分发预设 result/异常。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._handlers: dict[str, tuple[Any, BaseException | None]] = {}

    def on(self, method: str, *, result: Any = None, exc: BaseException | None = None) -> None:
        self._handlers[method] = (result, exc)

    async def send_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {"daemon_id": daemon_id, "method": method, "params": params, "timeout": timeout}
        )
        handler = self._handlers.get(method)
        if handler is None:
            return {}
        result, exc = handler
        if exc is not None:
            raise exc
        return result


async def _create_admin(db_session: AsyncSession) -> tuple[User, str]:
    """platform admin 用户 + 手签 Bearer（自动短路端点 TASK_RUN_AGENT 闸门）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"sgs-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("x"),
        display_name="sgs",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email or "",
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _seed_env(
    db_session: AsyncSession,
    *,
    cwd: str | None = r"C:\repo",
    with_workspace: bool = True,
    with_binding: bool = True,
) -> tuple[AgentSession, str, FakeHub, uuid.UUID]:
    """一键场景：admin 用户 + （可选）工作区 + 绑定行 + AgentSession + 假 hub。

    返回 (session, token, hub, daemon_id)。with_binding=False 时不插
    WorkspaceMemberRuntime/daemon_instances 行（未绑定 404 用例）。
    """
    user, token = await _create_admin(db_session)
    daemon_id = uuid.uuid4()
    hub = FakeHub()

    workspace_id: uuid.UUID | None = None
    if with_workspace:
        ws = Workspace(
            id=uuid.uuid4(),
            name="sgs-ws",
            slug=f"sgs-{uuid.uuid4().hex[:8]}",
            root_path=r"C:\repo",
            status="active",
            created_by=user.id,
        )
        db_session.add(ws)
        await db_session.flush()
        workspace_id = ws.id
        if with_binding:
            hb = datetime.now(UTC)
            from sqlalchemy import text

            await db_session.execute(
                text(
                    "INSERT INTO daemon_instances (id, user_id, hostname, server_url,"
                    " allowed_roots, status, last_heartbeat_at, created_at, updated_at)"
                    " VALUES (:id, :uid, 'sgs-host', 'http://t',"
                    " '[\"C:/\"]', 'online', :hb, :hb, :hb)"
                ),
                {"id": daemon_id.hex, "uid": user.id.hex, "hb": hb},
            )
            db_session.add(
                WorkspaceMemberRuntime(
                    workspace_id=ws.id,
                    user_id=user.id,
                    daemon_id=daemon_id,
                    root_path=r"C:\repo",
                    path_source="daemon-client",
                )
            )

    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user.id,
        runtime_id=None,
        provider="claude",
        status="idle",
        turn_count=0,
        workspace_id=workspace_id,
        cwd=cwd,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess, token, hub, daemon_id


def _url(session_id: uuid.UUID) -> str:
    return f"/api/daemon/sessions/{session_id}/git-status"


def _git_status_calls(hub: FakeHub) -> list[dict[str, Any]]:
    return [c for c in hub.calls if c["method"] == "git_status"]


async def test_git_status_returns_branch_from_session_cwd(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-01 主路径：cwd 指向 worktree → RPC root=cwd（非 workspace 根）→ 分支透出。"""
    sess, token, hub, _daemon_id = await _seed_env(db_session, cwd=r"C:\wt\feature-x")
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["git_mode"] == "git"
    assert body["branch"] == "feature-x"
    assert body["detached"] is False
    assert body["head_short"] == "1a2b3c4d"
    assert body["files_changed"] == 2
    assert body["untracked_count"] == 1
    assert body["root"] == r"C:\wt\feature-x"
    assert body["synced_at"]

    rpc_calls = _git_status_calls(hub)
    assert len(rpc_calls) == 1
    assert rpc_calls[0]["params"] == {"root": r"C:\wt\feature-x"}


async def test_git_status_detached_head(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """FR-01 场景：detached HEAD → detached=true + head_short（branch 兜底 head_short）。"""
    sess, token, hub, _ = await _seed_env(db_session)
    hub.on(
        "git_status",
        result=dict(_GIT_STATUS_RESULT, branch=None, detached=True),
    )
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["detached"] is True
    assert body["head_short"] == "1a2b3c4d"


async def test_git_status_queries_daemon_rpc_per_request_no_snapshot(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-02 每请求现查：连续两次 GET → 两次 git_status RPC（无快照无缓存）。"""
    sess, token, hub, _ = await _seed_env(db_session)
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    for _ in range(2):
        resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, resp.text
    assert len(_git_status_calls(hub)) == 2


async def test_git_status_no_root_and_no_git_empty_states(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-03 空态：① 无 cwd 且无 workspace → 200 no_root（hub 零调用）；
    ② cwd 非 git 仓库（daemon error 含 not a git repository）→ 200 no_git。"""
    # ① no_root
    sess, token, hub, _ = await _seed_env(db_session, cwd=None, with_workspace=False)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["git_mode"] == "no_root"
    assert body["branch"] is None
    assert len(hub.calls) == 0

    # ② no_git（cwd 有值但 daemon 报非 git 仓库）
    sess2, token2, hub2, _ = await _seed_env(db_session, cwd=r"C:\plain-dir")
    hub2.on(
        "git_status",
        result=dict(
            _GIT_STATUS_RESULT,
            branch=None,
            error="fatal: not a git repository (or any of the parent directories): .git",
        ),
    )
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub2)
    resp2 = await client.get(_url(sess2.id), headers={"Authorization": f"Bearer {token2}"})
    assert resp2.status_code == 200, resp2.text
    body2 = resp2.json()
    assert body2["git_mode"] == "no_git"
    assert body2["branch"] is None


async def test_git_status_fallback_to_binding_root_when_no_cwd(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """回退链：cwd 为空 → RPC root=成员绑定行 root_path（git_log 同语义）。"""
    sess, token, hub, _ = await _seed_env(db_session, cwd=None)
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    rpc_calls = _git_status_calls(hub)
    assert len(rpc_calls) == 1
    assert rpc_calls[0]["params"] == {"root": r"C:\repo"}


async def test_git_status_not_found_variants(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """404 族：① 不存在的 session id；② 跨用户会话（属主过滤不泄露存在性）。"""
    sess, token, hub, _ = await _seed_env(db_session)
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(uuid.uuid4()), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404, resp.text

    _stranger, stranger_token = await _create_admin(db_session)
    resp_owner = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp_owner.status_code == 200, resp_owner.text  # 属主本人仍可查（对照组）
    # 跨用户：stranger 查属主会话 → 404 不泄露存在性
    resp3 = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {stranger_token}"})
    assert resp3.status_code == 404, resp3.text


async def test_git_status_not_bound_404(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """有 workspace 但成员未绑定 daemon → 404（SessionGitNotBound）。"""
    sess, token, hub, _ = await _seed_env(db_session, with_binding=False)
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404, resp.text
    assert len(hub.calls) == 0


async def test_git_status_forbidden_403(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """daemon forbidden（root 越界 allowed_roots，如 worktree 未入白名单）→ 403。"""
    sess, token, hub, _ = await _seed_env(db_session, cwd=r"C:\outside-wt")
    hub.on(
        "git_status",
        exc=DaemonRpcRemoteError({"code": "forbidden", "message": "outside allowed roots"}),
    )
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, resp.text


async def test_git_status_offline_502(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """daemon 离线 → 502。"""
    sess, token, hub, _ = await _seed_env(db_session)
    hub.on(
        "git_status",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 502, resp.text


async def test_git_status_other_daemon_error_502(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """daemon error 非空且非 not-a-git-repo（真采集失败）→ 502（不静默成空态）。"""
    sess, token, hub, _ = await _seed_env(db_session)
    hub.on(
        "git_status",
        result=dict(_GIT_STATUS_RESULT, branch=None, error="git status failed: corrupted"),
    )
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 502, resp.text


async def test_openapi_lists_session_git_status_path():
    """openapi 出现新端点路径（gen:types 前置）。"""
    from app.main import app

    paths = app.openapi()["paths"]
    assert "/api/daemon/sessions/{session_id}/git-status" in paths


# ── 2026-10-25-session-git-worktree-root：工作树探测层 ──────────────────────


async def _seed_change(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    change_key: str,
) -> uuid.UUID:
    """造 Change 行（change_key 即 sillyspec change 名；location/path 必填）。"""
    from app.modules.change.model import Change

    change_id = uuid.uuid4()
    db_session.add(
        Change(
            id=change_id,
            workspace_id=workspace_id,
            change_key=change_key,
            title="工作树探测测试变更",
            status="active",
            location="active",
            path=f".sillyspec/changes/{change_key}",
        )
    )
    await db_session.commit()
    return change_id


async def _seed_env_with_change(
    db_session: AsyncSession,
    *,
    cwd: str | None = r"C:\repo",
    with_change: bool = True,
) -> tuple[AgentSession, str, FakeHub]:
    """带 current_change_id 锚的场景（change_key=2026-10-25-wt-demo）。"""
    sess, token, hub, _ = await _seed_env(db_session, cwd=cwd)
    if with_change:
        change_id = await _seed_change(
            db_session, workspace_id=sess.workspace_id, change_key="2026-10-25-wt-demo"
        )
        sess.current_change_id = change_id
        db_session.add(sess)
        await db_session.commit()
        await db_session.refresh(sess)
    return sess, token, hub


async def test_git_status_prefers_active_sillyspec_worktree(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-01：current_change_id 有活跃工作树（stat 命中）→ root=工作树路径、
    root_source=worktree、git_status RPC 按工作树采集（优先于 cwd 主仓快照）。"""
    sess, token, hub = await _seed_env_with_change(db_session, cwd=r"C:\repo")
    # 探测层拼接形态：绑定根（Windows 反斜杠原样）+ 正斜杠相对段（_probe_worktree
    # 以 "/" 连接，daemon pathResolve 容忍混合分隔符）。
    wt_path = r"C:\repo" + "/.sillyspec/.runtime/worktrees/2026-10-25-wt-demo"
    hub.on("host_fs.stat", result={"exists": True, "is_dir": False, "size": 1})
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT, branch="wt-branch"))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["root_source"] == "worktree"
    assert body["root"] == wt_path
    assert body["branch"] == "wt-branch"

    stat_calls = [c for c in hub.calls if c["method"] == "host_fs.stat"]
    assert len(stat_calls) == 1
    assert stat_calls[0]["params"] == {"path": wt_path + "/.git"}
    rpc_calls = _git_status_calls(hub)
    assert len(rpc_calls) == 1
    assert rpc_calls[0]["params"] == {"root": wt_path}


async def test_git_status_worktree_probe_miss_falls_back_to_cwd(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-02：目录已清理（stat exists=false）→ 落回 cwd 链，root_source=cwd。"""
    sess, token, hub = await _seed_env_with_change(db_session, cwd=r"C:\repo")
    hub.on("host_fs.stat", result={"exists": False, "is_dir": False, "size": 0})
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["root_source"] == "cwd"
    assert body["root"] == r"C:\repo"
    assert _git_status_calls(hub)[0]["params"] == {"root": r"C:\repo"}


async def test_git_status_worktree_probe_error_falls_back_silently(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-02：探测 stat RPC 异常（离线）→ 静默落回，不新增错误面（后续
    git_status RPC 正常则整体 200，root_source=cwd）。"""
    sess, token, hub = await _seed_env_with_change(db_session, cwd=r"C:\repo")
    hub.on(
        "host_fs.stat",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["root_source"] == "cwd"


async def test_git_status_no_change_anchor_skips_probe(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-02：无 current_change_id → 零 stat 调用（探测层跳过），行为同 2026-10-21 版。"""
    sess, token, hub = await _seed_env_with_change(db_session, with_change=False)
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["root_source"] == "cwd"
    assert not [c for c in hub.calls if c["method"] == "host_fs.stat"]


async def test_git_status_stale_change_id_falls_back(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """FR-02：current_change_id 指向已删 change 行（查无 change_key）→ 落回。"""
    sess, token, hub, _ = await _seed_env(db_session)
    sess.current_change_id = uuid.uuid4()  # 幽灵 id（无对应行）
    db_session.add(sess)
    await db_session.commit()
    hub.on("git_status", result=dict(_GIT_STATUS_RESULT))
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    resp = await client.get(_url(sess.id), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["root_source"] == "cwd"
    assert not [c for c in hub.calls if c["method"] == "host_fs.stat"]
