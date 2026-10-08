"""知识图谱 RPC 直采服务（change 2026-10-08-platform-knowledge-graph task-02）。

复刻治理信号 v2 先例（service.governance_signals）：RuntimeLiveService._resolve_binding
绑定发现 → 懒导入 get_daemon_ws_hub().send_rpc("knowledge.graph", params, timeout=60)
→ resolve_root_path_for_daemon 路径改写。**无本地回退**（D-001@v2）：不可用态统一
翻译为信封 ``available=false + reason`` 六稳定键（unbound/offline/timeout/
upgrade_required/invalid_input/rpc_error），HTTP 200 恒返回信封。

CLI JSON → DTO 归一化（D-007@v1），按 sillyspec@3.32.1 src/knowledge-graph.js
实际输出形状对齐——与 design 接口定义的**假设差异**（按实际归一）：

- ``impact.closure``：CLI 是**节点 id 字符串数组**（非 GraphNodeRef 对象数组）；
  ``decisions_and_frs`` 条目为 ``{id,type,status}``、``rejected_reachable`` 条目
  为 ``{id,title,reason}``（title 即 label、reason 为防复潮理由），与任务卡假设的
  GraphNodeRef 三键不同——DTO 用 GraphDecisionRef/GraphRejectedRef 保真实际字段。
- ``orphans``/``dangling``：CLI 清单键名为 ``orphans``/``dangling``（非 items）；
  dangling 原始条目为 ``{edge:{s,t,type}, missing, strength}``，归一为
  ``{id=引用方节点, type=边型, kind=强度档, detail=缺失目标}``（四键保真全部信息）。
- ``summary``：CLI 把聚合放在 ``stats`` 子对象且分布键为 byType/byEdge（驼峰），
  归一拍平为 by_type/by_edge；clusters/representatives 键与假设一致直传。
- ``path``：from/to 在 CLI ``query`` 子对象内；hops 即 ``{s,t,type}`` 直传。
- overview 的 summary RPC 固定带 ``clusters: 50``（真图 883 簇，平台 lite 画布
  摆不下——Phase 0 契约「daemon/平台侧调 summary 固定传 --clusters 50」）。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.schema import (
    GraphCluster,
    GraphDanglingData,
    GraphDanglingItem,
    GraphDecisionRef,
    GraphEdge,
    GraphEnvelope,
    GraphHop,
    GraphImpactData,
    GraphNeighborsData,
    GraphNodeRef,
    GraphNodesData,
    GraphOrphanItem,
    GraphOrphansData,
    GraphOverviewData,
    GraphPathData,
    GraphRejectedRef,
    GraphSummary,
)

#: 图 RPC 往返超时（与 knowledge.digest 同档；CLI 侧 runSillyspecCmd 30s 在内层）。
GRAPH_RPC_TIMEOUT = 60
#: overview 的 summary RPC 固定簇数上限（Phase 0 契约）。
OVERVIEW_CLUSTERS_LIMIT = 50


def _map_reason(exc: Exception) -> str:
    """异常族 → reason 六稳定键（D-001@v2 映射表）。

    RuntimeNotBound→unbound；DaemonRuntimeOffline→offline；DaemonRpcTimeout 或
    RemoteError.code=timeout→timeout；code∈{method_unregistered（旧 daemon）,
    cli_subcommand_missing（旧 CLI）}→upgrade_required；code=validation_rejected
    （消毒拒绝）→invalid_input；其余（internal / DaemonRpcConflict / 未知 code，
    含 cli_feature_missing:* 子探测类——该态在 overview 由 summary 子块单独吸收）
    →rpc_error。
    """
    from app.modules.daemon.ws_hub import (
        DaemonRpcRemoteError,
        DaemonRpcTimeout,
        DaemonRuntimeOffline,
    )
    from app.modules.runtime.service import RuntimeNotBound

    if isinstance(exc, RuntimeNotBound):
        return "unbound"
    if isinstance(exc, DaemonRuntimeOffline):
        return "offline"
    if isinstance(exc, DaemonRpcTimeout):
        return "timeout"
    if isinstance(exc, DaemonRpcRemoteError):
        code = str(getattr(exc, "code", "") or "")
        if code == "timeout":
            return "timeout"
        if code in ("method_unregistered", "cli_subcommand_missing"):
            return "upgrade_required"
        if code == "validation_rejected":
            return "invalid_input"
    return "rpc_error"


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_int(value: Any, default: int = 0) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _as_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _query_of(graph: dict[str, Any]) -> dict[str, Any]:
    q = graph.get("query")
    return q if isinstance(q, dict) else {}


def _node_ref(item: Any) -> GraphNodeRef:
    """CLI 节点 → GraphNodeRef（str 形态视为裸 id，label 回退 id）。"""
    if isinstance(item, str):
        return GraphNodeRef(id=item, type="", label=item)
    if isinstance(item, dict):
        return GraphNodeRef(
            id=_as_str(item.get("id")),
            type=_as_str(item.get("type")),
            label=_as_str(item.get("label")) or _as_str(item.get("title")),
        )
    return GraphNodeRef(id="", type="", label="")


def _norm_neighbors(graph: dict[str, Any], anchor: str | None) -> GraphNeighborsData:
    query = _query_of(graph)
    return GraphNeighborsData(
        anchor=_as_str(query.get("key")) or _as_str(graph.get("anchor")) or _as_str(anchor),
        nodes=[_node_ref(n) for n in _as_list(graph.get("nodes"))],
        edges=[
            GraphEdge(
                s=_as_str(e.get("s")),
                t=_as_str(e.get("t")),
                type=_as_str(e.get("type")),
                strength=_as_str(e.get("strength")),
            )
            for e in _as_list(graph.get("edges"))
            if isinstance(e, dict)
        ],
    )


def _norm_path(graph: dict[str, Any], anchor: str | None, anchor2: str | None) -> GraphPathData:
    query = _query_of(graph)
    hops = [
        GraphHop(s=_as_str(h.get("s")), t=_as_str(h.get("t")), type=_as_str(h.get("type")))
        for h in _as_list(graph.get("hops"))
        if isinstance(h, dict)
    ]
    return GraphPathData(
        from_=_as_str(query.get("from")) or _as_str(graph.get("from")) or _as_str(anchor),
        to=_as_str(query.get("to")) or _as_str(graph.get("to")) or _as_str(anchor2),
        found=bool(graph.get("found")),
        reason=_as_str(graph.get("reason")),
        hop_count=_as_int(graph.get("hop_count"), len(hops)),
        hops=hops,
    )


def _norm_impact(graph: dict[str, Any], anchor: str | None) -> GraphImpactData:
    query = _query_of(graph)

    def _id_of(item: Any) -> str:
        if isinstance(item, str):
            return item
        return _as_str(item.get("id")) if isinstance(item, dict) else ""

    return GraphImpactData(
        key=_as_str(query.get("key")) or _as_str(graph.get("key")) or _as_str(anchor),
        closure=[_id_of(c) for c in _as_list(graph.get("closure"))],
        modules=[_as_str(m) for m in _as_list(graph.get("modules"))],
        decisions_and_frs=[
            GraphDecisionRef(
                id=_as_str(d.get("id")),
                type=_as_str(d.get("type")),
                status=_as_str(d.get("status")),
            )
            for d in _as_list(graph.get("decisions_and_frs"))
            if isinstance(d, dict)
        ],
        rejected_reachable=[
            GraphRejectedRef(
                id=_as_str(d.get("id")),
                title=_as_str(d.get("title")),
                reason=_as_str(d.get("reason")),
            )
            for d in _as_list(graph.get("rejected_reachable"))
            if isinstance(d, dict)
        ],
    )


def _norm_orphans(graph: dict[str, Any]) -> GraphOrphansData:
    # CLI 清单键为 orphans；容忍 daemon 已归一的 items 形态。
    raw = graph.get("items") if isinstance(graph.get("items"), list) else graph.get("orphans")
    items = [
        GraphOrphanItem(
            id=_as_str(d.get("id")), type=_as_str(d.get("type")), kind=_as_str(d.get("kind"))
        )
        for d in _as_list(raw)
        if isinstance(d, dict)
    ]
    count = _as_int(graph.get("count"), len(items))
    return GraphOrphansData(count=count, items=items)


def _norm_dangling(graph: dict[str, Any]) -> GraphDanglingData:
    # CLI 清单键为 dangling，原始条目 {edge:{s,t,type}, missing, strength}——归一为
    # id=引用方节点(edge.s)、type=边型、kind=强度档、detail=缺失目标（四键无损）；
    # 容忍 daemon 已归一的 {id,type,kind,detail} items 形态。
    raw = graph.get("items") if isinstance(graph.get("items"), list) else graph.get("dangling")
    items: list[GraphDanglingItem] = []
    for d in _as_list(raw):
        if not isinstance(d, dict):
            continue
        edge = d.get("edge") if isinstance(d.get("edge"), dict) else None
        if edge is not None:
            items.append(
                GraphDanglingItem(
                    id=_as_str(edge.get("s")),
                    type=_as_str(edge.get("type")),
                    kind=_as_str(d.get("strength")),
                    detail=_as_str(d.get("missing")),
                )
            )
        else:
            items.append(
                GraphDanglingItem(
                    id=_as_str(d.get("id")),
                    type=_as_str(d.get("type")),
                    kind=_as_str(d.get("kind")),
                    detail=_as_str(d.get("detail")),
                )
            )
    count = _as_int(graph.get("count"), len(items))
    return GraphDanglingData(count=count, items=items)


def _norm_summary(graph: dict[str, Any]) -> GraphSummary:
    # CLI 聚合在 stats 子对象（{ok, query, stats:{...}, summary:[...]}）；容忍拍平形态。
    stats = graph.get("stats") if isinstance(graph.get("stats"), dict) else graph
    by_type = (
        stats.get("by_type") if isinstance(stats.get("by_type"), dict) else stats.get("byType")
    )
    by_edge = (
        stats.get("by_edge") if isinstance(stats.get("by_edge"), dict) else stats.get("byEdge")
    )
    clusters = [
        GraphCluster(
            key=_as_str(c.get("key")),
            label=_as_str(c.get("label")),
            count=_as_int(c.get("count")),
            representatives=[_node_ref(r) for r in _as_list(c.get("representatives"))],
        )
        for c in _as_list(stats.get("clusters"))
        if isinstance(c, dict)
    ]
    return GraphSummary(
        nodes=_as_int(stats.get("nodes")),
        edges=_as_int(stats.get("edges")),
        by_type={_as_str(k): _as_int(v) for k, v in (by_type or {}).items()},
        by_edge={_as_str(k): _as_int(v) for k, v in (by_edge or {}).items()},
        orphans=_as_int(stats.get("orphans")),
        module_doc_gaps=_as_int(stats.get("module_doc_gaps")),
        changelog_danglings=_as_int(stats.get("changelog_danglings")),
        dangling_refs=_as_int(stats.get("dangling_refs")),
        clusters=clusters,
    )


def _norm_nodes(graph: dict[str, Any]) -> GraphNodesData:
    return GraphNodesData(nodes=[_node_ref(n) for n in _as_list(graph.get("nodes"))])


def _count_of(graph: dict[str, Any]) -> int:
    """overview 计数：orphans/dangling RPC 的 count（保真原值）；无 count 回退清单长。"""
    for key in ("count",):
        value = graph.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    for key in ("items", "orphans", "dangling"):
        if isinstance(graph.get(key), list):
            return len(graph[key])
    return 0


class KnowledgeGraphService:
    """知识图谱服务：绑定 daemon RPC 直采 CLI 图查询（无本地回退，D-001@v2）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _rpc(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, params: dict[str, Any]
    ) -> tuple[bool, str | None, dict[str, Any] | None]:
        """单次 knowledge.graph RPC：返回 ``(available, reason, graph 数据)``。

        懒导入与 governance_signals 同款（避免 router 导入链早绑 ws_hub 单例）；
        异常族全部收敛为六键 reason，不向端点抛错（HTTP 200 恒信封）。
        """
        try:
            from app.modules.daemon.ws_hub import get_daemon_ws_hub
            from app.modules.runtime.service import RuntimeLiveService
            from app.modules.workspace.service import resolve_root_path_for_daemon

            rt = RuntimeLiveService(self._session)
            daemon_id, root_path = await rt._resolve_binding(workspace_id, user_id)
            hub = get_daemon_ws_hub()
            resp = await hub.send_rpc(
                daemon_id,
                "knowledge.graph",
                {
                    "workspace_id": str(workspace_id),
                    "root": resolve_root_path_for_daemon(root_path),
                    **params,
                },
                timeout=GRAPH_RPC_TIMEOUT,
            )
        except Exception as exc:  # 六键映射（含 _resolve_binding 的 RuntimeNotBound）
            return False, _map_reason(exc), None
        graph = resp.get("graph") if isinstance(resp, dict) else None
        if not isinstance(graph, dict):
            # daemon 回包不含 graph 对象——网关级坏包，按 rpc_error 兜底。
            return False, "rpc_error", None
        return True, None, graph

    async def query(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        sub: str,
        anchor: str | None = None,
        anchor2: str | None = None,
        edges: str | None = None,
        depth: int = 1,
    ) -> GraphEnvelope:
        """五查询（neighbors/path/impact/orphans/dangling）+ summary/nodes 直通。"""
        params: dict[str, Any] = {"sub": sub}
        if anchor is not None:
            params["anchor"] = anchor
        if anchor2 is not None:
            params["anchor2"] = anchor2
        if edges is not None:
            params["edges"] = edges
        if depth is not None:
            params["depth"] = depth
        available, reason, graph = await self._rpc(workspace_id, user_id, params)
        if not available or graph is None:
            return GraphEnvelope(available=False, reason=reason, data=None)
        if sub == "neighbors":
            data: Any = _norm_neighbors(graph, anchor)
        elif sub == "path":
            data = _norm_path(graph, anchor, anchor2)
        elif sub == "impact":
            data = _norm_impact(graph, anchor)
        elif sub == "orphans":
            data = _norm_orphans(graph)
        elif sub == "dangling":
            data = _norm_dangling(graph)
        elif sub == "summary":
            data = _norm_summary(graph)
        elif sub == "nodes":
            data = _norm_nodes(graph)
        else:  # pragma: no cover - router Literal 七值已挡
            return GraphEnvelope(available=False, reason="invalid_input", data=None)
        return GraphEnvelope(available=True, reason=None, data=data)

    async def overview(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> GraphEnvelope:
        """总览 lite：按序 summary(clusters=50)→orphans→dangling 三 RPC 逐条容错。

        summary 失败（旧 CLI cli_feature_missing:summary 等）仅置 None（lite 隐藏）；
        orphans/dangling 单独失败对应计数 None（前端显示「—」）；全失败整信封按
        **首错误**（summary 的六键）降级。
        """
        ok_s, reason_s, graph_s = await self._rpc(
            workspace_id, user_id, {"sub": "summary", "clusters": OVERVIEW_CLUSTERS_LIMIT}
        )
        ok_o, reason_o, graph_o = await self._rpc(workspace_id, user_id, {"sub": "orphans"})
        ok_d, reason_d, graph_d = await self._rpc(workspace_id, user_id, {"sub": "dangling"})
        if not (ok_s or ok_o or ok_d):
            # 全失败：按序取首条失败 RPC 的六键（summary→orphans→dangling）。
            first_reason = reason_s if not ok_s else (reason_o if not ok_o else reason_d)
            return GraphEnvelope(available=False, reason=first_reason or "rpc_error", data=None)
        data = GraphOverviewData(
            summary=_norm_summary(graph_s) if ok_s and graph_s is not None else None,
            orphans_count=_count_of(graph_o) if ok_o and graph_o is not None else None,
            dangling_count=_count_of(graph_d) if ok_d and graph_d is not None else None,
        )
        return GraphEnvelope(available=True, reason=None, data=data)

    async def nodes(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, search: str, limit: int = 20
    ) -> GraphEnvelope:
        """节点搜索（锚点自动补全数据源；不可用时 data=None，前端静默禁用补全）。"""
        available, reason, graph = await self._rpc(
            workspace_id, user_id, {"sub": "nodes", "search": search, "limit": limit}
        )
        if not available or graph is None:
            return GraphEnvelope(available=False, reason=reason, data=None)
        return GraphEnvelope(available=True, reason=None, data=_norm_nodes(graph))
