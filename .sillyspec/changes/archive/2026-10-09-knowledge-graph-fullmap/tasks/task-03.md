---
id: task-03
title: 'backend dump 端点（手动 gzip）+ 信封 + 测试（含 SSE 零回归）'
title_zh: 'backend dump 端点（手动 gzip）+ 信封 + 测试（含 SSE 零回归）'
author: 'qinyi'
created_at: '2026-10-09 00:52:00'
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/graph.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/tests/test_graph.py
target_files:
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/graph.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/tests/test_graph.py
goal: >
  GET /knowledge/graph/dump：六键信封（cli_feature_missing:dump 归 upgrade_required）+
  data={nodes,edges,stats}；端点内手动 gzip.compress + Content-Encoding 头（不做全站中间件）。
implementation:
  - schema.py：GraphDumpNode{id,type,label,x:float,y:float}、GraphDumpData{nodes,edges,stats:GraphSummary}
  - graph.py dump()：单 RPC（sub=dump, layout=true）60s；异常映射沿六键（cli_feature_missing:dump→upgrade_required 显式分支）
  - router.py：GET /knowledge/graph/dump 注册在 {filename:path} 通配前 KNOWLEDGE_READ；响应构造——json.dumps 信封后 gzip.compress，Response(content=..., media_type=application/json, headers={Content-Encoding:gzip})（浏览器透明解压）
  - 测试：dump mock happy（解压后 JSON 信封断言）/恒带 Content-Encoding/既有小端点无 Content-Encoding（压缩未外溢反例）/cli_feature_missing:dump→upgrade_required/路由序/403/大 payload（>100KB）压缩比断言
constraints: >
  禁止引入全站 GZipMiddleware（SSE 流风险 Grill F-00）；既有端点/SSE 响应头零变化（反例用例钉）
acceptance:
  - pytest test_graph.py 全绿（既有+新增 dump 组）；ruff/mypy 过
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_graph.py -q --no-cov
---
# task-03

