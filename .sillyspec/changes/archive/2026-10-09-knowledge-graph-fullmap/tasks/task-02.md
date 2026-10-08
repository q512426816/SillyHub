---
id: task-02
title: 'daemon dump 白名单与 --layout 校验 + handler 测试'
title_zh: 'daemon dump 白名单与 --layout 校验 + handler 测试'
author: 'qinyi'
created_at: '2026-10-09 00:52:00'
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/tests/knowledge-governance-handler.test.ts
target_files:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/tests/knowledge-governance-handler.test.ts
goal: >
  knowledge.graph RPC 放行 dump 子命令：KNOWLEDGE_GRAPH_SUBS 加 dump；layout 必须 true
  （false/缺省 validation_rejected）；dump 回包全量不裁剪（绕过 orphans/dangling top-50 裁剪分支）。
implementation:
  - 白名单加 'dump'；子命令专属旗标校验：sub===dump 时 query.layout!==true → RpcError('validation_rejected')
  - dump 拼串：sillyspec knowledge graph dump --layout --json
  - 回包分支：dump 不走 slice(0,50) 裁剪（全量透传 {graph:j}）
  - 测试：dump 白名单放行/layout=false 与缺省拒/命令拼装断言/大回包（>1000 items）不裁剪/其余子命令回归
constraints: >
  既有五子命令与 summary/nodes 行为零变化；注入消毒面不新增参数（dump 无自由串入参）
acceptance:
  - pnpm test knowledge-governance 全绿（既有+新增 dump 用例）
verify:
  - cd sillyhub-daemon && pnpm typecheck && pnpm test -- knowledge-governance
---
# task-02

