---
id: task-08
title: platform_sync get_or_issue 测试
title_zh: 新建 platform_sync tests test_get_or_issue 测 get_or_issue 空则签新 有旧则吊销签新 不堆积 吊销后 authenticate 返 None
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/platform_sync/tests/test_get_or_issue.py
provides: []
expects_from:
  task-01:
    - contract: PlatformSyncTokenService.get_or_issue
      needs: [get_or_issue 方法可调用]
goal: >
  新建 backend/app/modules/platform_sync/tests/test_get_or_issue.py 测 task-01 的 get_or_issue 四个场景 空表签新 有旧吊销签新 多次调用同维度仅一条活 token 吊销后 authenticate 返 None，覆盖 FR-02 与 D-001，复用 platform_sync tests conftest 的 platform_sync_tokens 表 fixture。
implementation:
  - 新建 test_get_or_issue.py 复用 platform_sync tests conftest.py 的 db_session 与 platform_sync_tokens 表建表 fixture
  - 测空表 get_or_issue 直接签新返回 row 与明文 DB 仅一条 revoked_at 为空记录
  - 测先 create 一条同维度 token 再 get_or_issue 后旧行 revoked_at 非空 新行 revoked_at 为空 DB 至多一条活 token
  - 测多次 get_or_issue 同 workspace 与 created_by 维度始终仅一条活 token 不堆积
  - 测被吊销的旧 token 明文调 authenticate 返 None 新明文返非空 Principal
acceptance:
  - 四场景全部通过 断言 DB 行数与 revoked_at 状态精确
  - 复用既有 platform_sync tests conftest fixture 不重建表
  - 明文断言用返回值 不查 DB hash 因 hash 不可逆
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_get_or_issue.py -q --no-cov
constraints:
  - 只测 get_or_issue 不改 task-01 实现
  - 复用 platform_sync tests conftest.py 的 db_session 与建表 fixture 不另起
  - 不测 mcp scope 因本 task 只测 platform_sync scope 为 None
  - 代码兼容 Windows Linux macOS pytest 异步用 pytest-asyncio
---
