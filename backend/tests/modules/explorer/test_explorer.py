"""Explorer 四端点 router 集成测试（task-04，design §7.2）。

仿 ``tests/modules/workspace/test_members_router.py`` 的 hermetic fixture 打法：
每用例自建 roles/users/workspace/binding（per-test 内存 SQLite，见
``backend/conftest.py`` ``db_engine``，无 alembic / 无真 Postgres）；ws_hub 用
``FakeHub`` 假件按 ``ws_hub.get_daemon_ws_hub`` 访问器 monkeypatch（service
懒导入取 hub，daemon/router.py:1429 同款理由），不打真 WS。

覆盖（对应 task-04 验收）：

- containment 拒绝矩阵（绝对路径 / 盘符 / UNC / ``..`` 逃逸 / 控制字符 → 422，
  且预检先于 RPC——hub 不被调用）；
- 绑定解析（无绑定行 / ``daemon_id IS NULL`` → 404 未绑定中文引导）；
- RPC 错误映射全表（offline / mid-rpc 断连 / timeout / forbidden / not_found /
  method_not_found / internal / 契约缺口）；
- download 头（RFC 5987 filename*、ASCII 回退、X-Truncated、Content-Length
  与字节往返 base64 无损）；
- 四端点鉴权门控（未带 token → 401；非成员 → 403）与 openapi 四路径可见。
"""

from __future__ import annotations

import base64
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import pytest
from httpx import AsyncClient

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.explorer.service import (
    DOWNLOAD_RPC_TIMEOUT_SECONDS,
    READ_FILE_RPC_TIMEOUT_SECONDS,
    SEARCH_RPC_TIMEOUT_SECONDS,
    TREE_RPC_TIMEOUT_SECONDS,
)

pytestmark = pytest.mark.asyncio

# ────────────────────────────────────────────────────────────────────────────
# 假件与 fixture
# ────────────────────────────────────────────────────────────────────────────


class FakeHub:
    """``DaemonWsHub`` 测试替身——记录 send_rpc 调用，可预设 result / 抛异常。"""

    def __init__(self, result: Any = None, exc: BaseException | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result = result
        self.exc = exc

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
        if self.exc is not None:
            raise self.exc
        return self.result


@dataclass
class ExplorerEnv:
    """一个搭好的浏览场景：用户 + 工作区 + viewer 成员关系 + 绑定行 + 假 hub。"""

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
    """Create a user + matching access token（members_router 测试同款）。"""
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
    """Seed 一条 ``workspace_member_runtimes`` 绑定行（直插模型，无需 daemon 实体——
    测试引擎不启用 SQLite FK 强制）。"""

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
async def setup_explorer(
    role_seeder,
    user_factory,
    ws_factory,
    member_factory,
    binding_factory,
    monkeypatch,
):
    """一键搭浏览场景：用户（viewer 成员）+ 工作区 + 绑定行 + patch 假 hub。

    ``with_binding=False``（无绑定行）与 ``daemon_id_null=True``（绑定行
    daemon_id IS NULL 过渡形态）供绑定解析矩阵使用；``result`` / ``exc``
    直接喂给 FakeHub。
    """

    async def _make(
        *,
        result: Any = None,
        exc: BaseException | None = None,
        root_path: str = r"C:\repo",
        with_binding: bool = True,
        daemon_id_null: bool = False,
    ) -> ExplorerEnv:
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
        hub = FakeHub(result=result, exc=exc)
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        return ExplorerEnv(
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


def _base(env: ExplorerEnv) -> str:
    return f"/api/workspaces/{env.workspace_id}/explorer"


TREE_RESULT = {
    "entries": [
        {"name": "src", "type": "dir", "size": 0, "mtime": "2026-08-18T10:00:00Z"},
        {"name": "README.md", "type": "file", "size": 12, "mtime": "2026-08-18T10:00:00Z"},
    ]
}

FILE_RESULT = {
    "name": "README.md",
    "size": 12,
    "mtime": "2026-08-18T10:00:00Z",
    "binary": False,
    "truncated": False,
    "content": "# hello",
}

SEARCH_RESULT = {
    "matches": [
        {"path": "src/app/page.tsx", "name": "page.tsx", "type": "file"},
        {"path": "src/app", "name": "app", "type": "dir"},
    ],
    "truncated": True,
}


# ────────────────────────────────────────────────────────────────────────────
# openapi 可见性 + 正常路径（tree / file / search）
# ────────────────────────────────────────────────────────────────────────────


async def test_openapi_lists_four_explorer_paths():
    """验收 1：openapi 中可见 4 条 explorer 路径，tree/file/search 有响应模型。"""
    from app.main import app

    paths = app.openapi()["paths"]
    base = "/api/workspaces/{workspace_id}/explorer"
    for suffix in ("/tree", "/file", "/download", "/search"):
        assert f"{base}{suffix}" in paths, f"openapi 缺 {suffix}"
    # download 无 JSON 响应模型（StreamingResponse），其余三端点 200 响应可展开。
    tree_op = paths[f"{base}/tree"]["get"]
    assert "responses" in tree_op and "200" in tree_op["responses"]


async def test_tree_200_and_rpc_contract(client: AsyncClient, setup_explorer):
    """tree 正常路径：200 + entries 结构 + RPC 方法/超时/参数契约。"""
    env = await setup_explorer(result=TREE_RESULT)
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [e["name"] for e in body["entries"]] == ["src", "README.md"]
    assert body["entries"][0] == {
        "name": "src",
        "type": "dir",
        "size": 0,
        "mtime": "2026-08-18T10:00:00Z",
    }

    assert len(env.hub.calls) == 1
    call = env.hub.calls[0]
    assert call["daemon_id"] == env.daemon_id
    assert call["method"] == "explorer_list_dir"
    assert call["params"]["root"] == env.root_path
    assert call["timeout"] == TREE_RPC_TIMEOUT_SECONDS


async def test_tree_empty_path_means_root(client: AsyncClient, setup_explorer):
    """tree 不带 path → 列根目录（RPC path == root 本身）。"""
    env = await setup_explorer(result=TREE_RESULT, root_path=r"C:\repo")
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 200, resp.text
    assert env.hub.calls[0]["params"]["path"] == r"C:\repo"


async def test_tree_windows_root_rel_join(client: AsyncClient, setup_explorer):
    """Windows 形态 root：rel ``src/app`` 拼成反斜杠绝对路径下发。"""
    env = await setup_explorer(result=TREE_RESULT, root_path=r"C:\repo")
    resp = await client.get(
        f"{_base(env)}/tree",
        params={"path": "src/app"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert env.hub.calls[0]["params"]["path"] == r"C:\repo\src\app"


async def test_tree_posix_root_rel_join(client: AsyncClient, setup_explorer):
    """POSIX 形态 root：rel 拼成正斜杠绝对路径下发。"""
    env = await setup_explorer(result=TREE_RESULT, root_path="/srv/repo")
    resp = await client.get(
        f"{_base(env)}/tree",
        params={"path": "src/app"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert env.hub.calls[0]["params"]["path"] == "/srv/repo/src/app"


async def test_file_200_and_rpc_contract(client: AsyncClient, setup_explorer):
    """file 正常路径：200 + 响应契约 + encoding=utf8 + 30s 超时。"""
    env = await setup_explorer(result=FILE_RESULT)
    resp = await client.get(
        f"{_base(env)}/file",
        params={"path": "README.md"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == FILE_RESULT

    call = env.hub.calls[0]
    assert call["method"] == "explorer_read_file"
    assert call["params"]["path"] == r"C:\repo\README.md"
    assert call["params"]["encoding"] == "utf8"
    assert call["timeout"] == READ_FILE_RPC_TIMEOUT_SECONDS


async def test_search_200_truncated_passthrough_and_rpc_contract(
    client: AsyncClient, setup_explorer
):
    """search 正常路径：200 + matches/truncated 透传 + 60s 超时 + max_results 默认。"""
    env = await setup_explorer(result=SEARCH_RESULT)
    resp = await client.get(
        f"{_base(env)}/search",
        params={"q": "page"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == SEARCH_RESULT  # truncated=True 原样透传

    call = env.hub.calls[0]
    assert call["method"] == "explorer_search"
    assert call["params"] == {
        "root": env.root_path,
        "query": "page",
        "max_results": 100,
    }
    assert call["timeout"] == SEARCH_RPC_TIMEOUT_SECONDS


@pytest.mark.parametrize("q", [None, ""])
async def test_search_q_missing_or_empty_returns_422(
    client: AsyncClient, setup_explorer, q: str | None
):
    """search 缺 q / 空 q → FastAPI Query 校验 422（不发 RPC）。"""
    env = await setup_explorer(result=SEARCH_RESULT)
    params = {} if q is None else {"q": q}
    resp = await client.get(f"{_base(env)}/search", params=params, headers=_bearer(env.token))
    assert resp.status_code == 422, resp.text
    assert env.hub.calls == []


# ────────────────────────────────────────────────────────────────────────────
# containment 拒绝矩阵（design §5.2 预检 → 422，且预检先于 RPC）
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("root_path", "bad_rel"),
    [
        # 绝对路径（POSIX 形态，在两种 root 语义下都拒）
        (r"C:\repo", "/etc/passwd"),
        ("/srv/repo", "/etc/passwd"),
        # Windows 盘符绝对路径
        (r"C:\repo", r"C:\Windows\System32"),
        # UNC 前缀（join 会整体替换 base）
        (r"C:\repo", r"\\server\share"),
        # ``..`` 逃逸（Windows / POSIX 两种分隔符）
        (r"C:\repo", r"..\escape"),
        (r"C:\repo", r"a\..\..\b"),
        ("/srv/repo", "../escape"),
        ("/srv/repo", "a/../../b"),
        # 控制字符（\n 与 NUL）
        ("/srv/repo", "a\nb"),
        (r"C:\repo", "a\x00b"),
    ],
)
async def test_containment_rejects_malicious_rel_paths(
    client: AsyncClient, setup_explorer, root_path: str, bad_rel: str
):
    """containment 预检矩阵：越界 rel → 422 HTTP_422_EXPLORER_PATH_OUTSIDE_ROOT。"""
    env = await setup_explorer(result=TREE_RESULT, root_path=root_path)
    resp = await client.get(
        f"{_base(env)}/tree", params={"path": bad_rel}, headers=_bearer(env.token)
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_EXPLORER_PATH_OUTSIDE_ROOT"
    # 预检在 RPC 之前——daemon 不应被惊动。
    assert env.hub.calls == []


async def test_containment_rejects_on_file_endpoint_too(client: AsyncClient, setup_explorer):
    """file 端点同样过 containment 预检（不是只挡 tree）。"""
    env = await setup_explorer(result=FILE_RESULT)
    resp = await client.get(
        f"{_base(env)}/file", params={"path": "../../etc/passwd"}, headers=_bearer(env.token)
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_EXPLORER_PATH_OUTSIDE_ROOT"


# ────────────────────────────────────────────────────────────────────────────
# 绑定解析（design §5.4 / D-003@v1）
# ────────────────────────────────────────────────────────────────────────────


async def test_no_binding_row_returns_404_not_bound(client: AsyncClient, setup_explorer):
    """无绑定行 → 404 HTTP_404_EXPLORER_NOT_BOUND，中文引导到成员页。"""
    env = await setup_explorer(with_binding=False)
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_404_EXPLORER_NOT_BOUND"
    assert "未绑定" in body["message"]
    assert env.hub.calls == []


async def test_binding_daemon_id_null_returns_404_not_bound(client: AsyncClient, setup_explorer):
    """绑定行存在但 daemon_id IS NULL（合法过渡形态）→ 同样 404 未绑定。"""
    env = await setup_explorer(daemon_id_null=True)
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_EXPLORER_NOT_BOUND"
    assert env.hub.calls == []


# ────────────────────────────────────────────────────────────────────────────
# RPC 错误映射全表（design §7.2）
# ────────────────────────────────────────────────────────────────────────────


async def test_rpc_offline_maps_502(client: AsyncClient, setup_explorer):
    """daemon 无连接 / 发送失败 → 502 HTTP_502_EXPLORER_DAEMON_OFFLINE。"""
    env = await setup_explorer(
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection).")
    )
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_EXPLORER_DAEMON_OFFLINE"


async def test_rpc_mid_rpc_disconnect_maps_502_transfer_interrupted(
    client: AsyncClient, setup_explorer
):
    """RPC 在途断连（ws_hub 文案含 mid-rpc）→ 502 HTTP_502_EXPLORER_TRANSFER_INTERRUPTED。"""
    env = await setup_explorer(exc=DaemonRuntimeOffline("daemon 'x' disconnected mid-rpc."))
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_EXPLORER_TRANSFER_INTERRUPTED"


async def test_rpc_timeout_maps_504(client: AsyncClient, setup_explorer):
    """RPC 往返超时 → 504 HTTP_504_EXPLORER_RPC_TIMEOUT。"""
    env = await setup_explorer(exc=DaemonRpcTimeout("rpc timed out"))
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 504, resp.text
    assert resp.json()["code"] == "HTTP_504_EXPLORER_RPC_TIMEOUT"


async def test_rpc_forbidden_maps_403(client: AsyncClient, setup_explorer):
    """daemon code=forbidden（realpath 逃逸 / allowed_roots 拒绝）→ 403。"""
    env = await setup_explorer(
        exc=DaemonRpcRemoteError({"code": "forbidden", "message": "outside allowed roots"})
    )
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "HTTP_403_EXPLORER_DAEMON_FORBIDDEN"


async def test_rpc_not_found_maps_404(client: AsyncClient, setup_explorer):
    """daemon code=not_found（路径不存在 / root 已删）→ 404。"""
    env = await setup_explorer(
        exc=DaemonRpcRemoteError({"code": "not_found", "message": "no such path"})
    )
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_EXPLORER_PATH_NOT_FOUND"


async def test_rpc_method_not_found_maps_422_daemon_too_old(client: AsyncClient, setup_explorer):
    """旧 daemon 未注册 explorer_*（method_not_found）→ 422 版本过旧中文引导。"""
    env = await setup_explorer(
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "unknown method"})
    )
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_EXPLORER_DAEMON_TOO_OLD"
    assert "版本过旧" in body["message"]


async def test_rpc_internal_maps_502_remote_error(client: AsyncClient, setup_explorer):
    """daemon 其余业务错误（如 internal）→ 502 HTTP_502_EXPLORER_DAEMON_REMOTE。"""
    env = await setup_explorer(exc=DaemonRpcRemoteError({"code": "internal", "message": "boom"}))
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_EXPLORER_DAEMON_REMOTE"


async def test_rpc_malformed_result_maps_502_contract_gap(client: AsyncClient, setup_explorer):
    """daemon 返回缺字段（entries 元素少 type/size/mtime）→ 502 契约缺口显式上报。"""
    env = await setup_explorer(result={"entries": [{"name": "src"}]})
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(env.token))
    assert resp.status_code == 502, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_502_EXPLORER_CONTRACT_GAP"
    assert "契约" in body["message"]


# ────────────────────────────────────────────────────────────────────────────
# download：头契约 + 字节往返
# ────────────────────────────────────────────────────────────────────────────


def _file_result(name: str, payload: bytes, *, truncated: bool = False) -> dict[str, Any]:
    return {
        "name": name,
        "size": 999_999 if truncated else len(payload),
        "mtime": "2026-08-18T10:00:00Z",
        "binary": True,
        "truncated": truncated,
        "content": base64.b64encode(payload).decode("ascii"),
    }


async def test_download_headers_and_byte_roundtrip(client: AsyncClient, setup_explorer):
    """download：attachment + RFC 5987 filename* + 字节 base64 往返无损 + base64 强制。"""
    payload = bytes(range(256)) * 4 + "中文内容".encode()
    env = await setup_explorer(result=_file_result("说明 文档.txt", payload))
    resp = await client.get(
        f"{_base(env)}/download",
        params={"path": "docs/说明 文档.txt"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    # 字节无损：二进制 + 非 ASCII 文件名都不被文本往返损坏。
    assert resp.content == payload
    # 头契约：attachment + RFC 5987 filename*（quote 后的中文名）。
    cd = resp.headers["Content-Disposition"]
    assert cd.startswith("attachment")
    assert f"filename*=UTF-8''{quote('说明 文档.txt')}" in cd
    # Content-Length 等于实际 body 字节数。
    assert resp.headers["Content-Length"] == str(len(payload))
    assert "X-Truncated" not in resp.headers
    # RPC 契约：encoding=base64 强制 + 60s 超时 + 绝对路径。
    call = env.hub.calls[0]
    assert call["method"] == "explorer_read_file"
    assert call["params"]["encoding"] == "base64"
    assert call["params"]["path"] == r"C:\repo\docs\说明 文档.txt"
    assert call["timeout"] == DOWNLOAD_RPC_TIMEOUT_SECONDS


async def test_download_truncated_sets_header_and_content_length(
    client: AsyncClient, setup_explorer
):
    """truncated：X-Truncated=true；Content-Length 反映截断后的实际字节而非原 size。"""
    payload = b"abc"  # daemon 侧已按 10MB 上限截断后的在途字节
    env = await setup_explorer(result=_file_result("big.bin", payload, truncated=True))
    resp = await client.get(
        f"{_base(env)}/download",
        params={"path": "big.bin"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["X-Truncated"] == "true"
    assert resp.headers["Content-Length"] == "3"  # 不是原文件 size=999999
    assert resp.content == payload


async def test_download_ascii_filename_fallback(client: AsyncClient, setup_explorer):
    """纯 ASCII 文件名：filename=\"...\" 回退头可用（老客户端/老浏览器兼容）。"""
    env = await setup_explorer(result=_file_result("readme.md", b"# hi\n"))
    resp = await client.get(
        f"{_base(env)}/download",
        params={"path": "readme.md"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    cd = resp.headers["Content-Disposition"]
    assert 'filename="readme.md"' in cd
    assert "filename*=UTF-8''readme.md" in cd


async def test_download_invalid_base64_maps_502_contract_gap(client: AsyncClient, setup_explorer):
    """daemon 返回不合法 base64 → 502 契约缺口（而非 500）。"""
    result = dict(_file_result("x.bin", b"abc"))
    result["content"] = "!!not-base64!!"
    env = await setup_explorer(result=result)
    resp = await client.get(
        f"{_base(env)}/download",
        params={"path": "x.bin"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "HTTP_502_EXPLORER_CONTRACT_GAP"


# ────────────────────────────────────────────────────────────────────────────
# 鉴权门控：四端点均受 WORKSPACE_READ 保护
# ────────────────────────────────────────────────────────────────────────────


_ALL_ENDPOINTS = [
    "/explorer/tree",
    "/explorer/file?path=a.txt",
    "/explorer/download?path=a.txt",
    "/explorer/search?q=a",
]


@pytest.mark.parametrize("suffix", _ALL_ENDPOINTS)
async def test_endpoints_require_auth_401(client: AsyncClient, setup_explorer, suffix: str):
    """不带 token → 401（四端点逐一验证）。"""
    env = await setup_explorer()
    resp = await client.get(f"/api/workspaces/{env.workspace_id}{suffix}")
    assert resp.status_code == 401, resp.text


async def test_endpoint_non_member_403(client: AsyncClient, setup_explorer, user_factory):
    """合法 token 但非本工作区成员（无 WORKSPACE_READ 语境）→ 403。"""
    env = await setup_explorer()
    _stranger, stranger_tok = await user_factory(email="stranger@x.com")
    resp = await client.get(f"{_base(env)}/tree", headers=_bearer(stranger_tok))
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "HTTP_403_PERMISSION_DENIED"
