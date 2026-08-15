---
id: "task-04"
title: "workspace 全家文案"
title_zh: "workspace 全家文案"
status: "pending"
goal: "service 12 / members 12 / link 3+1 / schema 2 / member_runtimes 1 共 31 处改中文。grep 双侧 tests。"
implementation: "逐文件扫描 → 改写 → 断言同步 → pytest app/modules/workspace tests/modules/workspace → ruff → PENDING 划掉 6 文件。"
acceptance: [模块 pytest 全绿, ruff 过, PENDING 划除 6 文件]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/workspace/service.py, backend/app/modules/workspace/members_service.py, backend/app/modules/workspace/link_service.py, backend/app/modules/workspace/link_router.py, backend/app/modules/workspace/schema.py, backend/app/modules/workspace/member_runtimes/service.py]
---

# task-04 workspace 全家文案

> service 12 / members 12 / link 3+1 / schema 2 / member_runtimes 1 共 31 处改中文。grep 双侧 tests。

## 验收标准

- 模块 pytest 全绿
- ruff 过
- PENDING 划除 6 文件

## 验证

逐文件扫描 → 改写 → 断言同步 → pytest app/modules/workspace tests/modules/workspace → ruff → PENDING 划掉 6 文件。
