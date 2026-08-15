---
id: "task-03"
title: "admin 三模块文案"
title_zh: "admin 三模块文案"
status: "pending"
goal: "users 6（含 :336 dict detail 预存缺陷改 AppError 形态）、organizations 11、roles 10 共 27 处改中文。grep tests/modules/admin 断言。"
implementation: "逐文件扫描 → 改写 → 断言同步 → pytest tests/modules/admin app/modules/admin → ruff → 从守护测试 PENDING 划掉 3 文件。"
acceptance: [模块 pytest 全绿, ruff 过, PENDING 划除 3 文件]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/admin/users_service.py, backend/app/modules/admin/organizations_service.py, backend/app/modules/admin/roles_service.py]
---

# task-03 admin 三模块文案

> users 6（含 :336 dict detail 预存缺陷改 AppError 形态）、organizations 11、roles 10 共 27 处改中文。grep tests/modules/admin 断言。

## 验收标准

- 模块 pytest 全绿
- ruff 过
- PENDING 划除 3 文件

## 验证

逐文件扫描 → 改写 → 断言同步 → pytest tests/modules/admin app/modules/admin → ruff → 从守护测试 PENDING 划掉 3 文件。
