---
id: task-05
title: 删除 browse-folder 端点 + 内联 schema
wave: W2
depends_on: []
allowed_paths:
  - backend/app/modules/daemon/router.py
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  删除 backend browse_folder 端点及内联 schema 类。FR-5 / D-006。
implementation: |
  - router.py 删 browse_folder 端点(:1411) + BrowseFolderResponse(:1398) + BrowseFolderRequest(:1404)。
  - 与 task-04 同文件，执行时合并编辑。
acceptance: |
  - POST /browse-folder 返 404；BrowseFolder 类已删；ruff+mypy 过。
verify: |
  - cd backend && pytest
  - cd backend && ruff check . && mypy app
constraints: |
  - 未上线无需兼容；依据 design §6。
---

# task-05 · 删除 browse-folder 端点 + 内联 schema

> Wave W2 · backend · FR-5 / D-006 · design §6

## 验收标准
- [ ] `POST /runtimes/{id}/browse-folder` 返 404
- [ ] `BrowseFolderRequest` / `BrowseFolderResponse` 已删除
- [ ] `ruff check . && mypy app` 通过（无悬空引用）

## TDD/验证步骤
- 测试：端点 404 / 类不可 import
- `cd backend && pytest`
