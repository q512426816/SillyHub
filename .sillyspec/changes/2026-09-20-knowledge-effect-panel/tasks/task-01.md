---
id: task-01
title: 'backend hits data foundation'
title_zh: 'backend 数据底座（表+ingest/stats+parser helper+两端点+fr zone）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 22:20:00
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-01, FR-02, FR-03, FR-05, FR-06]
decision_ids: [D-002@v3, D-004@v2, D-007, D-008@v3, D-009]
allowed_paths:
  - backend/app/modules/knowledge/parser.py
  - backend/app/modules/knowledge/hits.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/service.py
  - backend/app/modules/knowledge/tests/
  - backend/migrations/versions/
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/knowledge/parser.py
  - NEW:backend/app/modules/knowledge/hits.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/router.py
  - NEW:backend/app/modules/knowledge/tests/test_hits.py
  - NEW:backend/migrations/versions/20260920220000_create_knowledge_hits.py
provides:
  - contract: KnowledgeStatsOut
    fields: [coverage, dead_entries, density, freshness, usage_board, entry_counts]
  - contract: HitsBatchOut
    fields: [ingested, skipped_bad, duplicates]
goal: >
  knowledge_hits 数据底座：表+幂等接收+stats 聚合（slug 双端归一）+parser 条目全集 helper（含 fr zone），运营指标与使用率榜数据源。
implementation:
  - migration 建 knowledge_hits（uq workspace_id+line_hash、ix workspace_id+occurred_at、daemon_local_id 原样列不 FK）
  - HitsService.ingest_batch 逐行解析+sha256，INSERT ON CONFLICT DO NOTHING（照 spec_workspace 既有 on_conflict 先例）；五型白名单全收外型存原值不计数；坏行跳过计数
  - HitsService.stats 条目全集×命中聚合（inject 与 fr-inject 拆锚点）出覆盖率、死条目（90 天）、密度（任务=inject 行 change 去重）、生效速度、usage_board（per_task 降序）、entry_counts
  - 锚点 slug 归一化 parser helper 复刻 CLI anchor 规则（小写、空格转-、去括号标点）；无 # 裸文件按文件级；INDEX.md 排除
  - parser ZONE_SUBDIRS 增 fr；两端点（POST hits/batch 鉴权照 postSpecSync 先例且 body 带 daemon_local_id；GET stats 挂 KNOWLEDGE_READ）注册在 {filename:path} 通配之前
  - pnpm gen:types 提交
acceptance:
  - ingest 幂等重报两次落库计数不变且 duplicates 第二次为全量
  - 五型白名单 fr 行落库不计数；坏行跳过并计数返回
  - stats 复算构造已知 hits 断言四指标与 usage_board per_task 及 entry_counts 与手算一致（含 slug 锚点与裸文件两种形态）
  - 列表接口出现 zone=fr 条目
  - stats 与 hits 端点未认证 401 不被通配吞
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 daemon 与前端组件（分属 task-02 与 04/05）
  - quicklog 解析与既有端点行为零回归
  - stats 实时聚合不引入物化表
---
