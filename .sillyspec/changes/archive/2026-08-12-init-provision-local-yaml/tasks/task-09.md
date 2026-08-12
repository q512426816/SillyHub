---
id: task-09
title: mcp_gateway get_or_issue 测试
title_zh: 新建 mcp_gateway tests test_get_or_issue 测 get_or_issue 空签新 有旧吊销签新 不堆积 scope dispatch 合法 吊销后 authenticate None
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02, FR-08]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/mcp_gateway/tests/test_get_or_issue.py
provides: []
expects_from:
  task-02:
    - contract: McpTokenService.get_or_issue
      needs: [get_or_issue 方法可调用]
goal: >
  新建 backend/app/modules/mcp_gateway/tests/test_get_or_issue.py 测 task-02 的 get_or_issue 五场景 空签新 有旧吊销签新 不堆积 scope dispatch 合法性 吊销后 authenticate None，覆盖 FR-02 FR-08 与 D-001，复用 mcp_gateway tests conftest 的 mcp_tokens 表 fixture。
implementation:
  - 新建 test_get_or_issue.py 复用 mcp_gateway tests conftest.py 的 db_session 与 mcp_tokens 表建表 fixture
  - 测空表 get_or_issue 直接签新返回 row 与明文 DB 仅一条 revoked_at 为空
  - 测先 create 一条同维度 token 再 get_or_issue 旧 revoke 新签 至多一条活 token
  - 测多次 get_or_issue 同 workspace 不堆积
  - 测签出的 token scope 落库为 dispatch 非 workspace 非 read，authenticate 返非空 Principal
acceptance:
  - 五场景全过 scope 断言为 dispatch 精确
  - 复用 mcp_gateway tests conftest fixture 不重建表
  - scope 合法性验证确保不持久化废 token
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway/tests/test_get_or_issue.py -q --no-cov
constraints:
  - 只测 get_or_issue 不改 task-02 实现
  - scope 断言为 dispatch 因 task-02 固定签 dispatch 非 workspace 非 read
  - 复用 mcp_gateway tests conftest.py fixture 不另起
  - 代码兼容 Windows Linux macOS pytest 异步
---
