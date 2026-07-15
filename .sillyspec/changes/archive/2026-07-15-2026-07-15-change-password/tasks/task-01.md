---
id: task-01
title: "core/errors.py 新增 PasswordIncorrect(401) AppError 子类并导出"
title_zh: 新增旧密码错误类 PasswordIncorrect
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/core/errors.py
provides:
  - contract: PasswordIncorrect
    fields: [code, http_status]
goal: >
  新增旧密码校验失败的领域错误类 PasswordIncorrect（401），供 change_password 抛出，
  对齐既有 AppError 子类的「类属性 code+http_status」模式。
implementation:
  - 在 backend/app/core/errors.py 的「Auth errors」分区（与 AuthInvalidCredentials 等同区）仿照既有子类新增 PasswordIncorrect(AppError)
  - 设 code = "HTTP_401_PASSWORD_INCORRECT"，http_status = status.HTTP_401_UNAUTHORIZED
  - errors.py 无 __all__，类定义即导出，无需改导出区
acceptance:
  - PasswordIncorrect 继承 AppError，code=HTTP_401_PASSWORD_INCORRECT，http_status=401
  - 全局异常处理器 register_exception_handlers 中已有的 @app.exception_handler(AppError) 会将其自动转为 401 JSON envelope，无需新增处理逻辑
verify:
  - cd backend && uv run ruff check app/core/errors.py
  - cd backend && uv run mypy app
constraints:
  - 仅新增错误类，不改既有错误类
  - 不在本 task 写测试（测试在 task-05）
---

## 说明

errors.py 既有的 AppError 子类统一用类属性 `code`（大写 `HTTP_<status>_<NAME>` 形式）+
`http_status = status.HTTP_xxx_<REASON>` 声明，无需写 `__init__`。新增 PasswordIncorrect
照此模式，放在 Auth errors 分区即可。模块无 `__all__`，类一经定义即对外可见。
