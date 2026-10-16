"""GET files 显式同步（sync=1）与默认纯读的行为测试（2026-10-14-files-refresh-explicit-sync；承 2026-10-13-change-files-refresh-sync task-05）。

覆盖 ``_sync_change_via_daemon`` 四路静默降级（D-003@v1：未绑定 / 离线 /
DaemonRpcTimeout / DaemonRpcRemoteError / DaemonRuntimeOffline）与触发成功
路径（D-002@v1：method / change_key / workspace_id / timeout 透传断言）。
镜像扫描本体 ``service.list_files`` 零改动——既有 test_files_router.py 为回归
防线（本套件共用其 fixture 形态，不重复断言文件树内容细节）。

2026-10-16-change-files-sync-result：降级不再无声——响应新增 ``sync_result``
回执（triggered/ok/reason/stderr_tail），下方各用例同时断言回执字段；新增
daemon 结构化失败回执透传（ok:false → reason/stderr_tail）、防抖跳过与
RPC 预算锁定三路。"""

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
    """capture send_rpc 调用参数；exc 编程化注入四路异常场景；result 注入回执形态。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.exc: Exception | None = None
        # daemon 结构化回执（默认成功；ok:false / skipped 形态由用例覆写）
        self.result: dict[str, Any] = {"ok": True, "actions": []}

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


def test_sync_budget_covers_measured_cli_runtime() -> None:
    """RPC 预算锁定 15s（2026-10-16 实测同步耗时 5.5~13.5s，原 3s 恒超时）。

    原 3s 预算下真实同步（daemon 串行两条 CLI）必然超时→静默降级，用户点刷新
    永远拿到旧数据；15s 覆盖实测上界并留余量。"""
    assert _FILES_REFRESH_SYNC_RPC_TIMEOUT_S == 15.0


async def test_online_triggers_sync_before_list(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """sync=1 且绑定在线：send_rpc 被调且 method/change_key/workspace_id/timeout 透传正确，其后返回清单。

    回执成功形态：triggered=True / ok=True / reason=None / stderr_tail=None。"""
    hub = FakeHub()
    daemon_id = uuid.uuid4()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(daemon_id), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
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
    assert body["sync_result"] == {
        "triggered": True,
        "ok": True,
        "reason": None,
        "stderr_tail": None,
    }


async def test_default_read_only_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """默认（不带 sync）：纯读——绑定在线也不触发 send_rpc，直接返回平台镜像数据，回执恒 null。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
    body = resp.json()
    assert any(it["path"].endswith(".md") for it in body["items"])
    assert body["sync_result"] is None


async def test_no_binding_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """sync=1 但未绑定 daemon（等效离线）：不触 send_rpc，回执 triggered=False / no_binding。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=None)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
    assert resp.json()["sync_result"] == {
        "triggered": False,
        "ok": None,
        "reason": "no_binding",
        "stderr_tail": None,
    }


async def test_daemon_offline_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """sync=1 但绑定 daemon 离线：不触 send_rpc，回执 triggered=False / daemon_offline。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=False)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
    assert resp.json()["sync_result"] == {
        "triggered": False,
        "ok": None,
        "reason": "daemon_offline",
        "stderr_tail": None,
    }


async def test_rpc_timeout_degrades(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """sync=1 且 RPC 超时（预算尽）：降级返回现有镜像数据，HTTP 恒 200，回执 ok=False / rpc_timeout。"""
    hub = FakeHub()
    hub.exc = DaemonRpcTimeout("timed out", details={"timeout_seconds": 15})
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert len(hub.calls) == 1
    body = resp.json()
    assert any(it["path"].endswith(".md") for it in body["items"])
    assert body["sync_result"] == {
        "triggered": True,
        "ok": False,
        "reason": "rpc_timeout",
        "stderr_tail": None,
    }


async def test_rpc_remote_error_degrades_old_daemon(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """老 daemon 未注册 method → DaemonRpcRemoteError：降级返回，回执 ok=False / rpc_remote_error。"""
    hub = FakeHub()
    hub.exc = DaemonRpcRemoteError({"code": "method_not_found", "message": "unknown method"})
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(it["path"].endswith(".md") for it in body["items"])
    assert body["sync_result"]["ok"] is False
    assert body["sync_result"]["reason"] == "rpc_remote_error"


async def test_runtime_offline_degrades(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """send 阶段连接丢失（DaemonRuntimeOffline）：降级返回，回执 ok=False / runtime_offline。"""
    hub = FakeHub()
    hub.exc = DaemonRuntimeOffline("offline", details={})
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(it["path"].endswith(".md") for it in body["items"])
    assert body["sync_result"]["ok"] is False
    assert body["sync_result"]["reason"] == "runtime_offline"


async def test_binding_without_daemon_id_skips_sync(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """sync=1 但绑定行 daemon_id 为空（旧行未迁移）：等效未绑定，不触 send_rpc，reason=no_binding。"""
    hub = FakeHub()
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(None))
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert hub.calls == []
    assert resp.json()["sync_result"]["reason"] == "no_binding"


async def test_daemon_cli_failure_result_propagates(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon 结构化失败回执（ok:false）不再被吞：reason 与 stderr_tail 原样透传（2026-10-16 修复核心）。

    现场案例：CLI 在服务器镜像落盘被拒（HTTP 500）时 daemon 回 ok:false +
    stderr_tail，旧实现整个回执丢弃——用户端零提示、排障无据。"""
    hub = FakeHub()
    hub.result = {
        "ok": False,
        "reason": "cli_failed",
        "failed_cmd": "sync",
        "stderr_tail": "exit 1 sync 请求失败 HTTP 500（服务器内部错误）",
    }
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(it["path"].endswith(".md") for it in body["items"])
    assert body["sync_result"]["triggered"] is True
    assert body["sync_result"]["ok"] is False
    assert body["sync_result"]["reason"] == "cli_failed"
    assert "HTTP 500" in body["sync_result"]["stderr_tail"]


async def test_daemon_no_workspace_root_result_propagates(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon 未认领工作区回执（no_workspace_root）透传：与 CLI 失败可区分，供前端差异化提示。"""
    hub = FakeHub()
    hub.result = {"ok": False, "reason": "no_workspace_root"}
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sync_result"]["ok"] is False
    assert resp.json()["sync_result"]["reason"] == "no_workspace_root"


async def test_daemon_debounce_skip_maps_to_info(
    client, files_ws: dict, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon 防抖跳过（15s 内已同步过）：ok=None / reason=skipped_debounced，不算失败。"""
    hub = FakeHub()
    hub.result = {"skipped": "debounced", "last_sync_at": 1760600000000}
    _install_sync_mocks(monkeypatch, hub, binding=FakeBinding(uuid.uuid4()), daemon_online=True)
    resp = await client.get(
        f"/api/workspaces/{files_ws['ws_id']}/changes/{files_ws['change_id']}/files?sync=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sync_result"] == {
        "triggered": True,
        "ok": None,
        "reason": "skipped_debounced",
        "stderr_tail": None,
    }
