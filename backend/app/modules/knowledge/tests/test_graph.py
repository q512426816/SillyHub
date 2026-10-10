"""知识图谱三端点（change 2026-10-08-platform-knowledge-graph task-02/task-03）
+ dump 端点组（2026-10-09-knowledge-graph-fullmap task-03）。

GET /workspaces/{ws}/knowledge/graph/{query,overview,nodes,dump} 的 RPC mock 全分支
测试（范式复用 test_governance.py 的 _FakeHub + monkeypatch _resolve_binding /
resolve_root_path_for_daemon 恒等——不发真 RPC）：

- 五查询 happy path：CLI ``--json`` 实际形状（sillyspec@3.32.1 knowledge-graph.js）
  → DTO 逐字段归一断言（anchor←query.key、byType→by_type、orphans/dangling 数组
  →items、dangling {edge,missing,strength}→{id,type,kind,detail}、count 保真）；
- reason 六键全态：unbound（未绑定自然态）/offline/timeout（DaemonRpcTimeout 与
  RemoteError.code=timeout 双路）/upgrade_required（method_unregistered 与
  cli_subcommand_missing 双路）/invalid_input/rpc_error（internal 与
  DaemonRpcConflict 兜底）；
- overview 三 RPC 逐条容错组合（summary 单独降级 / orphans 单独降级 / 全失败按
  首错误整信封降级）；
- 路由序（字面量不被 {filename:path} 通配吞）/ 权限 403 / nodes 透传 / 参数 422；
- dump 组：手动 gzip（Content-Encoding 头 + httpx 透明解压可还原=真 gzip 钉）、
  大 payload（>100KB）压缩生效（spy gzip.compress 入/出字节）、压缩面未外溢
  反例（既有小端点无 Content-Encoding 头，Grill F-00）、cli_feature_missing:dump
  →upgrade_required 显式分支（区别 cli_feature_missing:* 其它值的 rpc_error 兜底）。
"""

import gzip
import shutil
import uuid
from pathlib import Path

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"

# ── CLI --json 实际形状样本（对齐 sillyspec@3.32.1 src/knowledge-graph.js 输出）───

_CLI_NEIGHBORS = {
    "ok": True,
    "query": {"sub": "neighbors", "key": "decisions/daemon.md#D-001", "edges": "all"},
    "summary": ["→ fr  FR-core-001"],
    "nodes": [
        {"id": "decisions/daemon.md#D-001", "type": "decision", "label": "D-001 RPC 先例"},
        {"id": "knowledge/fr/core.md#FR-core-001", "type": "fr", "label": "FR-core-001"},
    ],
    "edges": [
        {
            "s": "decisions/daemon.md#D-001",
            "t": "knowledge/fr/core.md#FR-core-001",
            "type": "supersedes",
            "strength": "strong",
        },
    ],
}

_CLI_PATH = {
    "ok": True,
    "query": {
        "sub": "path",
        "from": "changes/2026-10-08-x/design.md",
        "to": "knowledge/fr/core.md#FR-core-001",
    },
    "found": True,
    "reason": "",
    "hop_count": 1,
    "hops": [
        {
            "s": "changes/2026-10-08-x/design.md",
            "t": "knowledge/fr/core.md#FR-core-001",
            "type": "describes",
        },
    ],
}

_CLI_IMPACT = {
    "ok": True,
    "query": {"sub": "impact", "key": "changes/2026-10-08-x/design.md", "rule": "强边闭包"},
    "closure": ["changes/2026-10-08-x/design.md", "module:backend"],
    "modules": ["module:backend"],
    "decisions_and_frs": [
        {"id": "decisions/daemon.md#D-002", "type": "decision", "status": "rejected"},
    ],
    "rejected_reachable": [
        {"id": "decisions/daemon.md#D-002", "title": "D-002", "reason": "死路：被 D-003 取代"},
    ],
}

_CLI_ORPHANS = {
    "ok": True,
    "query": {"sub": "orphans"},
    "count": 2,
    "orphans": [
        {"id": "knowledge/uncategorized.md#a", "type": "doc", "kind": "zero-degree"},
        {"id": "2026-10-08-x#entry-1", "type": "entry", "kind": "entry-no-route-no-strong"},
    ],
}

_CLI_DANGLING = {
    "ok": True,
    "query": {"sub": "dangling"},
    "count": 1807,  # count 保真（daemon 裁剪 items top-50，count 保留原值）
    "dangling": [
        {
            "edge": {"s": "knowledge/INDEX.md", "t": "docs/gone.md", "type": "route"},
            "missing": "docs/gone.md",
            "strength": "medium",
        },
    ],
}

_CLI_SUMMARY = {
    "ok": True,
    "query": {"sub": "summary", "clusters": 2},
    "stats": {
        "nodes": 12,
        "edges": 20,
        "byType": {"fr": 5, "decision": 4},
        "byEdge": {"describes": 8, "supersedes": 2},
        "orphans": 2,
        "module_doc_gaps": 1,
        "changelog_danglings": 1,
        "dangling_refs": 1807,
        "clusters": [
            {
                "key": "fr:core",
                "label": "core",
                "count": 5,
                "representatives": [
                    {
                        "id": "knowledge/fr/core.md#FR-core-001",
                        "type": "fr",
                        "label": "FR-core-001",
                    },
                ],
            },
        ],
    },
    "summary": ["节点 12 · 边 20"],
}

_CLI_NODES = {
    "ok": True,
    "query": {"sub": "nodes", "search": "fr", "limit": 20},
    "count": 1,
    "nodes": [
        {"id": "knowledge/fr/core.md#FR-core-001", "type": "fr", "label": "FR-core-001"},
    ],
}

# dump 形状（2026-10-09-knowledge-graph-fullmap task-03，CLI 离线预计算坐标）：
# {ok, nodes:[{id,type,label,x,y}], edges, stats}——stats 与 summary 同源（复用
# _CLI_SUMMARY 的 stats 断言 byType→by_type 归一在 dump 链路同样生效）。
_CLI_DUMP = {
    "ok": True,
    "query": {"sub": "dump", "layout": True},
    "nodes": [
        # x/y 为 CLI Math.round 整数值（int 进 float DTO 承载）
        {"id": "module:backend", "type": "module", "label": "backend", "x": 120, "y": -50},
        {
            "id": "knowledge/fr/core.md#FR-core-001",
            "type": "fr",
            "label": "FR-core-001",
            "x": 300.5,
            "y": 88.25,
        },
    ],
    "edges": [
        {
            "s": "changes/2026-10-09-fullmap/design.md",
            "t": "knowledge/fr/core.md#FR-core-001",
            "type": "describes",
            "strength": "medium",
        },
        {
            "s": "decisions/daemon.md#D-001",
            "t": "knowledge/fr/core.md#FR-core-001",
            "type": "supersedes",
            "strength": "strong",
        },
    ],
    "stats": _CLI_SUMMARY["stats"],
}


def _big_dump_graph(node_count: int = 1600) -> dict:
    """>100KB 大 payload mock（确定性生成：重复 id 模式压缩率高，gzip 比断言稳）。"""
    nodes = [
        {
            "id": f"knowledge/gen/file-{i // 50:04d}.md#FR-gen-{i:05d}",
            "type": "fr",
            "label": f"FR-gen-{i:05d}·全图节点",
            "x": float((i * 37) % 5000),
            "y": float((i * 53) % 5000),
        }
        for i in range(node_count)
    ]
    edges = [
        {"s": nodes[i]["id"], "t": nodes[i + 1]["id"], "type": "describes", "strength": "strong"}
        for i in range(node_count - 1)
    ]
    return {
        "ok": True,
        "query": {"sub": "dump", "layout": True},
        "nodes": nodes,
        "edges": edges,
        "stats": _CLI_SUMMARY["stats"],
    }


_BY_SUB = {
    "neighbors": _CLI_NEIGHBORS,
    "path": _CLI_PATH,
    "impact": _CLI_IMPACT,
    "orphans": _CLI_ORPHANS,
    "dangling": _CLI_DANGLING,
    "summary": _CLI_SUMMARY,
    "nodes": _CLI_NODES,
}


async def _mk_ws(client, db_session, tmp_path, auth_headers) -> dict:
    """建区（test_governance.py:29-52 范式：copytree valid 夹具 + 改库 spec_root）。"""
    root = tmp_path / "graph-ws"
    shutil.copytree(COMPONENT_FIXTURES, root)
    (root / "knowledge").mkdir(parents=True, exist_ok=True)
    (root / "knowledge" / "INDEX.md").write_text("# idx\n", encoding="utf-8")
    resp = await client.post(
        "/api/workspaces",
        json={"name": f"graph-{uuid.uuid4().hex[:6]}", "root_path": str(root), "type": "other"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    from sqlmodel import select

    from app.modules.spec_workspace.model import SpecWorkspace

    spec_ws = (
        await db_session.execute(
            select(SpecWorkspace).where(SpecWorkspace.workspace_id == uuid.UUID(resp.json()["id"]))
        )
    ).scalar_one()
    spec_ws.spec_root = str(root)
    await db_session.commit()
    return {"ws_id": resp.json()["id"], "root": root}


def _mock_graph(monkeypatch, handler) -> object:
    """RPC 面具（test_governance.py:192-225 范式）：假绑定 + 假 hub，handler 按
    (method, params) 返回 ``{"graph": ...}`` 信封或抛异常族；返回 hub 以检视 calls。"""

    import app.modules.daemon.ws_hub as ws_hub_mod
    from app.modules.runtime.service import RuntimeLiveService

    async def _fake_resolve(self, workspace_id, user_id):
        return "daemon-graph-1", "/repo/graph"

    monkeypatch.setattr(RuntimeLiveService, "_resolve_binding", _fake_resolve)
    monkeypatch.setattr("app.modules.workspace.service.resolve_root_path_for_daemon", lambda p: p)

    class _FakeHub:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict]] = []

        async def send_rpc(self, daemon_id, method, params, timeout=60):
            self.calls.append((method, dict(params)))
            return handler(method, params)

    hub = _FakeHub()
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)
    return hub


def _raise(exc: Exception):
    def handler(method, params):
        raise exc

    return handler


async def _plain_user_headers(db_session) -> dict[str, str]:
    """无任何角色/平台管理员权限的普通用户 token（403 用例，test_router.py 同款）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"plain-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Plain",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return {"Authorization": f"Bearer {token}"}


# ── ① 五查询 happy path：CLI 实际形状 → DTO 逐字段 + RPC 参数透传 ──────────────


async def test_graph_query_five_subs_happy_path(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    hub = _mock_graph(monkeypatch, lambda m, p: {"graph": _BY_SUB[p["sub"]]})
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    base = f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query"

    # neighbors：anchor 归一自 CLI query.key；nodes/edges 直传
    resp = await client.get(
        base,
        params={
            "sub": "neighbors",
            "anchor": "decisions/daemon.md#D-001",
            "edges": "supersedes",
            "depth": 2,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["source"] == "daemon-rpc"
    data = body["data"]
    assert data["anchor"] == "decisions/daemon.md#D-001"
    assert [n["id"] for n in data["nodes"]] == [
        "decisions/daemon.md#D-001",
        "knowledge/fr/core.md#FR-core-001",
    ]
    assert data["nodes"][0]["type"] == "decision"
    assert data["edges"][0] == {
        "s": "decisions/daemon.md#D-001",
        "t": "knowledge/fr/core.md#FR-core-001",
        "type": "supersedes",
        "strength": "strong",
    }
    # RPC 参数透传（root 键 = design RPC 契约）
    method, params = hub.calls[-1]
    assert method == "knowledge.graph"
    assert params["sub"] == "neighbors"
    assert params["anchor"] == "decisions/daemon.md#D-001"
    assert params["edges"] == "supersedes"
    assert params["depth"] == 2
    assert params["root"] == "/repo/graph"
    assert params["workspace_id"] == ws["ws_id"]

    # path：from/to 序列化 alias（JSON 键 from，非 from_）
    resp = await client.get(
        base,
        params={
            "sub": "path",
            "anchor": "changes/2026-10-08-x/design.md",
            "anchor2": "knowledge/fr/core.md#FR-core-001",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["from"] == "changes/2026-10-08-x/design.md"
    assert data["to"] == "knowledge/fr/core.md#FR-core-001"
    assert data["found"] is True
    assert data["hop_count"] == 1
    assert data["hops"][0]["type"] == "describes"

    # impact：closure=id 数组 / decisions_and_frs 保 status / rejected 保 title+reason
    resp = await client.get(
        base,
        params={"sub": "impact", "anchor": "changes/2026-10-08-x/design.md"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["key"] == "changes/2026-10-08-x/design.md"
    assert data["closure"] == ["changes/2026-10-08-x/design.md", "module:backend"]
    assert data["modules"] == ["module:backend"]
    assert data["decisions_and_frs"][0]["status"] == "rejected"
    assert data["rejected_reachable"][0]["title"] == "D-002"
    assert "死路" in data["rejected_reachable"][0]["reason"]

    # orphans：CLI orphans 数组 → items
    resp = await client.get(base, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["count"] == 2
    assert data["items"][0] == {
        "id": "knowledge/uncategorized.md#a",
        "type": "doc",
        "kind": "zero-degree",
    }

    # dangling：{edge,missing,strength} → {id,type,kind,detail} 四键无损；count 保真
    resp = await client.get(base, params={"sub": "dangling"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["count"] == 1807
    assert len(data["items"]) == 1  # daemon 裁剪后 count 保真语义（mock 单条）
    assert data["items"][0] == {
        "id": "knowledge/INDEX.md",
        "type": "route",
        "kind": "medium",
        "detail": "docs/gone.md",
    }

    # query 端点 sub=summary 直通：byType/byEdge → by_type/by_edge
    resp = await client.get(base, params={"sub": "summary"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["by_type"] == {"fr": 5, "decision": 4}
    assert data["by_edge"] == {"describes": 8, "supersedes": 2}
    assert data["clusters"][0]["representatives"][0]["type"] == "fr"


# ── ② 六键全态（每键至少一条 reason 字面量正向断言）──────────────────────────


async def test_graph_reason_unbound(client, db_session, tmp_path, auth_headers) -> None:
    """未绑定（测试环境常态，不 mock 绑定）→ RuntimeNotBound → unbound。"""
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query",
        params={"sub": "orphans"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "available": False,
        "reason": "unbound",
        "source": "daemon-rpc",
        "data": None,
    }


async def test_graph_reason_offline(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    from app.modules.daemon.ws_hub import DaemonRuntimeOffline

    _mock_graph(monkeypatch, _raise(DaemonRuntimeOffline("daemon offline")))
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query",
        params={"sub": "neighbors", "anchor": "x"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reason"] == "offline"
    assert resp.json()["available"] is False
    assert resp.json()["data"] is None


async def test_graph_reason_timeout_dual_path(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """timeout 双路：通道层 DaemonRpcTimeout 与 RemoteError.code=timeout。"""
    from app.modules.daemon.ws_hub import DaemonRpcRemoteError, DaemonRpcTimeout

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    url = f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query"

    _mock_graph(monkeypatch, _raise(DaemonRpcTimeout("rpc 60s")))
    resp = await client.get(url, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.json()["reason"] == "timeout"

    _mock_graph(
        monkeypatch, _raise(DaemonRpcRemoteError({"code": "timeout", "message": "cli 30s"}))
    )
    resp = await client.get(url, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["reason"] == "timeout"
    assert resp.json()["data"] is None


async def test_graph_reason_upgrade_required_dual_path(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """upgrade_required 双路：旧 daemon（method_unregistered）与旧 CLI（cli_subcommand_missing）。"""
    from app.modules.daemon.ws_hub import DaemonRpcRemoteError

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    url = f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query"

    _mock_graph(
        monkeypatch,
        _raise(DaemonRpcRemoteError({"code": "method_unregistered", "message": "旧 daemon"})),
    )
    resp = await client.get(url, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.json()["reason"] == "upgrade_required"

    _mock_graph(
        monkeypatch,
        _raise(DaemonRpcRemoteError({"code": "cli_subcommand_missing", "message": "旧 sillyspec"})),
    )
    resp = await client.get(url, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["reason"] == "upgrade_required"
    assert resp.json()["data"] is None


async def test_graph_reason_invalid_input(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    from app.modules.daemon.ws_hub import DaemonRpcRemoteError

    _mock_graph(
        monkeypatch,
        _raise(DaemonRpcRemoteError({"code": "validation_rejected", "message": "元字符拒绝"})),
    )
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query",
        params={"sub": "neighbors", "anchor": 'x"; rm -rf'},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reason"] == "invalid_input"
    assert resp.json()["available"] is False
    assert resp.json()["data"] is None


async def test_graph_reason_rpc_error_fallback(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """rpc_error 兜底双路：RemoteError.code=internal 与 DaemonRpcConflict。"""
    from app.modules.daemon.ws_hub import DaemonRpcConflict, DaemonRpcRemoteError

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    url = f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query"

    _mock_graph(
        monkeypatch, _raise(DaemonRpcRemoteError({"code": "internal", "message": "cli failed"}))
    )
    resp = await client.get(url, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.json()["reason"] == "rpc_error"

    _mock_graph(monkeypatch, _raise(DaemonRpcConflict("rpc_id collision")))
    resp = await client.get(url, params={"sub": "orphans"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["reason"] == "rpc_error"
    assert resp.json()["data"] is None


# ── ③ overview 三 RPC 逐条容错组合 ──────────────────────────────────────────


async def test_graph_overview_summary_degrades_only(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """summary 失败（cli_feature_missing:summary 旧 CLI）仅置 None，计数不受影响。"""
    from app.modules.daemon.ws_hub import DaemonRpcRemoteError

    def handler(method, params):
        if params["sub"] == "summary":
            raise DaemonRpcRemoteError({"code": "cli_feature_missing:summary", "message": "旧 CLI"})
        if params["sub"] == "orphans":
            return {"graph": {"ok": True, "count": 2, "orphans": []}}
        return {"graph": {"ok": True, "count": 3, "dangling": []}}

    hub = _mock_graph(monkeypatch, handler)
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/overview", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["data"]["summary"] is None
    assert body["data"]["orphans_count"] == 2
    assert body["data"]["dangling_count"] == 3
    # summary RPC 固定 clusters=50（Phase 0 契约）
    summary_calls = [c for c in hub.calls if c[1]["sub"] == "summary"]
    assert len(summary_calls) == 1
    assert summary_calls[0][1]["clusters"] == 50
    # 按序 summary→orphans→dangling
    assert [c[1]["sub"] for c in hub.calls] == ["summary", "orphans", "dangling"]


async def test_graph_overview_orphans_degrades_only(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """orphans 单独失败仅置 orphans_count=None；summary（含 by_type 归一）不受影响。"""
    from app.modules.daemon.ws_hub import DaemonRuntimeOffline

    def handler(method, params):
        if params["sub"] == "summary":
            return {"graph": _CLI_SUMMARY}
        if params["sub"] == "orphans":
            raise DaemonRuntimeOffline("offline")
        return {"graph": {"ok": True, "count": 7, "dangling": []}}

    _mock_graph(monkeypatch, handler)
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/overview", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["data"]["summary"] is not None
    assert body["data"]["summary"]["by_type"] == {"fr": 5, "decision": 4}
    assert body["data"]["summary"]["clusters"][0]["key"] == "fr:core"
    assert body["data"]["orphans_count"] is None
    assert body["data"]["dangling_count"] == 7


async def test_graph_overview_all_fail_first_reason(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """全失败：整信封按首错误（summary 的六键）降级。"""
    from app.modules.daemon.ws_hub import DaemonRpcRemoteError, DaemonRuntimeOffline

    def handler(method, params):
        if params["sub"] == "summary":
            raise DaemonRpcRemoteError({"code": "timeout", "message": "summary 超时"})
        raise DaemonRuntimeOffline("offline")

    _mock_graph(monkeypatch, handler)
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/overview", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "available": False,
        "reason": "timeout",
        "source": "daemon-rpc",
        "data": None,
    }


# ── ④ 路由序 / ⑤ 权限 / ⑥ nodes 端点 / 参数校验 ────────────────────────────


async def test_graph_routes_not_swallowed_by_filename_wildcard(
    client, db_session, tmp_path, auth_headers
) -> None:
    """字面量路由命中：三端点 200 信封（未绑定态也恒 200；被 {filename:path} 吞则
    get_knowledge 404）。"""
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    base = f"/api/workspaces/{ws['ws_id']}"
    for path in (
        "/knowledge/graph/query?sub=orphans",
        "/knowledge/graph/overview",
        "/knowledge/graph/nodes?search=fr",
    ):
        resp = await client.get(base + path, headers=auth_headers)
        assert resp.status_code == 200, (path, resp.text)
        body = resp.json()
        assert set(body) == {"available", "reason", "source", "data"}
        assert body["source"] == "daemon-rpc"


async def test_graph_requires_knowledge_read_permission(
    client, db_session, tmp_path, auth_headers
) -> None:
    """无 KNOWLEDGE_READ 的普通用户 → 403（管理员 fixture 是 is_platform_admin 短路）。"""
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    headers = await _plain_user_headers(db_session)
    base = f"/api/workspaces/{ws['ws_id']}"
    resp = await client.get(
        base + "/knowledge/graph/query", params={"sub": "orphans"}, headers=headers
    )
    assert resp.status_code == 403, resp.text
    resp = await client.get(base + "/knowledge/graph/overview", headers=headers)
    assert resp.status_code == 403
    resp = await client.get(
        base + "/knowledge/graph/nodes", params={"search": "x"}, headers=headers
    )
    assert resp.status_code == 403


async def test_graph_nodes_passthrough_and_unavailable(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """nodes 端点：search/limit 透传 + 命中清单；不可用 → data=None。"""
    from app.modules.daemon.ws_hub import DaemonRuntimeOffline

    hub = _mock_graph(monkeypatch, lambda m, p: {"graph": _CLI_NODES})
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/nodes",
        params={"search": "fr", "limit": 5},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["data"]["nodes"][0] == {
        "id": "knowledge/fr/core.md#FR-core-001",
        "type": "fr",
        "label": "FR-core-001",
    }
    method, params = hub.calls[-1]
    assert method == "knowledge.graph"
    assert params["sub"] == "nodes"
    assert params["search"] == "fr"
    assert params["limit"] == 5

    # 不可用 → 信封降级（前端静默禁用补全）
    _mock_graph(monkeypatch, _raise(DaemonRuntimeOffline("offline")))
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/nodes",
        params={"search": "fr"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reason"] == "offline"
    assert resp.json()["data"] is None


async def test_graph_query_param_validation_422(client, db_session, tmp_path, auth_headers) -> None:
    """参数校验：sub 七值外 422；depth 越界 422；nodes 缺 search / limit 越界 422。"""
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    base = f"/api/workspaces/{ws['ws_id']}"
    resp = await client.get(
        base + "/knowledge/graph/query", params={"sub": "shell"}, headers=auth_headers
    )
    assert resp.status_code == 422
    resp = await client.get(
        base + "/knowledge/graph/query", params={"sub": "orphans", "depth": 0}, headers=auth_headers
    )
    assert resp.status_code == 422
    resp = await client.get(
        base + "/knowledge/graph/query", params={"sub": "orphans", "depth": 4}, headers=auth_headers
    )
    assert resp.status_code == 422
    resp = await client.get(base + "/knowledge/graph/nodes", headers=auth_headers)
    assert resp.status_code == 422  # search 必填
    resp = await client.get(
        base + "/knowledge/graph/nodes", params={"search": "x", "limit": 0}, headers=auth_headers
    )
    assert resp.status_code == 422


# ── ⑦ dump 端点组（2026-10-09-knowledge-graph-fullmap task-03 / Grill F-00）────
#
# 端点手动 gzip（无全站中间件）：httpx 对 Content-Encoding: gzip 响应透明解压——
# ``resp.json()`` 成功即证明 body 真为 gzip（非 gzip body 配该头会在解压时抛错），
# 配合 ``content-encoding`` 头断言双钉；压缩「生效」的量化断言用 spy gzip.compress
# 记录入/出字节数。


async def test_graph_dump_happy_path_gzip_envelope(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """dump happy：Content-Encoding=gzip + 解压后信封 data.nodes 逐字段（含 x/y）。"""
    hub = _mock_graph(monkeypatch, lambda m, p: {"graph": _CLI_DUMP})
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/dump", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    # 恒带压缩头（无条件压缩语义，Grill F-00：压缩面仅限本端点）
    assert resp.headers["content-encoding"] == "gzip"
    assert resp.headers["vary"] == "Accept-Encoding"
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()  # httpx 透明解压；成功即 body 真为 gzip
    assert body["available"] is True
    assert body["reason"] is None
    assert body["source"] == "daemon-rpc"
    data = body["data"]
    # nodes 逐字段：int 坐标 → float 承载；label/type/id 直传
    assert data["nodes"][0] == {
        "id": "module:backend",
        "type": "module",
        "label": "backend",
        "x": 120.0,
        "y": -50.0,
    }
    assert data["nodes"][1] == {
        "id": "knowledge/fr/core.md#FR-core-001",
        "type": "fr",
        "label": "FR-core-001",
        "x": 300.5,
        "y": 88.25,
    }
    assert data["edges"] == [
        {
            "s": "changes/2026-10-09-fullmap/design.md",
            "t": "knowledge/fr/core.md#FR-core-001",
            "type": "describes",
            "strength": "medium",
        },
        {
            "s": "decisions/daemon.md#D-001",
            "t": "knowledge/fr/core.md#FR-core-001",
            "type": "supersedes",
            "strength": "strong",
        },
    ]
    # stats 与 summary 同源归一（byType→by_type 在 dump 链路同样生效）
    assert data["stats"]["by_type"] == {"fr": 5, "decision": 4}
    assert data["stats"]["by_edge"] == {"describes": 8, "supersedes": 2}
    assert data["stats"]["nodes"] == 12
    assert data["stats"]["clusters"][0]["key"] == "fr:core"
    # 单 RPC 契约（sub=dump + layout=true 必带）
    assert len(hub.calls) == 1
    method, params = hub.calls[0]
    assert method == "knowledge.graph"
    assert params["sub"] == "dump"
    assert params["layout"] is True
    assert params["root"] == "/repo/graph"
    assert params["workspace_id"] == ws["ws_id"]


async def test_graph_dump_large_payload_compression_effective(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """>100KB 大 payload：压缩真实生效（spy 入/出字节，出 < 入/2）且解压可还原。"""
    sizes: list[tuple[int, int]] = []
    orig_compress = gzip.compress

    def _spy_compress(data, *args, **kwargs):
        out = orig_compress(data, *args, **kwargs)
        sizes.append((len(data), len(out)))
        return out

    monkeypatch.setattr(gzip, "compress", _spy_compress)
    big = _big_dump_graph()
    _mock_graph(monkeypatch, lambda m, p: {"graph": big})
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/dump", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-encoding"] == "gzip"
    # 端点内单次压缩：入参 >100KB（真实全图量级），出参 < 入参/2（确定性重复
    # id 模式 gzip 压缩比远高于此，断言留足余量防版本抖动）。
    assert len(sizes) == 1
    raw_len, wire_len = sizes[0]
    assert raw_len > 100 * 1024, raw_len
    assert wire_len * 2 < raw_len, (wire_len, raw_len)
    # 解压可还原：节点/边数量与首末 id 逐点核对
    body = resp.json()
    assert body["available"] is True
    data = body["data"]
    assert len(data["nodes"]) == len(big["nodes"])
    assert len(data["edges"]) == len(big["edges"])
    assert data["nodes"][0]["id"] == big["nodes"][0]["id"]
    assert data["nodes"][-1]["id"] == big["nodes"][-1]["id"]
    assert data["nodes"][0]["x"] == 0.0  # (0*37)%5000 确定性坐标透传


async def test_graph_dump_compress_offloaded_to_worker_thread(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """卸载钉（2026-10-10-dump-gzip-thread-offload）：gzip.compress 必须在
    工作线程执行（asyncio.to_thread 卸载）——大图 MB 级 payload 的同步 CPU
    压缩跑在事件循环线程会阻塞全部并发请求（含 SSE 心跳/日志流推送）。
    spy 记录 compress 时线程 id，断言 ≠ 测试事件循环线程。"""
    import threading

    compress_threads: list[int] = []
    orig_compress = gzip.compress

    def _thread_probe_compress(data, *args, **kwargs):
        compress_threads.append(threading.get_ident())
        return orig_compress(data, *args, **kwargs)

    monkeypatch.setattr(gzip, "compress", _thread_probe_compress)
    big = _big_dump_graph()
    _mock_graph(monkeypatch, lambda m, p: {"graph": big})
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/dump", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-encoding"] == "gzip"
    assert len(compress_threads) == 1
    assert compress_threads[0] != threading.get_ident(), (
        "gzip.compress 在事件循环线程同步执行——大图压缩阻塞并发面"
    )


async def test_graph_dump_existing_endpoints_no_content_encoding(
    client, db_session, tmp_path, auth_headers
) -> None:
    """压缩面未外溢反例（Grill F-00）：既有小端点响应无 Content-Encoding 头——
    不加全站 GZipMiddleware 的零回归钉（SSE 面同理由此中间件缺席而不受影响）。"""
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    # 全局小端点
    resp = await client.get("/api/health")
    assert resp.status_code == 200, resp.text
    assert "content-encoding" not in resp.headers
    # 既有 knowledge 端点（stats，2026-09-20 交付）
    resp = await client.get(f"/api/workspaces/{ws['ws_id']}/knowledge/stats", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert "content-encoding" not in resp.headers
    # 既有 graph 端点（query，未绑定自然态恒 200 信封）——同族小包不压缩对照
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/graph/query",
        params={"sub": "orphans"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert "content-encoding" not in resp.headers


async def test_graph_dump_cli_feature_missing_upgrade_required(
    client, db_session, tmp_path, auth_headers, monkeypatch
) -> None:
    """cli_feature_missing:dump 显式分支 → upgrade_required（区别 rpc_error 兜底）；
    不可用小包信封同构走 gzip。"""
    from app.modules.daemon.ws_hub import DaemonRpcRemoteError

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    url = f"/api/workspaces/{ws['ws_id']}/knowledge/graph/dump"

    _mock_graph(
        monkeypatch,
        _raise(
            DaemonRpcRemoteError({"code": "cli_feature_missing:dump", "message": "旧 CLI 无 dump"})
        ),
    )
    resp = await client.get(url, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-encoding"] == "gzip"  # data=None 小包也同构压缩
    assert resp.json() == {
        "available": False,
        "reason": "upgrade_required",
        "source": "daemon-rpc",
        "data": None,
    }

    # 对照：非本端点 feature 的 cli_feature_missing:* 仍走 rpc_error 兜底
    # （显式分支按 feature 域生效，非整族翻键）
    _mock_graph(
        monkeypatch,
        _raise(
            DaemonRpcRemoteError({"code": "cli_feature_missing:summary", "message": "子探测类"})
        ),
    )
    resp = await client.get(url, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["reason"] == "rpc_error"


async def test_graph_dump_route_order_and_permission(
    client, db_session, tmp_path, auth_headers
) -> None:
    """路由序：dump 200 信封（被 {filename:path} 通配吞则 get_knowledge 404）；
    无 KNOWLEDGE_READ 普通用户 403。未绑定自然态信封也恒带压缩头。"""
    ws = await _mk_ws(client, db_session, tmp_path, auth_headers)
    url = f"/api/workspaces/{ws['ws_id']}/knowledge/graph/dump"
    resp = await client.get(url, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"available", "reason", "source", "data"}
    assert body["source"] == "daemon-rpc"
    assert resp.headers["content-encoding"] == "gzip"

    headers = await _plain_user_headers(db_session)
    resp = await client.get(url, headers=headers)
    assert resp.status_code == 403, resp.text
