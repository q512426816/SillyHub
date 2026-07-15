---
id: task-02
title: "auth/schema.py 新增 ChangePasswordRequest 并 __all__ 导出"
title_zh: 新增修改密码请求体 schema
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: []
blocks: [task-04, task-06]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/auth/schema.py
provides:
  - contract: ChangePasswordRequest
    fields: [old_password, new_password]
goal: >
  新增修改密码请求体 ChangePasswordRequest（old_password + new_password min8），
  供 router 校验输入，对齐项目既有密码字段 min_length=8 约束。
implementation:
  - 在 auth/schema.py 新增 ChangePasswordRequest(BaseModel)，model_config 设 extra 为 forbid
  - 字段 old_password（str，必填非空）；new_password（str，Field 约束 min_length=8）
  - schema.py 当前无 __all__，类定义即导出（ConfigDict 已在文件顶部导入，无需新增 import）
acceptance:
  - ChangePasswordRequest 含 old_password(str，min_length=1) + new_password(str，min_length=8)
  - extra=forbid 拒绝多余字段（confirm_password 不收，返回 422）
verify:
  - cd backend && uv run ruff check app/modules/auth/schema.py
  - cd backend && uv run mypy app
constraints:
  - 不收 confirm_password（D-002 仅前端校验）
  - new_password 允许与 old_password 相同（D-003）
---

## 说明

schema.py 已 `from pydantic import BaseModel, ConfigDict, Field`，现有 DTO（如 UserRead）
即用 `model_config = ConfigDict(...)` 模式声明配置，照此给 ChangePasswordRequest 加
`extra="forbid"`。该文件无 `__all__`，类定义即对外可见，无需改导出区。
