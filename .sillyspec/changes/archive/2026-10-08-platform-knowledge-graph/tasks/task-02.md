---
id: task-02
title: 'backend 图三端点：schema 信封六键 + graph.py RPC 直采 + router 注册序'
title_zh: 'backend 图三端点：schema 信封六键 + graph.py RPC 直采 + router 注册序'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P0
depends_on: [task-01]
blocks: [task-03, task-05]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v2, D-007@v1]
allowed_paths:
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/graph.py
  - backend/app/modules/knowledge/router.py
target_files:
  - NEW:backend/app/modules/knowledge/graph.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/router.py
goal: >
  平台图查询 HTTP 面：三读端点（query/overview/nodes）+ 信封 DTO（reason 六稳定键）+ KnowledgeGraphService
  RPC 直采（无本地回退）。契约逐字段对齐 design 接口定义（neighbors 键对齐 CLI nodes、path 含
  found/reason/hop_count、overview 轻量计数型）。
implementation:
  - schema.py：GraphEnvelope 泛型信封（available/reason/source/data）+ reason 六键字面量类型；GraphQueryOut.data 按 sub 分型（GraphNeighborsData/GraphPathData/GraphImpactData/GraphOrphansData/GraphDanglingData）；GraphOverviewData（summary:GraphSummary|None + orphans_count/dangling_count:int|None；GraphSummary 含 nodes/edges/byType/byEdge/orphans/module_doc_gaps/changelog_danglings/dangling_refs/clusters[GraphCluster{key,label,count,representatives}]）；GraphNodesData
  - NEW graph.py KnowledgeGraphService：_graph_rpc(user_id, params) 泛型方法——RuntimeLiveService(self._session)._resolve_binding(workspace_id, user_id) → 懒导入 get_daemon_ws_hub().send_rpc(daemon_id, "knowledge.graph", {workspace_id, root:resolve_root_path_for_daemon(root), **params}, timeout=60) → 异常映射六键（RuntimeNotBound→unbound / DaemonRuntimeOffline→offline / DaemonRpcTimeout→timeout / RemoteError.code∈{method_unregistered,cli_subcommand_missing}→upgrade_required / validation_rejected→invalid_input / 其余→rpc_error，reason 六键枚举值）
  - query/overview/nodes 三公开方法构造信封；overview 内部按序发 summary(--clusters 50)→orphans→dangling 三 RPC 逐条容错（summary 失败仅置 None；orphans/dangling 单独失败对应计数 None；全失败按首错误 reason 整信封降级）
  - router.py 三端点：GET /knowledge/graph/query（QueryParams sub/anchor/anchor2/edges/depth 校验）、GET /knowledge/graph/overview、GET /knowledge/graph/nodes（search/limit）；全部 Depends(require_permission(Permission.KNOWLEDGE_READ))；**注册位置必须在 GET /knowledge/{filename:path} 通配之前**（router.py:54-60 首注释铁律，/knowledge/stats 同款先例 router.py:214-217）
acceptance:
  - 三端点 OpenAPI 可生成（供 task-05 gen:types）；信封结构逐字段与 design 接口定义一致
  - 六键 reason 全分支可达；overview 三 RPC 逐条容错语义正确
  - 字面量路由不被 {filename:path} 通配吞（GET /knowledge/graph/query 不被解析为 filename="graph/query"）
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_graph.py -q（task-03 落地后）
  - cd backend && uv run mypy app
constraints: >
  三端点必须注册在 GET /knowledge/{filename:path} 通配之前；无本地回退（D-001@v2）；reason 六稳定键字面量
---
# task-02
