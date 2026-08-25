"""Git 日志三端点 router 集成测试（task-04，design §5.5 / §7.1）。

仿 ``backend/tests/modules/explorer/test_explorer.py`` 的 hermetic fixture 打法：
每用例自建 roles/users/workspace/binding（per-test 内存 SQLite，见
``backend/conftest.py`` ``db_engine``，无 alembic / 无真 Postgres）；daemon 侧用
``FakeHub`` 假件按 ``ws_hub.get_daemon_ws_hub`` 访问器 monkeypatch——service 的
平名 RPC 直连与 probe（HostFsDelegate 经工厂取同一 hub 单例）都落进假件，
不打真 WS / 不依赖真 git 仓库（真机全链路冒烟归 task-07）。

七分支覆盖（task-04 验收）：

1. 正常列表：lane/edges/refs 合并/branches[]/head/seq/RPC 契约全量断言；
2. 非 git 工作区：probe=direct → ``git_mode=no_git`` 空态 200（无 git RPC）；
3. daemon 离线：git RPC 抛 DaemonRuntimeOffline → 502（另测 probe unknown → 502）；
4. 超时：DaemonRpcTimeout → 504；
5. 旧版 daemon：method_not_found → 422「版本过旧」；
6. sha 非法 → 422 且预检先于 RPC（hub 零调用）；
7. path 越界 / pathspec magic → 422 且预检先于 RPC（hub 零调用）。

另含：分页窗口（RPC count=skip+limit+lookahead / seq 全局绝对序 / has_more /
truncated）、branch/author 过滤透传、空仓库空态（CC-17）、契约缺口 502、
git_show/git_diff_file 正常路径与 404、未绑定 404、三端点鉴权门控（401 / 403）。
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
    DIFF_RPC_TIMEOUT_SECONDS,
    LOG_RPC_TIMEOUT_SECONDS,
    LOOKAHEAD,
    SHOW_RPC_TIMEOUT_SECONDS,
)

pytestmark = pytest.mark.asyncio

# ────────────────────────────────────────────────────────────────────────────
# 假件与 fixture（explorer test_explorer.py 同款打法）
# ────────────────────────────────────────────────────────────────────────────


class FakeHub:
    """``DaemonWsHub`` 测试替身——按 method 分发预设 result / 异常并记录调用。

    git_log 系链路一次请求会发多种 method（probe 的 ``host_fs.stat`` + 平名
    git_* 四方法），故按方法名分发（explorer 的单 result 形态不适用）；未注册
    的 method 返回空 dict——用例都显式 ``on()`` 需要的方法，漏配会在断言暴露。
    """

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
class GitLogEnv:
    """一个搭好的 Git 日志场景：用户 + 工作区 + viewer 成员关系 + 绑定行 + 假 hub。"""

    user_id: uuid.UUID
    token: str
    workspace_id: uuid.UUID
    daemon_id: uuid.UUID
    root_path: str
    hub: FakeHub


@pytest.fixture()
async def role_seeder(db_session):
    """Seed 本测试用到的角色（viewer=只读，workspace_owner=全量）。"""
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    roles_spec = {
        "workspace_owner": (
            "Workspace Owner",
            [
                Permission.WORKSPACE_READ,
                Permission.WORKSPACE_WRITE,
                Permission.WORKSPACE_ADMIN,
                Permission.WORKSPACE_MEMBER_MANAGE,
            ],
        ),
        "viewer": ("Viewer", [Permission.WORKSPACE_READ]),
    }
    ids: dict[str, uuid.UUID] = {}
    for key, (name, perms) in roles_spec.items():
        role = Role(id=uuid.uuid4(), key=key, name=name, description=name, is_system=True)
        db_session.add(role)
        await db_session.flush()
        ids[key] = role.id
        for p in perms:
            db_session.add(RolePermission(role_id=role.id, permission=p.value))
    await db_session.commit()
    return ids


@pytest.fixture()
async def user_factory(db_session):
    """Create a user + matching access token（explorer 测试同款）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make(
        *,
        email: str | None = None,
        display_name: str = "U",
        is_admin: bool = False,
    ) -> tuple[Any, str]:
        u = User(
            id=uuid.uuid4(),
            email=email or f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name=display_name,
            status="active",
            is_platform_admin=is_admin,
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

    async def _make(name: str = "W", owner_id: uuid.UUID | None = None) -> Workspace:
        ws = Workspace(
            id=uuid.uuid4(),
            name=name,
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
    """Bind a user to ``role_key`` inside a workspace（默认 viewer）。"""
    from datetime import UTC, datetime

    from app.modules.auth.model import UserWorkspaceRole

    async def _bind(
        ws_id: uuid.UUID,
        user_id: uuid.UUID,
        role_key: str = "viewer",
    ) -> None:
        db_session.add(
            UserWorkspaceRole(
                user_id=user_id,
                workspace_id=ws_id,
                role_id=role_seeder[role_key],
                granted_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def binding_factory(db_session):
    """Seed 一条 ``workspace_member_runtimes`` 绑定行（直插模型，无需 daemon 实体）。"""

    async def _bind(
        ws_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        daemon_id: uuid.UUID | None,
        root_path: str = r"C:\repo",
    ) -> None:
        from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

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
async def setup_gitlog(
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    binding_factory,
    monkeypatch,
):
    """一键搭 Git 日志场景：用户（viewer 成员）+ 工作区 + 绑定行 + 按方法分发假 hub。

    ``probe`` 控制 ``host_fs.stat`` 应答：``git``（默认）/ ``direct``（无 .git）/
    ``unknown``（传输异常——delegate 内部捕获归 unknown）。git_* 方法由各用例
    自行 ``env.hub.on(...)`` 预设。
    """

    async def _make(
        *,
        root_path: str = r"C:\repo",
        with_binding: bool = True,
        daemon_id_null: bool = False,
        probe: str = "git",
    ) -> GitLogEnv:
        user, token = await user_factory()
        ws = await ws_factory(owner_id=user.id)
        await member_factory(ws.id, user.id, "viewer")
        daemon_id = uuid.uuid4()
        if with_binding:
            await binding_factory(
                ws.id,
                user.id,
                daemon_id=None if daemon_id_null else daemon_id,
                root_path=root_path,
            )
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
        return GitLogEnv(
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


def _base(env: GitLogEnv) -> str:
    return f"/api/workspaces/{env.workspace_id}/git-log"


def _methods(env: GitLogEnv) -> list[str]:
    return [call["method"] for call in env.hub.calls]


# ────────────────────────────────────────────────────────────────────────────
# 测试数据（design §7.2 daemon RPC 契约形状）
# ────────────────────────────────────────────────────────────────────────────

_C0 = "1" * 40
_C1 = "2" * 40
_C2 = "3" * 40
_C3 = "4" * 40


def _commit(
    hash_: str, short: str, parents: list[str], message: str = "提交说明"
) -> dict[str, Any]:
    """构造 daemon git_log / git_show 的单条 commit 记录（§7.2 契约形状）。"""
    return {
        "hash": hash_,
        "short": short,
        "parents": parents,
        "author_name": "张三",
        "author_email": "zhang@example.com",
        "author_date": "2026-08-25T10:00:00+08:00",
        "committer_date": "2026-08-25T10:00:00+08:00",
        "message": message,
    }


# 拓扑：merge(c0) ← c1/c2 双分支 ← root(c3)。compute_lanes 期望 lane [0,0,1,0]。
GRAPH_LOG_RESULT = {
    "commits": [
        _commit(_C0, "1111111", [_C1, _C2], "merge: 合并功能分支"),
        _commit(_C1, "2222222", [_C3], "feat: 功能 A"),
        _commit(_C2, "3333333", [_C3], "fix: 修复 B"),
        _commit(_C3, "4444444", [], "init: 初始提交"),
    ],
    "truncated": False,
    "error": None,
}

GRAPH_REFS_RESULT = {
    "refs": [
        {"name": "refs/heads/main", "short": "main", "sha": _C0, "kind": "branch"},
        {
            "name": "refs/remotes/origin/main",
            "short": "origin/main",
            "sha": _C0,
            "kind": "remote",
        },
        {"name": "refs/tags/v1.0.0", "short": "v1.0.0", "sha": _C3, "kind": "tag"},
    ],
    "head": _C0,
    "error": None,
}


def _linear_commits(n: int) -> list[dict[str, Any]]:
    """n 条线性链提交（新→旧，第 i 条 parent 是第 i+1 条）。"""
    hashes = [f"{i:040x}" for i in range(n)]
    return [
        _commit(hashes[i], hashes[i][:7], [hashes[i + 1]] if i + 1 < n else []) for i in range(n)
    ]


def _git_log_result(n: int, *, truncated: bool = False) -> dict[str, Any]:
    return {"commits": _linear_commits(n), "truncated": truncated, "error": None}


# ────────────────────────────────────────────────────────────────────────────
# 分支 ①：正常列表（lane / edges / refs 合并 / branches[] / head / seq）
# ────────────────────────────────────────────────────────────────────────────


async def test_openapi_lists_three_git_log_paths():
    """验收前置：openapi 中可见 3 条 git-log 路径，且 commits 有 200 响应模型。"""
    from app.main import app

    paths = app.openapi()["paths"]
    base = "/api/workspaces/{workspace_id}/git-log"
    for suffix in ("/commits", "/commits/{sha}", "/commits/{sha}/diff"):
        assert f"{base}{suffix}" in paths, f"openapi 缺 {suffix}"
    commits_op = paths[f"{base}/commits"]["get"]
    assert "responses" in commits_op and "200" in commits_op["responses"]


async def test_commits_200_lane_refs_head_merge_and_rpc_contract(client: AsyncClient, setup_gitlog):
    """正常列表：lane/edges/refs/branches/head/seq 全量断言 + RPC 平名契约。

    RPC 契约：probe（host_fs.stat）→ git_log → git_refs 顺序；git_log params
    含 root/branch/author/count=0+100+50；log/refs 均 LOG_RPC_TIMEOUT 30s。
    """
    env = await setup_gitlog()
    env.hub.on("git_log", result=GRAPH_LOG_RESULT)
    env.hub.on("git_refs", result=GRAPH_REFS_RESULT)

    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["git_mode"] == "git"
    assert body["head"] == _C0
    assert body["has_more"] is False
    assert body["total_in_window"] == 4
    # branches[] 取 refs 全量 branch/remote 类（tag 不入，CC-07 分支下拉数据源）。
    assert body["branches"] == [
        {"name": "main", "kind": "branch"},
        {"name": "origin/main", "kind": "remote"},
    ]

    commits = body["commits"]
    assert [c["seq"] for c in commits] == [0, 1, 2, 3]
    assert [c["lane"] for c in commits] == [0, 0, 1, 0]
    assert commits[0]["hash"] == _C0
    assert commits[0]["parents"] == [_C1, _C2]
    assert commits[0]["message"] == "merge: 合并功能分支"

    # refs 按 sha 合并（CC-04）：HEAD 双写——kind=head 条目前置 + 顶层 head 字段。
    assert commits[0]["refs"] == [
        {"name": "HEAD", "kind": "head"},
        {"name": "main", "kind": "branch"},
        {"name": "origin/main", "kind": "remote"},
    ]
    assert commits[3]["refs"] == [{"name": "v1.0.0", "kind": "tag"}]
    assert commits[1]["refs"] == []
    assert commits[2]["refs"] == []

    # 泳道边：merge 第一父同 lane 直线 / 第二父换 lane 曲线；root 无出边。
    assert commits[0]["edges"] == [
        {"to_seq": 1, "to_lane": 0, "kind": "straight"},
        {"to_seq": 2, "to_lane": 1, "kind": "curve"},
    ]
    assert commits[1]["edges"] == [{"to_seq": 3, "to_lane": 0, "kind": "straight"}]
    assert commits[2]["edges"] == [{"to_seq": 3, "to_lane": 0, "kind": "curve"}]
    assert commits[3]["edges"] == []

    # RPC 平名契约（CC-02）：无 host_fs. 前缀；顺序 stat → git_log → git_refs。
    assert _methods(env) == ["host_fs.stat", "git_log", "git_refs"]
    log_call = env.hub.calls[1]
    assert log_call["daemon_id"] == env.daemon_id
    assert log_call["params"] == {
        "root": env.root_path,
        "branch": "",
        "author": "",
        "count": 100 + LOOKAHEAD,
    }
    assert log_call["timeout"] == LOG_RPC_TIMEOUT_SECONDS
    refs_call = env.hub.calls[2]
    assert refs_call["params"] == {"root": env.root_path}
    assert refs_call["timeout"] == LOG_RPC_TIMEOUT_SECONDS


# ────────────────────────────────────────────────────────────────────────────
# 分支 ②：非 git 工作区空态（probe=direct → no_git 200，非报错）
# ────────────────────────────────────────────────────────────────────────────


async def test_no_git_workspace_returns_empty_state_200(client: AsyncClient, setup_gitlog):
    """probe=direct → git_mode=no_git 空态 200；probe 后不再发 git RPC。"""
    env = await setup_gitlog(probe="direct")
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "git_mode": "no_git",
        "commits": [],
        "branches": [],
        "head": None,
        "has_more": False,
        "total_in_window": 0,
    }
    assert _methods(env) == ["host_fs.stat"]


# ────────────────────────────────────────────────────────────────────────────
# 分支 ③④⑤：RPC 错误映射（offline / probe unknown / timeout / 旧版 daemon）
# ────────────────────────────────────────────────────────────────────────────


async def test_daemon_offline_maps_502(client: AsyncClient, setup_gitlog):
    """git RPC 抛 DaemonRuntimeOffline → 502 HTTP_502_GIT_LOG_DAEMON_OFFLINE。"""
    env = await setup_gitlog()
    env.hub.on(
        "git_log",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_GIT_LOG_DAEMON_OFFLINE"


async def test_probe_unknown_maps_502_no_silent_degrade(client: AsyncClient, setup_gitlog):
    """probe 传输失败（delegate 归 unknown）→ 502，禁止静默降级（constraints）。"""
    env = await setup_gitlog(probe="unknown")
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_502_GIT_LOG_DAEMON_OFFLINE"
    assert "离线" in body["message"]
    assert _methods(env) == ["host_fs.stat"]  # 不再发 git RPC


async def test_rpc_timeout_maps_504(client: AsyncClient, setup_gitlog):
    """RPC 往返超时 → 504 HTTP_504_GIT_LOG_RPC_TIMEOUT。"""
    env = await setup_gitlog()
    env.hub.on("git_log", exc=DaemonRpcTimeout("rpc timed out"))
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 504, resp.text
    assert resp.json()["code"] == "HTTP_504_GIT_LOG_RPC_TIMEOUT"


async def test_method_not_found_maps_422_daemon_too_old(client: AsyncClient, setup_gitlog):
    """旧 daemon 未注册 git_log 平名方法 → 422 版本过旧中文引导（design §9）。"""
    env = await setup_gitlog()
    env.hub.on(
        "git_log",
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "unknown method"}),
    )
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_GIT_LOG_DAEMON_TOO_OLD"
    assert "版本过旧" in body["message"]


async def test_rpc_internal_maps_502_remote_error(client: AsyncClient, setup_gitlog):
    """daemon 其余业务错误（internal）→ 502 HTTP_502_GIT_LOG_DAEMON_REMOTE。"""
    env = await setup_gitlog()
    env.hub.on("git_log", exc=DaemonRpcRemoteError({"code": "internal", "message": "boom"}))
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_GIT_LOG_DAEMON_REMOTE"


async def test_rpc_malformed_result_maps_502_contract_gap(client: AsyncClient, setup_gitlog):
    """daemon 返回缺字段（git_log 缺 truncated/error）→ 502 契约缺口显式上报。"""
    env = await setup_gitlog()
    env.hub.on("git_log", result={"commits": []})  # 缺 truncated / error
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_502_GIT_LOG_CONTRACT_GAP"
    assert "契约" in body["message"]


# ────────────────────────────────────────────────────────────────────────────
# 分支 ⑥⑦：参数校验 422（预检先于 RPC——hub 零调用）
# ────────────────────────────────────────────────────────────────────────────


async def test_invalid_sha_maps_422_before_rpc(client: AsyncClient, setup_gitlog):
    """sha 非十六进制 → 422 HTTP_422_GIT_LOG_INVALID_PARAM，且不惊动 daemon。"""
    env = await setup_gitlog()
    resp = await client.get(f"{_base(env)}/commits/zz@@!", headers=_bearer(env.token))
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_GIT_LOG_INVALID_PARAM"
    assert env.hub.calls == []


@pytest.mark.parametrize(
    "bad_path",
    [
        "../../etc/passwd",  # .. 逃逸
        "/etc/passwd",  # 绝对路径
        r"C:\Windows\System32",  # Windows 盘符绝对路径
        "a/../../b",  # 混合 .. 段
    ],
)
async def test_path_escape_maps_422_before_rpc(client: AsyncClient, setup_gitlog, bad_path: str):
    """diff path 越界 → 422 HTTP_422_GIT_LOG_PATH_OUTSIDE_ROOT，containment 预检先于 RPC。"""
    env = await setup_gitlog()
    resp = await client.get(
        f"{_base(env)}/commits/{_C0}/diff",
        params={"path": bad_path},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_GIT_LOG_PATH_OUTSIDE_ROOT"
    assert env.hub.calls == []


async def test_pathspec_magic_maps_422_before_rpc(client: AsyncClient, setup_gitlog):
    """diff path 以「:(」开头（pathspec magic）→ 422 静态预检拒绝，hub 零调用。"""
    env = await setup_gitlog()
    resp = await client.get(
        f"{_base(env)}/commits/{_C0}/diff",
        params={"path": ":(top,glob)**"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_GIT_LOG_INVALID_PARAM"
    assert env.hub.calls == []


@pytest.mark.parametrize(
    ("params", "code"),
    [
        ({"branch": "-n"}, "HTTP_422_GIT_LOG_INVALID_PARAM"),  # 首字符禁 -
        ({"branch": "a b"}, "HTTP_422_GIT_LOG_INVALID_PARAM"),  # 白名单外字符
        ({"author": "x" * 121}, "HTTP_422_GIT_LOG_INVALID_PARAM"),  # 超 120 字符
        ({"skip": 2001}, "HTTP_422_GIT_LOG_INVALID_PARAM"),  # skip 上限 2000
        ({"limit": 0}, "HTTP_422_GIT_LOG_INVALID_PARAM"),  # limit 下限 1
    ],
)
async def test_invalid_query_params_map_422(
    client: AsyncClient, setup_gitlog, params: dict[str, Any], code: str
):
    """branch/author/分页静态校验拒绝矩阵 → 422 且不发 RPC（R-01 / R-02）。"""
    env = await setup_gitlog()
    resp = await client.get(f"{_base(env)}/commits", params=params, headers=_bearer(env.token))
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == code
    assert env.hub.calls == []


# ────────────────────────────────────────────────────────────────────────────
# 分页窗口与过滤透传（D-004 / D-005 / CC-10）
# ────────────────────────────────────────────────────────────────────────────


async def test_pagination_window_seq_and_count_param(client: AsyncClient, setup_gitlog):
    """skip>0：RPC count=skip+limit+50；窗口 seq 为全局绝对序（CC-10）。

    lookahead 内可见边保留：窗口尾提交（seq=3）的父边目标 seq=4 落在 daemon
    结果集内 → 保留（跨窗口边界绘制）；lane 对全前缀计算（D-004）。
    """
    env = await setup_gitlog()
    env.hub.on("git_log", result=_git_log_result(6))
    env.hub.on("git_refs", result=GRAPH_REFS_RESULT)

    resp = await client.get(
        f"{_base(env)}/commits",
        params={"skip": 2, "limit": 2},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert env.hub.calls[1]["params"]["count"] == 2 + 2 + LOOKAHEAD
    assert [c["seq"] for c in body["commits"]] == [2, 3]
    assert body["total_in_window"] == 2
    assert body["has_more"] is False  # 6 < 54 且未截断
    # 线性链 lane 全 0；窗口首条（seq=2）边指向 seq=3、窗口尾（seq=3）边指向
    # lookahead 内的 seq=4（目标在结果集内 → 保留）。
    assert body["commits"][0]["edges"] == [{"to_seq": 3, "to_lane": 0, "kind": "straight"}]
    assert body["commits"][1]["edges"] == [{"to_seq": 4, "to_lane": 0, "kind": "straight"}]


async def test_has_more_true_when_full_prefix_reached(client: AsyncClient, setup_gitlog):
    """len(daemon 返回) >= count（拉满前缀）→ has_more=True。"""
    env = await setup_gitlog()
    env.hub.on("git_log", result=_git_log_result(60))  # limit=1 → count=51，60>=51
    env.hub.on("git_refs", result=GRAPH_REFS_RESULT)
    resp = await client.get(
        f"{_base(env)}/commits", params={"limit": 1}, headers=_bearer(env.token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert env.hub.calls[1]["params"]["count"] == 1 + LOOKAHEAD
    assert body["total_in_window"] == 1
    assert body["has_more"] is True


async def test_has_more_true_when_daemon_truncated(client: AsyncClient, setup_gitlog):
    """daemon 标记 truncated（-n 截断 / 解析跳过）→ has_more=True。"""
    env = await setup_gitlog()
    env.hub.on("git_log", result=_git_log_result(3, truncated=True))
    env.hub.on("git_refs", result=GRAPH_REFS_RESULT)
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["has_more"] is True


async def test_branch_author_filter_passthrough(client: AsyncClient, setup_gitlog):
    """branch/author 过滤透传（D-005）：branch 非空时随 RPC 下发、由 daemon 以
    <branch> 替代 --all（互斥由 daemon 实现）；空 author 不下发额外语义。"""
    env = await setup_gitlog()
    env.hub.on("git_log", result=GRAPH_LOG_RESULT)
    env.hub.on("git_refs", result=GRAPH_REFS_RESULT)
    resp = await client.get(
        f"{_base(env)}/commits",
        params={"branch": "feat/login", "author": "张三"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert env.hub.calls[1]["params"] == {
        "root": env.root_path,
        "branch": "feat/login",
        "author": "张三",
        "count": 100 + LOOKAHEAD,
    }


# ────────────────────────────────────────────────────────────────────────────
# 空仓库空态（CC-17）
# ────────────────────────────────────────────────────────────────────────────


async def test_empty_repo_returns_git_mode_git_empty_lists(client: AsyncClient, setup_gitlog):
    """空仓库（daemon 捕获 exit 128 转空态）→ git_mode=git + 空表，非报错。"""
    env = await setup_gitlog()
    env.hub.on("git_log", result={"commits": [], "truncated": False, "error": None})
    env.hub.on("git_refs", result={"refs": [], "head": None, "error": None})
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["git_mode"] == "git"
    assert body["commits"] == []
    assert body["branches"] == []
    assert body["head"] is None
    assert body["has_more"] is False
    assert body["total_in_window"] == 0


# ────────────────────────────────────────────────────────────────────────────
# 详情 / diff 正常路径与 404
# ────────────────────────────────────────────────────────────────────────────


async def test_detail_200_refs_head_and_binary_files(client: AsyncClient, setup_gitlog):
    """详情：git_show + git_refs 两 RPC；HEAD 命中 → refs 含 kind=head；
    numstat 二进制行（add/del=null）→ 响应侧归 0（schema「二进制文件为 0」）。"""
    env = await setup_gitlog()
    env.hub.on(
        "git_show",
        result={
            "commit": _commit(_C0, "1111111", [_C1, _C2], "merge: 合并功能分支"),
            "files": [
                {"path": "src/主程.py", "add": 10, "del": 2, "binary": False},
                {"path": "assets/logo.png", "add": None, "del": None, "binary": True},
            ],
            "error": None,
        },
    )
    env.hub.on("git_refs", result=GRAPH_REFS_RESULT)

    resp = await client.get(f"{_base(env)}/commits/{_C0}", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["hash"] == _C0
    assert body["short"] == "1111111"
    assert body["committer_date"] == "2026-08-25T10:00:00+08:00"
    assert body["refs"] == [
        {"name": "HEAD", "kind": "head"},
        {"name": "main", "kind": "branch"},
        {"name": "origin/main", "kind": "remote"},
    ]
    assert body["files"][0] == {
        "path": "src/主程.py",
        "add": 10,
        "del": 2,
        "binary": False,
    }
    assert body["files"][1]["add"] == 0
    assert body["files"][1]["del"] == 0
    assert body["files"][1]["binary"] is True

    # RPC 契约：stat → git_show（SHOW 30s）→ git_refs（LOG 30s）。
    assert _methods(env) == ["host_fs.stat", "git_show", "git_refs"]
    assert env.hub.calls[1]["params"] == {"root": env.root_path, "sha": _C0}
    assert env.hub.calls[1]["timeout"] == SHOW_RPC_TIMEOUT_SECONDS
    assert env.hub.calls[2]["timeout"] == LOG_RPC_TIMEOUT_SECONDS


async def test_detail_no_git_maps_404(client: AsyncClient, setup_gitlog):
    """详情端点 probe=direct → 404「该工作区不是 Git 仓库」（task-04 偏离决定）。"""
    env = await setup_gitlog(probe="direct")
    resp = await client.get(f"{_base(env)}/commits/{_C0}", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_404_GIT_LOG_COMMIT_NOT_FOUND"
    assert "不是 Git 仓库" in body["message"]
    assert _methods(env) == ["host_fs.stat"]


async def test_detail_sha_not_found_maps_404(client: AsyncClient, setup_gitlog):
    """git_show 命令失败（commit=null + error 文案）→ 404 HTTP_404_GIT_LOG_COMMIT_NOT_FOUND。"""
    env = await setup_gitlog()
    env.hub.on(
        "git_show",
        result={"commit": None, "files": [], "error": "fatal: bad object abc"},
    )
    resp = await client.get(f"{_base(env)}/commits/{_C1}", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_GIT_LOG_COMMIT_NOT_FOUND"


async def test_diff_200_and_rpc_contract(client: AsyncClient, setup_gitlog):
    """diff 正常路径：git_diff_file 直连（无 probe——链路定义）；diff/truncated/binary 透传。"""
    env = await setup_gitlog()
    diff_result = {
        "diff": "@@ -1 +1,2 @@\n-a\n+b\n",
        "truncated": False,
        "binary": False,
        "error": None,
    }
    env.hub.on("git_diff_file", result=diff_result)
    resp = await client.get(
        f"{_base(env)}/commits/{_C0}/diff",
        params={"path": "src/app.py"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    # HTTP 响应只含 §7.4 三字段（daemon 的 error 文案不透传）。
    assert resp.json() == {
        "diff": diff_result["diff"],
        "truncated": diff_result["truncated"],
        "binary": diff_result["binary"],
    }
    # RPC 契约：仅一次 git_diff_file（diff 端点不做 probe），DIFF 30s 超时。
    assert _methods(env) == ["git_diff_file"]
    call = env.hub.calls[0]
    assert call["daemon_id"] == env.daemon_id
    assert call["params"] == {"root": env.root_path, "sha": _C0, "path": "src/app.py"}
    assert call["timeout"] == DIFF_RPC_TIMEOUT_SECONDS


async def test_diff_not_found_maps_404(client: AsyncClient, setup_gitlog):
    """git_diff_file 命令失败（error 文案）→ 404（sha / path 不存在语义）。"""
    env = await setup_gitlog()
    env.hub.on(
        "git_diff_file",
        result={"diff": "", "truncated": False, "binary": False, "error": "fatal: bad object"},
    )
    resp = await client.get(
        f"{_base(env)}/commits/{_C0}/diff",
        params={"path": "src/gone.py"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_GIT_LOG_COMMIT_NOT_FOUND"


# ────────────────────────────────────────────────────────────────────────────
# 绑定解析（未绑定 / daemon_id IS NULL → 404）
# ────────────────────────────────────────────────────────────────────────────


async def test_no_binding_row_returns_404_not_bound(client: AsyncClient, setup_gitlog):
    """无绑定行 → 404 HTTP_404_GIT_LOG_NOT_BOUND，中文引导到成员页。"""
    env = await setup_gitlog(with_binding=False)
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_404_GIT_LOG_NOT_BOUND"
    assert "未绑定" in body["message"]
    assert env.hub.calls == []


async def test_binding_daemon_id_null_returns_404_not_bound(client: AsyncClient, setup_gitlog):
    """绑定行存在但 daemon_id IS NULL（合法过渡形态）→ 同样 404 未绑定。"""
    env = await setup_gitlog(daemon_id_null=True)
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_GIT_LOG_NOT_BOUND"
    assert env.hub.calls == []


# ────────────────────────────────────────────────────────────────────────────
# 鉴权门控：三端点均受 WORKSPACE_READ 保护
# ────────────────────────────────────────────────────────────────────────────


_ALL_ENDPOINTS = [
    "/git-log/commits",
    f"/git-log/commits/{_C0}",
    f"/git-log/commits/{_C0}/diff?path=a.txt",
]


@pytest.mark.parametrize("suffix", _ALL_ENDPOINTS)
async def test_endpoints_require_auth_401(client: AsyncClient, setup_gitlog, suffix: str):
    """不带 token → 401（三端点逐一验证）。"""
    env = await setup_gitlog()
    resp = await client.get(f"/api/workspaces/{env.workspace_id}{suffix}")
    assert resp.status_code == 401, resp.text


async def test_endpoint_non_member_403(client: AsyncClient, setup_gitlog, user_factory):
    """合法 token 但非本工作区成员（无 WORKSPACE_READ 语境）→ 403。"""
    env = await setup_gitlog()
    _stranger, stranger_token = await user_factory(email="stranger@x.com")
    resp = await client.get(f"{_base(env)}/commits", headers=_bearer(stranger_token))
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "HTTP_403_PERMISSION_DENIED"
