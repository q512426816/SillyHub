---
id: task-11
title: profile router regression tests
title_zh: profile router 回归测试
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P1
depends_on: [task-03]
blocks: []
allowed_paths:
  - backend/app/modules/agent/tests/test_profile_router.py
goal: >
  profile router 改 DTO 后 test_router 补 llm_provider_id 断言，确保回归绿。
implementation:
  - Create 用例补 llm_provider_id 传入与返回断言
  - Update 用例补显式 null 解绑断言
  - Read 用例补字段返回断言
acceptance:
  - test_router 全绿
verify:
  - cd backend && pytest app/modules/agent/tests/test_profile_router.py -n auto
constraints:
  - CONVENTIONS 改 router 必跑 test_router
  - 用 backend/.venv/Scripts/python.exe
---
