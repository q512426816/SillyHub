---
id: task-05
title: full test coverage expansion
title_zh: 测试全量扩展
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P1
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-09]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/platform_sync/tests/test_router.py
goal: >
  test_router.py 扩展：两新端点全路径（200/422×3/401）+ GET 三态 + 单写者回归 + 占位行守卫回归 +
  修既有 GET approval 测试的 reason 文案断言（'no approval policy configured'→'no approval record; default-approved'）。
implementation:
  - documents：200（synced 计数）/ 空 map 422 / 白名单外键 422 / 值非 str 422 / 401
  - approval：200 approved（body 无 reason 键）/ 200 rejected + reason / 非法 decision 422 / 401
  - GET 三态：无行→approved 放行 / 有 rejected 记录→真实 status / approval NULL（占位行仅 documents）→approved
  - 单写者回归：push progress → set_approval → 再 push progress → approval 仍在；upsert_documents → push progress → documents 仍在
  - 占位行守卫：仅 POST documents 建 行 → GET progress 404 + GET /changes 无该项 → 随后 push progress 正常 UPDATE 不撞复合唯一键
  - 既有 3 个 GET approval 测试（ql-20260812-001-6eb8）reason 断言更新
acceptance:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov 全绿
verify:
  - 同上命令输出全 passed
constraints: 不改既有测试的鉴权/路由结构；预存失败若与本变更无关按子模块隔离惯例处理。
---
