"""POST /changes/{id}/hits-sync 知识遥测补数端点行为测试（2026-10-27-knowledge-hits-flush-button task-03）。

覆盖 ``_flush_hits_via_daemon`` 降级铁律（照 ``_sync_change_via_daemon`` D-003@v1
同族）：未绑定 / 离线 / DaemonRpcTimeout / DaemonRpcRemoteError（老 daemon method
not found）各路均 HTTP 200 携带回执不抛；触发成功路径断言 method / workspace_id /
timeout 透传；daemon 结构化回执（ok:false → upload_failed 透传；ok:true +
reason=in_flight 去重秒回）两形态。fixture 与 mock 形态照 test_files_refresh_sync.py
先例（FakeHub / FakeBinding / _install_sync_mocks）。
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

import pytest

from app.modules.change.router import _HITS_SYNC_RPC_TIMEOUT_S
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
)

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


class FakeHub:
    """capture send_rpc 调用参数；exc 编程化注入异常场景；result 注入回执形态。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.exc: Exception | None = None
        # daemon 结构化回执（默认成功；ok:false / in_flight 形态由用例覆写）
        self.result: dict[str, Any] = {"ok": True}

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


class FakeBinding:
    def __init__(self, daemon_id: uuid.UUID | None) -> None:
        self.daemon_id = daemon_id


@pytest.fixture()
async def hits_ws(client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn) -> dict:
    """对齐 test_files_refresh_sync.files_ws：服务器 spec_root 扁平布局 + 一个活跃变更。"""
    root = tmp_path / "ws"
    shutil.copytree(COMPONENT_FIXTURES, root)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "hits-sync-test", "type": "other", "root_path": str(root)},
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
    return {"ws_id": ws_id, "change_id": active["id"], "change_key": active["change_key"]}


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


async def test_online_triggers_flush_rpc(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """绑定在线：send_rpc 被调且 method/workspace_id/timeout 透传正确，回执成功形态。"""
    hub = FakeHub()
    daemon_id = uuid.uuid4()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(daemon_id), daemon_online=True)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert len(hub.calls) == 1
    call = hub.calls[0]
    assert call["daemon_id"] == daemon_id
    assert call["method"] == "sillyspec_hits_flush"
    assert call["params"] == {"workspace_id": hits_ws["ws_id"]}
    assert call["timeout"] == _HITS_SYNC_RPC_TIMEOUT_S
    assert resp.json() == {"triggered": True, "ok": True, "reason": None}


async def test_no_binding_degrades(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """未绑定 daemon：不触 send_rpc，HTTP 200 回执 triggered=False / no_binding。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=None)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
    assert resp.json() == {"triggered": False, "ok": None, "reason": "no_binding"}


async def test_daemon_offline_degrades(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """绑定存在但 daemon 离线：不触 send_rpc，HTTP 200 回执 triggered=False / daemon_offline。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=False)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
    assert resp.json() == {"triggered": False, "ok": None, "reason": "daemon_offline"}


async def test_rpc_timeout_degrades(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """RPC 超时（预算尽）：HTTP 恒 200，回执 triggered=True / ok=False / rpc_timeout。"""
    hub = FakeHub()
    hub.exc = DaemonRpcTimeout("rpc timeout")
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"triggered": True, "ok": False, "reason": "rpc_timeout"}


async def test_rpc_remote_error_degrades(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """远端错误（含老 daemon 未注册 method 的 method not found）：降级回执不抛。"""
    hub = FakeHub()
    # DaemonRpcRemoteError 携带 daemon 错误 dict（code/message）——method not
    # found 形态对齐老 daemon 未注册新 RPC 的真实回包。
    hub.exc = DaemonRpcRemoteError(
        {"code": "method_not_found", "message": "method not found: sillyspec_hits_flush"}
    )
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"triggered": True, "ok": False, "reason": "rpc_remote_error"}


async def test_daemon_upload_failed_receipt_passthrough(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon 结构化失败回执：ok=false + reason=upload_failed 原样透传。"""
    hub = FakeHub()
    hub.result = {"ok": False, "reason": "upload_failed"}
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"triggered": True, "ok": False, "reason": "upload_failed"}


async def test_daemon_in_flight_receipt_is_ok(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon in-flight 去重秒回：ok=true + reason=in_flight——完成语义（非失败）。"""
    hub = FakeHub()
    hub.result = {"ok": True, "reason": "in_flight"}
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{hits_ws['change_id']}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"triggered": True, "ok": True, "reason": "in_flight"}


async def test_change_not_found_404(
    client, hits_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """变更不存在或不属于该工作区：404（与其余变更端点同语义，先于 daemon 通道判定）。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.post(
        f"/api/workspaces/{hits_ws['ws_id']}/changes/{uuid.uuid4()}/hits-sync",
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text
    assert hub.calls == []
