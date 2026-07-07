---
id: task-07
title: backend 单测（catalog 两模式 + generate_projects 粒度 + workspace/change 回归）
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-02, task-03, task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: []
allowed_paths:
  - backend/tests/modules/workspace/test_component_catalog.py
  - backend/tests/modules/workspace/test_generate_projects.py
goal: >
  为 W1 全部改动补单测并跑回归：catalog service 覆盖 daemon-client + server-local 两模式；generate_projects 验一级粒度（5 个）；workspace + change 模块全量零回归。
implementation:
  - 新建 `test_component_catalog.py`：用 fixture 构造 spec_root（daemon-client 包裹模式 + server-local 扁平模式），断言 `list_components` 返回 5 个一级子项目且不含项目组自身
  - 扩 `test_generate_projects.py`：断言重跑后 yaml 数=5、模块级不单独生成、无 relations 段
  - 跑 workspace 模块全量（含 router/topology 退化测试）+ change 模块全量，确认零回归
  - topology 测试断言 edges 恒空
acceptance:
  - catalog 两模式单测全绿
  - generate_projects 一级粒度断言通过
  - workspace + change 全量测试无新增失败
verify:
  - cd backend && python -m pytest tests/modules/workspace/ tests/modules/change/ -q
constraints:
  - 测试用 SQLite in-memory，注意 PG 方言分支（参考 memory backend-test-sqlite-vs-pg）
  - 不为"通过"而改测试逻辑本身有误的断言（CLAUDE.md 规则8）
  - topology 退化测试允许只断言 nodes 非空 + edges 为空
---

