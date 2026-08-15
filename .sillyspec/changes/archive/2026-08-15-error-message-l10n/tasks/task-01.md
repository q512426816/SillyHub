---
id: "task-01"
title: "全局兜底与 auth 链路文案"
title_zh: "全局兜底与 auth 链路文案"
status: "pending"
goal: "把 main.py Run not found ×6、errors.py 4 类默认 message+2 条 handler 兜底、auth_deps 7、security.py AccessTokenError 4、auth service 6+router 1 共约 26 处英文报错改中文短语+行动指引，ID 移 details，契约不变。改前 grep tests/modules/auth 断言。"
implementation: "逐文件扫描英文 raise → 对照上下文改写 → grep 断言同步 → pytest tests/modules/auth tests/core → ruff。"
acceptance: [模块 pytest 全绿, ruff check+format 过, code/http_status 无变化]
verify: "pytest tests/modules/auth tests/core"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/main.py, backend/app/core/errors.py, backend/app/core/auth_deps.py, backend/app/core/security.py, backend/app/modules/auth/service.py, backend/app/modules/auth/router.py]
---

# task-01 全局兜底与 auth 链路文案

> 把 main.py Run not found ×6、errors.py 4 类默认 message+2 条 handler 兜底、auth_deps 7、security.py AccessTokenError 4、auth service 6+router 1 共约 26 处英文报错改中文短语+行动指引，ID 移 details，契约不变。改前 grep tests/modules/auth 断言。

## 验收标准

- 模块 pytest 全绿
- ruff check+format 过
- code/http_status 无变化

## 验证

逐文件扫描英文 raise → 对照上下文改写 → grep 断言同步 → pytest tests/modules/auth tests/core → ruff。
