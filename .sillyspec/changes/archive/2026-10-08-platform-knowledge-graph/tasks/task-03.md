---
id: task-03
title: 'backend 测试：六键全态/五查询 mock/overview 容错/路由序/权限/截断'
title_zh: 'backend 测试：六键全态/五查询 mock/overview 容错/路由序/权限/截断'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P1
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-01, FR-02, FR-03, FR-08]
decision_ids: [D-001@v2]
allowed_paths:
  - backend/app/modules/knowledge/tests/test_graph.py
target_files:
  - NEW:backend/app/modules/knowledge/tests/test_graph.py
goal: >
  图端点全分支测试：RPC mock 范式复用 test_governance.py（_FakeHub + monkeypatch _resolve_binding +
  resolve_root_path_for_daemon 恒等），覆盖六键 reason 全态、五查询、overview 三 RPC 容错组合、路由序、权限、截断。
implementation:
  - fixture 复用 test_governance.py:15-52 范式（copytree valid 夹具 + 改库 spec_root + POST /api/workspaces 建区）
  - mock 面具：_FakeHub.send_rpc 按 (method, params.sub) 返回预置 CLI JSON 信封或抛 DaemonRpcRemoteError/DaemonRuntimeOffline/DaemonRpcTimeout
  - 用例组：①五查询 happy path（信封 available=true + data 分型逐字段）②六键全态（unbound=RuntimeNotBound 抛出/offline/timeout=DaemonRpcTimeout 与 RemoteError.code=timeout 双路/upgrade_required=code method_unregistered 与 cli_subcommand_missing 双路/invalid_input=validation_rejected/rpc_error=internal 与 DaemonRpcConflict 兜底）③overview 容错（summary 的 cli_feature_missing:summary → summary=None 且计数在；orphans 单独失败 → orphans_count=None 其余在；全失败 → 整信封首错误 reason）④路由序（GET /knowledge/graph/query 200 且非 filename 通配语义）⑤权限（无 KNOWLEDGE_READ 403）⑥nodes 端点（search/limit 透传 + unavailable）
acceptance:
  - pytest app/modules/knowledge/tests/test_graph.py 全绿；不跑全量（规则 0）
  - 六键每键至少一条正向断言（reason 字面量相等）
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_graph.py -q --no-cov
constraints: >
  禁跑全量测试（规则 0），只跑 test_graph.py；mock 不发真 RPC
---
# task-03
