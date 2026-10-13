"""GET files 刷新前置同步的降级链测试（2026-10-13-change-files-refresh-sync task-05）。

覆盖 ``_sync_change_via_daemon`` 四路静默降级（D-003@v1：未绑定 / 离线 /
DaemonRpcTimeout / DaemonRpcRemoteError / DaemonRuntimeOffline）与触发成功
路径（D-002@v1：method / change_key / workspace_id / timeout 透传断言）。
镜像扫描本体 ``service.list_files`` 零改动——既有 test_files_router.py 为回归
防线（本套件共用其 fixture 形态，不重复断言文件树内容细节）。"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

import pytest

from app.modules.change.router import _FILES_REFRESH_SYNC_RPC_TIMEOUT_S
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


class FakeHub:
    """capture send_rpc 调用参数；exc 编程化注入四路异常场景。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.exc: Exception | None = None

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
        return {"ok": True, "actions": []}


class FakeBinding:
    def __init__(self, daemon_id: uuid.UUID | None) -> None:
        self.daemon_id = daemon_id


@pytest.fixture()
async def files_ws(client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn) -> dict:
    """对齐 test_files_router.workspace_with_changes：服务器 spec_root 扁平布局。"""
    root = tmp_path / "ws"
    shutil.copytree(COMPONENT_FIXTURES, root)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "files-refresh-sync-test", "type": "other", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]
    spec_root = seed_spec_root_fn(ws_id, COMPONENT_FIXTURES)
    changes_root = Path(spec_root) / "changes"
    changes_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, changes_root, dirs_exist_ok=True)
    await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
    list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
    items = list_resp.json()["items"]
    if not items:
        await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
        list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
        items = list_resp.json()["items"]
    assert len(items) > 0
    active = next(it for it in items if it.get("location") == "active")
    return {
        "ws_id": ws_id,
        "change_id": active["id"],
        "change_key": active["change_key"],
        "spec_root": str(spec_root),
    }


def _install_sync_mocks(
    monkeypatch: pytest.MonkeyPatch,
    hub: FakeHub,
    *,
    binding: FakeBinding | None,
    daemon_online: bool = True,
) -> None:
    """懒导入三依赖的源模块属性打点（router 函数体内 import，patch 源模块即生效）。"""
    import app.modules.daemon.ws_hub as ws_hub_module
    import app.modules.workspace.member_runtimes.queries as queries_module
    import app.modules.workspace.member_runtimes.resolver as resolver_module

    async def _fake_binding(session, workspace_id, actor_user_id):
        return binding

    async def _fake_online(session, daemon_id, user_id):
        return {"id": str(daemon_id)} if daemon_online else None

    monkeypatch.setattr(
        resolver_module.MemberBindingResolver,
        "resolve_member_binding_or_none",
        staticmethod(_fake_binding),
    )
    monkeypatch.setattr(queries_module, "query_daemon_online_by_id", _fake_online)
    monkeypatch.setattr(ws_hub_module, "get_daemon_ws_hub", lambda: hub)


async def test_online_triggers_sync_before_list(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """绑定在线：send_rpc 被调且 method/change_key/workspace_id/timeout 透传正确，其后返回清单。"""
    hub = FakeHub()
    daemon_id = uuid.uuid4()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(daemon_id), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert len(hub.calls) == 1
    call = hub.calls[0]
    assert call["daemon_id"] == daemon_id
    assert call["method"] == "sillyspec_sync_change"
    assert call["params"]["change"] == files_ws["change_key"]
    assert call["params"]["workspace_id"] == files_ws["ws_id"]
    assert call["timeout"] == _FILES_REFRESH_SYNC_RPC_TIMEOUT_S
    body = resp.json()
    assert body["change_id"] == files_ws["change_id"]
    assert any(it["path"].endswith(".md") for it in body["items"])


async def test_no_binding_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """未绑定 daemon（等效离线）：不触 send_rpc，正常返回现有镜像数据。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=None)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []


async def test_daemon_offline_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """绑定 daemon 离线：不触 send_rpc，正常返回。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=False)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []


async def test_rpc_timeout_degrades(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """RPC 超时（15s 预算尽）：降级返回现有镜像数据，HTTP 恒 200。"""
    hub = FakeHub()
    hub.exc = DaemonRpcTimeout("timed out", details={"timeout_seconds": 15})
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert len(hub.calls) == 1
    assert any(it["path"].endswith(".md") for it in resp.json()["items"])


async def test_rpc_remote_error_degrades_old_daemon(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """老 daemon 未注册 method → DaemonRpcRemoteError：降级返回（前后端无版本耦合）。"""
    hub = FakeHub()
    hub.exc = DaemonRpcRemoteError({"code": "method_not_found", "message": "unknown method"})
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert any(it["path"].endswith(".md") for it in resp.json()["items"])


async def test_runtime_offline_degrades(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """send 阶段连接丢失（DaemonRuntimeOffline）：降级返回。"""
    hub = FakeHub()
    hub.exc = DaemonRuntimeOffline("offline", details={})
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert any(it["path"].endswith(".md") for it in resp.json()["items"])


async def test_binding_without_daemon_id_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """绑定行存在但 daemon_id 为空（旧行未迁移）：等效未绑定，不触 send_rpc。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(None))
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
