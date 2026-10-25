"""git_log 模块 dirty-files / worktree-diff 两端点集成测试（task-02，
2026-10-25-explorer-git-status design §接口定义）。

仿 ``app/modules/git_log/tests/test_router.py`` 的 hermetic fixture 打法（本
目录按 TaskCard allowed_paths 落位 backend/tests/modules/git_log/，对齐
tests/modules/explorer/ 先例）：每用例自建 roles/users/workspace/binding
（per-test 内存 SQLite，见 ``backend/conftest.py``）；daemon 侧 FakeHub 按
``ws_hub.get_daemon_ws_hub`` 访问器 monkeypatch（probe 的 host_fs.stat 与平名
git_dirty_files / git_worktree_diff RPC 都落进假件）。

五形态 × 两端点（TaskCard acceptance）：

1. 未绑定 → 404 中文引导；
2. daemon 离线（DaemonRuntimeOffline）→ 502；
3. 旧版 daemon（method_not_found）→ 422「版本过旧」（复用既有 _map_remote_error，
   映射代码零改动的回归锚）；
4. no_git 工作区（probe=direct）→ dirty-files 200 空态 / worktree-diff 404；
5. 正常聚合 → mock RPC 载荷逐字段断言 + RPC 契约（method/params/timeout）。

另含：超时 504 / 契约缺口 502 / daemon error 通道（dirty-files 502、
worktree-diff 404）/ path 静态与 containment 预检 422 先于 RPC（hub 零调用）/
openapi 两路径可见 / 鉴权门控（未带 token 401）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.git_log.service import (
    DIRTY_FILES_RPC_TIMEOUT_SECONDS,
    WORKTREE_DIFF_RPC_TIMEOUT_SECONDS,
)

pytestmark = pytest.mark.asyncio

# ────────────────────────────────────────────────────────────────────────────
# 假件与 fixture（app/modules/git_log/tests/test_router.py 同款打法）
# ────────────────────────────────────────────────────────────────────────────


class FakeHub:
    """``DaemonWsHub`` 测试替身——按 method 分发预设 result / 异常并记录调用。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._handlers: dict[str, tuple[Any, BaseException | None]] = {}

    def on(self, method: str, *, result: Any = None, exc: BaseException | None = None) -> None:
        """为 method 预设返回 result 或抛 exc。"""
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
            {
                "daemon_id": daemon_id,
                "method": method,
                "params": params,
                "timeout": timeout,
            }
        )
        handler = self._handlers.get(method)
        if handler is None:
            return {}
        result, exc = handler
        if exc is not None:
            raise exc
        return result


@dataclass
class DirtyFilesEnv:
    """搭好的场景：用户 + 工作区 + viewer 成员关系 + 绑定行 + 假 hub。"""

    user_id: uuid.UUID
    token: str
    workspace_id: uuid.UUID
    daemon_id: uuid.UUID
    root_path: str
    hub: FakeHub


@pytest.fixture()
async def role_seeder(db_session):
    """Seed viewer 角色（WORKSPACE_READ）。"""
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    role = Role(
        id=uuid.uuid4(),
        key="viewer",
        name="Viewer",
        description="Viewer",
        is_system=True,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    await db_session.commit()
    return role.id


@pytest.fixture()
async def user_factory(db_session):
    """Create a user + matching access token。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make() -> tuple[Any, str]:
        u = User(
            id=uuid.uuid4(),
            email=f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="U",
            status="active",
            is_platform_admin=False,
        )
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)
        token, _ = create_access_token(
            user_id=u.id,
            email=u.email,
            is_admin=u.is_platform_admin,
            settings=get_settings(),
        )
        return u, token

    return _make


@pytest.fixture()
async def ws_factory(db_session):
    """Create a workspace row."""
    from app.modules.workspace.model import Workspace

    async def _make(owner_id: uuid.UUID) -> Workspace:
        ws = Workspace(
            id=uuid.uuid4(),
            name="W",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/irrelevant",
            status="active",
            created_by=owner_id,
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)
        return ws

    return _make


@pytest.fixture()
async def member_factory(db_session, role_seeder):
    """Bind a user as viewer inside a workspace。"""
    from datetime import UTC, datetime

    from app.modules.auth.model import UserWorkspaceRole

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID) -> None:
        db_session.add(
            UserWorkspaceRole(
                user_id=user_id,
                workspace_id=ws_id,
                role_id=role_seeder,
                granted_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def binding_factory(db_session):
    """Seed 一条 workspace_member_runtimes 绑定行（直插模型）。

    e2b95aad（D-005@v1）起 host_fs 解析 JOIN daemon_instances（stale 绑定行
    被过滤），daemon_id 非空时须同种真实 daemon_instances 行——幽灵 id 解析
    返回 None，probe 会在发 RPC 前塌缩 502 OFFLINE（app/modules/git_log/
    tests/test_router.py 同款造数）。
    """

    async def _bind(
        ws_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        daemon_id: uuid.UUID | None,
        root_path: str = r"C:\repo",
    ) -> None:
        from datetime import UTC, datetime

        from sqlalchemy import text

        from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

        if daemon_id is not None:
            hb = datetime.now(UTC)
            await db_session.execute(
                text(
                    "INSERT INTO daemon_instances (id, user_id, hostname, server_url,"
                    " allowed_roots, status, last_heartbeat_at, created_at, updated_at)"
                    " VALUES (:id, :uid, 'dirty-test-host', 'http://t',"
                    " '[\"~/.sillyhub\"]', 'online', :hb, :hb, :hb)"
                ),
                {"id": daemon_id.hex, "uid": user_id.hex, "hb": hb},
            )
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws_id,
                user_id=user_id,
                daemon_id=daemon_id,
                root_path=root_path,
                path_source="daemon-client",
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def setup_dirty(
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    binding_factory,
    monkeypatch,
):
    """一键搭场景；``probe`` 控制 host_fs.stat 应答（git/direct/unknown）。"""

    async def _make(
        *,
        root_path: str = r"C:\repo",
        with_binding: bool = True,
        probe: str = "git",
    ) -> DirtyFilesEnv:
        user, token = await user_factory()
        ws = await ws_factory(owner_id=user.id)
        await member_factory(ws.id, user.id)
        daemon_id = uuid.uuid4()
        if with_binding:
            await binding_factory(ws.id, user.id, daemon_id=daemon_id, root_path=root_path)
        hub = FakeHub()
        if probe == "direct":
            hub.on("host_fs.stat", result={"exists": False, "is_dir": False, "size": 0})
        elif probe == "unknown":
            hub.on(
                "host_fs.stat",
                exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
            )
        else:
            hub.on("host_fs.stat", result={"exists": True, "is_dir": True, "size": 0})
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        return DirtyFilesEnv(
            user_id=user.id,
            token=token,
            workspace_id=ws.id,
            daemon_id=daemon_id,
            root_path=root_path,
            hub=hub,
        )

    return _make


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _base(env: DirtyFilesEnv) -> str:
    return f"/api/workspaces/{env.workspace_id}/git-log"


# daemon RPC 载荷 fixture（design §接口定义契约形状）
DIRTY_FILES_RESULT: dict[str, Any] = {
    "head_short": "a1b2c3d4",
    "empty": False,
    "files": [
        {
            "path": "src/a.ts",
            "status": "modified",
            "additions": 10,
            "deletions": 2,
            "binary": False,
        },
        {"path": "新 文件.md", "status": "added", "additions": 3, "deletions": 0, "binary": False},
        {"path": "old.txt", "status": "deleted", "additions": 0, "deletions": 5, "binary": False},
        {
            "path": "logo.png",
            "status": "modified",
            "additions": None,
            "deletions": None,
            "binary": True,
        },
        {
            "path": "notes/draft.md",
            "status": "untracked",
            "additions": None,
            "deletions": None,
            "binary": False,
        },
    ],
    "ignored": [
        {"path": "node_modules/", "is_dir": True},
        {"path": ".env", "is_dir": False},
    ],
    "error": None,
}

WORKTREE_DIFF_RESULT: dict[str, Any] = {
    "status": "modified",
    "head_short": "a1b2c3d4",
    "diff": "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n+新行",
    "truncated": False,
    "binary": False,
    "error": None,
}


# ────────────────────────────────────────────────────────────────────────────
# openapi 可见性 + dirty-files 五形态
# ────────────────────────────────────────────────────────────────────────────


async def test_openapi_lists_two_new_paths():
    """openapi 中可见 dirty-files / worktree-diff 两路径且有 200 响应模型。"""
    from app.main import app

    paths = app.openapi()["paths"]
    base = "/api/workspaces/{workspace_id}/git-log"
    for suffix in ("/dirty-files", "/worktree-diff"):
        assert f"{base}{suffix}" in paths, f"openapi 缺 {suffix}"
        op = paths[f"{base}{suffix}"]["get"]
        assert "200" in op["responses"]


async def test_dirty_files_200_aggregate_and_rpc_contract(client: AsyncClient, setup_dirty):
    """dirty-files 正常聚合：逐字段断言 + RPC 方法/root/超时契约。"""
    env = await setup_dirty()
    env.hub.on("git_dirty_files", result=DIRTY_FILES_RESULT)
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["git_mode"] == "git"
    assert body["head_short"] == "a1b2c3d4"
    assert body["empty"] is False
    assert body["files"] == DIRTY_FILES_RESULT["files"]
    assert body["ignored"] == DIRTY_FILES_RESULT["ignored"]

    rpc = [c for c in env.hub.calls if c["method"] == "git_dirty_files"]
    assert len(rpc) == 1
    assert rpc[0]["daemon_id"] == env.daemon_id
    assert rpc[0]["params"] == {"root": env.root_path}
    assert rpc[0]["timeout"] == DIRTY_FILES_RPC_TIMEOUT_SECONDS


async def test_dirty_files_not_bound_404(client: AsyncClient, setup_dirty):
    """无绑定行 → 404 中文引导（hub 零调用）。"""
    env = await setup_dirty(with_binding=False)
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 404
    assert "未绑定本机工作区" in resp.json()["message"]
    assert env.hub.calls == []


async def test_dirty_files_offline_502(client: AsyncClient, setup_dirty):
    """daemon 离线 → 502。"""
    env = await setup_dirty()
    env.hub.on(
        "git_dirty_files",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 502
    assert "离线" in resp.json()["message"]


async def test_dirty_files_daemon_too_old_422(client: AsyncClient, setup_dirty):
    """旧版 daemon method_not_found → 422「版本过旧」（复用既有映射，零改动回归）。"""
    env = await setup_dirty()
    env.hub.on(
        "git_dirty_files",
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "unknown method"}),
    )
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 422
    assert "版本过旧" in resp.json()["message"]


async def test_dirty_files_no_git_empty_state(client: AsyncClient, setup_dirty):
    """no_git 工作区（probe=direct）→ 200 空态（清单为空数组，无 git RPC）。"""
    env = await setup_dirty(probe="direct")
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "git_mode": "no_git",
        "head_short": None,
        "empty": False,
        "files": [],
        "ignored": [],
    }
    assert [c["method"] for c in env.hub.calls] == ["host_fs.stat"]


async def test_dirty_files_timeout_504(client: AsyncClient, setup_dirty):
    """RPC 超时 → 504。"""
    env = await setup_dirty()
    env.hub.on("git_dirty_files", exc=DaemonRpcTimeout("rpc timed out"))
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 504


async def test_dirty_files_contract_gap_502(client: AsyncClient, setup_dirty):
    """daemon 返回缺字段（契约缺口）→ 502（禁止 .get 默认值掩盖）。"""
    env = await setup_dirty()
    env.hub.on("git_dirty_files", result={"head_short": "a1b2c3d4"})  # 缺 empty/files/ignored
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 502
    assert "契约" in resp.json()["message"]


async def test_dirty_files_daemon_error_502(client: AsyncClient, setup_dirty):
    """daemon error 通道（git 命令真失败）→ 502，文案保 details 不外泄。"""
    env = await setup_dirty()
    env.hub.on(
        "git_dirty_files",
        result={**DIRTY_FILES_RESULT, "files": [], "ignored": [], "error": "fatal: boom"},
    )
    resp = await client.get(f"{_base(env)}/dirty-files", headers=_bearer(env.token))
    assert resp.status_code == 502
    assert "boom" not in resp.json()["message"]  # 原始 stderr 不进 HTTP body


# ────────────────────────────────────────────────────────────────────────────
# worktree-diff 五形态 + path 预检
# ────────────────────────────────────────────────────────────────────────────


async def test_worktree_diff_200_and_rpc_contract(client: AsyncClient, setup_dirty):
    """worktree-diff 正常：逐字段断言 + RPC path/root/超时契约。"""
    env = await setup_dirty()
    env.hub.on("git_worktree_diff", result=WORKTREE_DIFF_RESULT)
    resp = await client.get(
        f"{_base(env)}/worktree-diff",
        params={"path": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "status": "modified",
        "head_short": "a1b2c3d4",
        "diff": WORKTREE_DIFF_RESULT["diff"],
        "truncated": False,
        "binary": False,
    }

    rpc = [c for c in env.hub.calls if c["method"] == "git_worktree_diff"]
    assert len(rpc) == 1
    assert rpc[0]["params"] == {"root": env.root_path, "path": "src/a.ts"}
    assert rpc[0]["timeout"] == WORKTREE_DIFF_RPC_TIMEOUT_SECONDS


async def test_worktree_diff_not_bound_404(client: AsyncClient, setup_dirty):
    """无绑定行 → 404。"""
    env = await setup_dirty(with_binding=False)
    resp = await client.get(
        f"{_base(env)}/worktree-diff",
        params={"path": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 404


async def test_worktree_diff_offline_502(client: AsyncClient, setup_dirty):
    """daemon 离线 → 502。"""
    env = await setup_dirty()
    env.hub.on(
        "git_worktree_diff",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    resp = await client.get(
        f"{_base(env)}/worktree-diff",
        params={"path": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 502


async def test_worktree_diff_daemon_too_old_422(client: AsyncClient, setup_dirty):
    """旧版 daemon method_not_found → 422「版本过旧」。"""
    env = await setup_dirty()
    env.hub.on(
        "git_worktree_diff",
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "unknown method"}),
    )
    resp = await client.get(
        f"{_base(env)}/worktree-diff",
        params={"path": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422
    assert "版本过旧" in resp.json()["message"]


async def test_worktree_diff_no_git_404(client: AsyncClient, setup_dirty):
    """no_git 工作区 → 404 中文引导（响应模型无 git_mode，对齐 get_commit_detail 先例）。"""
    env = await setup_dirty(probe="direct")
    resp = await client.get(
        f"{_base(env)}/worktree-diff",
        params={"path": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 404
    assert "不是 Git 仓库" in resp.json()["message"]
    assert [c["method"] for c in env.hub.calls] == ["host_fs.stat"]


async def test_worktree_diff_daemon_error_404(client: AsyncClient, setup_dirty):
    """daemon error 通道（文件已被提交/删除）→ 404 引导刷新。"""
    env = await setup_dirty()
    env.hub.on(
        "git_worktree_diff",
        result={**WORKTREE_DIFF_RESULT, "diff": "", "error": "git diff --no-index failed"},
    )
    resp = await client.get(
        f"{_base(env)}/worktree-diff",
        params={"path": "gone.md"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 404
    assert "刷新" in resp.json()["message"]


async def test_worktree_diff_invalid_path_422_pre_rpc(client: AsyncClient, setup_dirty):
    """path 非法（pathspec magic / 越界 / 绝对路径）→ 422 且预检先于 RPC（hub 零调用）。"""
    env = await setup_dirty()
    for bad in (":(glob)**", "../outside.txt", "/abs/path.md", r"C:\\repo\\a.ts"):
        resp = await client.get(
            f"{_base(env)}/worktree-diff",
            params={"path": bad},
            headers=_bearer(env.token),
        )
        assert resp.status_code == 422, (bad, resp.status_code)
    assert env.hub.calls == []


async def test_worktree_diff_missing_path_422(client: AsyncClient, setup_dirty):
    """缺 path 参数 → FastAPI 422。"""
    env = await setup_dirty()
    resp = await client.get(f"{_base(env)}/worktree-diff", headers=_bearer(env.token))
    assert resp.status_code == 422


# ────────────────────────────────────────────────────────────────────────────
# 鉴权门控
# ────────────────────────────────────────────────────────────────────────────


async def test_endpoints_require_auth(client: AsyncClient, setup_dirty):
    """未带 token → 401。"""
    env = await setup_dirty()
    resp1 = await client.get(f"{_base(env)}/dirty-files")
    resp2 = await client.get(f"{_base(env)}/worktree-diff", params={"path": "a.ts"})
    assert resp1.status_code == 401
    assert resp2.status_code == 401
