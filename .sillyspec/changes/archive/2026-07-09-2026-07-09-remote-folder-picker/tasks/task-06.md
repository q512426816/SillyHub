---
id: task-06
title: list-roots 端点测试 + browse-folder 测试清理
wave: W2
depends_on:
  - task-04
  - task-05
allowed_paths:
  - backend/app/modules/daemon/tests/test_list_roots_endpoint.py
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  为 list-roots 端点写测试；清理既有 browse-folder 测试。FR-2 / FR-5。
implementation: |
  - 新增 test_list_roots_endpoint.py：owner 200 / 非 owner 404 / 离线 504 / forbidden 403。
  - 既有 browse 测试改 404 断言或移除。
acceptance: |
  - list-roots 四类用例过；无残留 browse 端点测试；pytest 过。
verify: |
  - cd backend && pytest
constraints: |
  - test_strategy=module。
---

# task-06 · list-roots 端点测试 + browse 测试清理

> Wave W2 · backend · FR-2 / FR-5

## 验收标准
- [ ] list-roots 四类用例（owner/non-owner/offline/forbidden）通过
- [ ] 无残留 browse-folder 端点测试（或仅 404 断言）
- [ ] `pytest` 通过

## TDD/验证步骤
- 照 list_dir 端点测试模式写四类用例
- `cd backend && pytest`
