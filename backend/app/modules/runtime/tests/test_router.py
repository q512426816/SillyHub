"""HTTP-level tests for the runtime router（2026-08-19-runtime-live-daemon-read）。

task-08：全部改用 mock daemon RPC（FakeHub 假件，与 test_live_service.py 同
打法）——不再写本地 ``sillyspec.db`` 快照文件（design §10 验收：后端 runtime
模块测试不依赖本地文件系统）。

覆盖：

- 5 端点成功路径（progress / user-inputs 解析 / user-inputs raw / artifacts /
  artifact content），RPC 方法名与参数契约；
- 错误映射到 HTTP 状态（离线 502 / 超时 504 / 未绑定 404 / daemon 过旧 422 /
  路径不存在 404）；
- 鉴权门控（无 token → 401）；
- workspace 不存在 → 404（权限门先于绑定解析）。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)

pytestmark = pytest.mark.asyncio


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


@pytest.fixture()
async def runtime_env(client, db_session, monkeypatch, auth_headers):
    """搭 HTTP 级场景：workspace + 绑定行 + 假 hub；返回操作句柄。

    直接用 conftest 的 ``client`` + ``auth_headers``（已有 RUNTIME_READ 权限的
    平台管理员路径），workspace 经 API 建，绑定行直插模型。
    """
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    async def _make(
        *,
        result: Any = None,
        exc: BaseException | None = None,
        with_binding: bool = True,
        daemon_id_null: bool = False,
    ) -> dict:
        ws_resp = await client.post(
            "/api/workspaces",
            json={
                "name": f"rt-{uuid.uuid4().hex[:6]}",
                "root_path": f"/tmp/rt-{uuid.uuid4().hex[:6]}",
                "type": "other",
            },
            headers=auth_headers,
        )
        assert ws_resp.status_code == 201, ws_resp.text
        ws_id = ws_resp.json()["id"]

        # auth_headers 对应的用户：从 token 解或用 client 上下文——这里直接查
        # workspace owner（创建者即当前用户）。
        from app.modules.workspace.model import Workspace

        ws = await db_session.get(Workspace, uuid.UUID(ws_id))
        owner_id = ws.created_by

        daemon_id = uuid.uuid4()
        if with_binding:
            db_session.add(
                WorkspaceMemberRuntime(
                    workspace_id=uuid.UUID(ws_id),
                    user_id=owner_id,
                    daemon_id=None if daemon_id_null else daemon_id,
                    root_path=r"C:\repo",
                    path_source="daemon-client",
                )
            )
            await db_session.commit()

        hub = FakeHub(result=result, exc=exc)
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        return {"ws_id": ws_id, "hub": hub, "daemon_id": daemon_id}

    return _make


# ────────────────────────────────────────────────────────────────────────────
# 1. 端点成功路径
# ────────────────────────────────────────────────────────────────────────────


async def test_get_runtime_progress(runtime_env, auth_headers):
    env = await runtime_env(
        result={
            "progress": {
                "version": 5,
                "project": "test-project",
                "current_stage": "execute",
                "current_change": "change-001",
                "stages": {
                    "scan": {"status": "completed", "steps": []},
                    "execute": {
                        "status": "in-progress",
                        "steps": [{"name": "Wave 1", "status": "completed"}],
                    },
                },
                "last_active": "2026-08-19T10:00:00Z",
            }
        }
    )
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime", auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["project"] == "test-project"
    assert body["current_stage"] == "execute"
    assert body["current_change"] == "change-001"
    assert body["stages"]["scan"]["status"] == "completed"
    # RPC 契约（root_path 取 fixture 绑定行的 C:\repo；无前缀配置原样下发）
    call = env["hub"].calls[0]
    assert call["method"] == "runtime.read_progress"
    assert call["params"] == {"workspace_id": env["ws_id"], "root_path": r"C:\repo"}


async def test_get_runtime_progress_none(runtime_env, auth_headers):
    """daemon 返回 progress=None → HTTP 200 + body null。"""
    env = await runtime_env(result={"progress": None})
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime", auth_headers)
    assert resp.status_code == 200
    assert resp.json() is None


async def test_get_user_inputs_parsed(runtime_env, auth_headers):
    """user-inputs.md 原文 → 逐行解析条目（响应结构与旧版兼容）。"""
    env = await runtime_env(result={"content": "# 标题\n\n第一条\n第二条\n"})
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime/user-inputs", auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert [e["content"] for e in body] == ["第一条", "第二条"]
    assert env["hub"].calls[0]["method"] == "runtime.read_user_inputs"


async def test_get_user_inputs_raw(runtime_env, auth_headers):
    env = await runtime_env(result={"content": "# raw\ncontent\n"})
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime/user-inputs/raw", auth_headers)
    assert resp.status_code == 200
    assert resp.text == "# raw\ncontent\n"


async def test_get_user_inputs_missing_returns_empty(runtime_env, auth_headers):
    """daemon 返回 content=None → 解析为空列表（与旧行为一致）。"""
    env = await runtime_env(result={"content": None})
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime/user-inputs", auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_artifacts(runtime_env, auth_headers):
    env = await runtime_env(
        result={
            "artifacts": [
                {"filename": "design.md", "size_bytes": 100, "last_modified": None},
            ]
        }
    )
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime/artifacts", auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["filename"] == "design.md"
    assert body[0]["size_bytes"] == 100
    assert env["hub"].calls[0]["method"] == "runtime.list_artifacts"


async def test_get_artifact_content(runtime_env, auth_headers):
    env = await runtime_env(result={"content": "# 产物\n"})
    resp = await client_get(
        f"/api/workspaces/{env['ws_id']}/runtime/artifacts/design.md", auth_headers
    )
    assert resp.status_code == 200
    assert resp.text == "# 产物\n"
    call = env["hub"].calls[0]
    assert call["method"] == "runtime.read_artifact"
    assert call["params"]["filename"] == "design.md"


async def test_get_artifact_content_missing_returns_empty(runtime_env, auth_headers):
    env = await runtime_env(result={"content": None})
    resp = await client_get(
        f"/api/workspaces/{env['ws_id']}/runtime/artifacts/gone.md", auth_headers
    )
    assert resp.status_code == 200
    assert resp.text == ""


# ───────────────────────────────── conftest 访问辅助 ─────────────────────────


async def client_get(url: str, auth_headers: dict[str, str]):
    """runtime_env fixture 内拿不到 client——经模块级引用取。"""
    return await _get_client().get(url, headers=auth_headers)


_client_ref: AsyncClient | None = None


def _get_client() -> AsyncClient:
    assert _client_ref is not None, "client fixture 未初始化（runtime_env 先行）"
    return _client_ref


@pytest.fixture(autouse=True)
def _capture_client(client: AsyncClient):
    """把 conftest 的 client 存到模块级引用，供 client_get 辅助函数使用。"""
    global _client_ref
    _client_ref = client
    yield
    _client_ref = None


# ────────────────────────────────────────────────────────────────────────────
# 2. 错误映射到 HTTP 状态
# ────────────────────────────────────────────────────────────────────────────


async def test_offline_returns_502(runtime_env, auth_headers):
    env = await runtime_env(exc=DaemonRuntimeOffline("daemon offline", details=None))
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime", auth_headers)
    assert resp.status_code == 502
    assert "离线" in resp.json()["message"]


async def test_timeout_returns_504(runtime_env, auth_headers):
    env = await runtime_env(exc=DaemonRpcTimeout("timeout", details=None))
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime", auth_headers)
    assert resp.status_code == 504


async def test_not_bound_returns_404(runtime_env, auth_headers):
    env = await runtime_env(with_binding=False)
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime", auth_headers)
    assert resp.status_code == 404
    assert "绑定" in resp.json()["message"]


async def test_null_daemon_id_returns_404(runtime_env, auth_headers):
    env = await runtime_env(daemon_id_null=True)
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime/user-inputs", auth_headers)
    assert resp.status_code == 404


async def test_daemon_too_old_returns_422(runtime_env, auth_headers):
    env = await runtime_env(
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "no such"})
    )
    resp = await client_get(f"/api/workspaces/{env['ws_id']}/runtime", auth_headers)
    assert resp.status_code == 422
    assert "升级" in resp.json()["message"]


async def test_artifact_not_found_returns_404(runtime_env, auth_headers):
    env = await runtime_env(exc=DaemonRpcRemoteError({"code": "not_found", "message": "missing"}))
    resp = await client_get(
        f"/api/workspaces/{env['ws_id']}/runtime/artifacts/gone.md", auth_headers
    )
    assert resp.status_code == 404


async def test_bad_filename_returns_404_via_precheck(runtime_env, auth_headers):
    """filename 预检拒绝（..）→ 422/404，hub 不被调用。"""
    env = await runtime_env(result={"content": "x"})
    resp = await client_get(
        f"/api/workspaces/{env['ws_id']}/runtime/artifacts/..%2Fescape.md",
        auth_headers,
    )
    assert resp.status_code in (404, 422)
    assert env["hub"].calls == []


# ────────────────────────────────────────────────────────────────────────────
# 3. 鉴权与不存在 workspace
# ────────────────────────────────────────────────────────────────────────────


async def test_no_auth_returns_401(client):
    resp = await client.get("/api/workspaces/00000000-0000-0000-0000-000000000000/runtime")
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(client, auth_headers):
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 404
