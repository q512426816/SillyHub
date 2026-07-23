---
id: task-10
title: backend 单测（绑定/未绑定/前导/列表过滤/零回归）
title_zh: 后端单元测试
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-08, task-09]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/
  - backend/app/modules/change/tests/
goal: >
  覆盖 create_session 绑定/未绑定两路径、前导内容与注入、列表过滤（含跨成员）、旧 session 不出现的零回归。
implementation:
  - 新增 test_change_session.py：带 change_id 创建→AgentSession 绑定正确 + cwd 写入；未带→两列 None 零回归
  - 前导测试：build_change_context_preamble 输出含四类信息；create_session dispatch prompt 含前导但 user_input 日志干净
  - 列表测试：GET /changes/{cid}/sessions 只返回该变更会话（跨成员可见），旧 session（change_id=None）不出现
acceptance:
  - 新增测试全绿
  - 既有 daemon/change session 测试零回归
verify:
  - cd backend && uv run pytest backend/app/modules/daemon/tests/test_change_session.py backend/app/modules/change/tests/ -q
  - cd backend && uv run pytest -q --cov=app --cov-fail-under=60
constraints:
  - 用 SQLite in-memory 测；PG 方言相关断言不绑死 SQL 函数名（见 memory backend-test-sqlite-vs-pg）
  - 不过度 mock 遮蔽真实 FK 路径（见 memory scan-generate-failure-chain）
---

## 验收标准
- 新增测试全绿（绑定/未绑定/前导/列表过滤）
- 既有 daemon/change session 测试零回归
- 全量覆盖率达标（--cov-fail-under=60）

## 验证步骤
- cd backend && uv run pytest backend/app/modules/daemon/tests/test_change_session.py backend/app/modules/change/tests/ -q
- cd backend && uv run pytest -q --cov=app --cov-fail-under=60
