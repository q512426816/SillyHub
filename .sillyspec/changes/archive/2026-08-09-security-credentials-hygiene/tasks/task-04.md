---
id: task-04
title: 新增 bootstrap 弱口令校验单测
title_zh: 弱口令 validator 单元测试
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P0
depends_on: [task-03]
blocks: [task-07]
requirement_ids: [FR-05]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/tests/modules/auth/test_bootstrap_password_strength.py
goal: >
  为 task-03 的弱口令 field_validator 补单测，钉死 fail-fast 行为与边界。
implementation:
  - 新建 test 文件 用 pydantic ValidationError 断言
  - 弱口令表逐项参数化构造 Settings 断言抛 ValidationError
  - 与 email 本地部分相同的口令断言抛 ValidationError
  - 强口令（如 Xx1!abcd Admin123!@#）断言正常构造不抛
  - password 为 None（未配 bootstrap）断言放行不抛（D-004）
acceptance:
  - 表内每项弱口令都断言被拒
  - email 同名被拒 强口令通过 None 放行 三类用例齐全
  - 与现有 auth 测试互不干扰
verify:
  - cd backend && uv run pytest tests/modules/auth/test_bootstrap_password_strength.py -q
  - cd backend && uv run ruff check tests/modules/auth/test_bootstrap_password_strength.py
constraints:
  - 测试构造 Settings 时用强口令 不用表内弱口令造正常用例
  - 不改 task-03 的 config.py（本 task 只加测试）
  - 不依赖真实 DB（纯 Settings 实例化校验）
related_tests: []
---

# task-04 弱口令单测

详见 frontmatter。对照 plan AC-01。
