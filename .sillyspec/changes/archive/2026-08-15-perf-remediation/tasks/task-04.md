---
id: task-04
title: scan_docs list query narrowing (load_only)
title_zh: scan_docs list 查询收窄——无 q 时 load_only 排除 content 大列，有 q 保留 LIKE
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/scan_docs/tests/
goal: >
  list_ 无 q 查询不再全量搬运 content 列（响应 schema 本就无 content，
  纯收益）；有 q 时保持现状 SQL LIKE 不劣化。fallback 方案（Grill 修订后定稿）。
implementation:
  - scan_docs/service.py:45-72 list_：无 q 分支 stmt 加 .options(load_only(...)) 排除 ScanDocument.content 列，保留响应所需全部其余列（id/path/doc_type/title/conflict 相关/时间戳等——按实际响应 schema 字段核对，access 后再触发懒加载的列不排除或一并 load）
  - 有 q 分支（:57-68）一行不动——候选集二次取 content 在选择性 q 下严格劣于现状（design 段 3 定稿，不用该方案）
  - 注意 :71 _count_conflicts_batch 只用 path，不受 load_only 影响
  - 测试：新增无 q 列表结果等价测试（含字段完整性——逐字段比对含 title/doc_type/timestamps）+ 有 q 行为不变测试（既有 test_service.py 搜索用例作锚点）
acceptance:
  - 无 q：list_ 返回对象除 content 未加载外，全部响应字段与改前逐项相等
  - 有 q：搜索命中集合与改前完全一致（LIKE 转义路径不动）
  - 既有 scan_docs 测试全绿
verify:
  - cd backend && uv run pytest app/modules/scan_docs/tests/ -q --no-cov
  - cd backend && uv run pytest tests/modules/scan_docs/ -q --no-cov
  - cd backend && uv run ruff format --check app/modules/scan_docs/service.py
  - cd backend && uv run mypy app/modules/scan_docs/service.py
constraints: 返回类型与 router 响应 schema 零变更（NFR-01）；不动 get / reparse / conflict 路径；SQLAlchemy 懒加载触发点需在测试中覆盖（防 detatch 后访问 content 抛错）。
---
