---
id: task-04
title: backend list-roots 端点 + ListRootsResponse schema
wave: W2
depends_on:
  - task-02
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  新增 POST /list-roots 端点（转发 list_roots RPC）+ ListRootsResponse schema。FR-2 / D-002 / D-007。
implementation: |
  - router.py 照抄 list_dir:1325：get_current_principal + _get_owned_runtime ownership + send_rpc("list_roots",{}) + 错误映射。
  - schema.py 新增 ListRootsResponse { roots: list[str] }（紧邻 ListDirResponse:452）。
acceptance: |
  - owner 200+roots；非 owner 404；离线 504；ruff+mypy+pytest 过。
verify: |
  - cd backend && pytest
  - cd backend && ruff check . && mypy app
constraints: |
  - 读=owner（非 admin）；依据 design §7.2。
---

# task-04 · backend list-roots 端点 + schema

> Wave W2 · backend · FR-2 / D-002 / D-007 · design §7.2
> 注：allowed_paths 与 task-05 共享 router.py（有意：同文件先增后删）。

## 验收标准
- [ ] owner 调用返 200 + `{roots}`
- [ ] 非 owner 返 404
- [ ] daemon 离线返 504
- [ ] `ruff check . && mypy app` + `pytest` 通过

## TDD/验证步骤
- 先写端点测试（task-06）：owner/non-owner/offline/forbidden
- `cd backend && pytest`
