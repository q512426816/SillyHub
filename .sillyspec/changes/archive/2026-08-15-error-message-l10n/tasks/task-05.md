---
id: "task-05"
title: "change 链路文案"
title_zh: "change 链路文案"
status: "pending"
goal: "change 6+2+2+1 / change_writer 10+4 / task 1 / scan_docs 1 / workflow 2+1 / knowledge 2 共 31 处改中文。test_dispatch.py 5 处英文断言同步。"
implementation: "逐文件扫描 → 改写 → 断言同步 → pytest app/modules/change app/modules/change_writer app/modules/task app/modules/workflow app/modules/knowledge tests/modules/change → ruff → PENDING 划掉 11 文件。"
acceptance: [模块 pytest 全绿, ruff 过, PENDING 划除 11 文件]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/change/service.py, backend/app/modules/change/dispatch.py, backend/app/modules/change/router.py, backend/app/modules/change/schema.py, backend/app/modules/change_writer/service.py, backend/app/modules/change_writer/proxy.py, backend/app/modules/task/service.py, backend/app/modules/scan_docs/service.py, backend/app/modules/workflow/service.py, backend/app/modules/workflow/fsm.py, backend/app/modules/knowledge/service.py, backend/tests/modules/change/test_dispatch.py]
---

# task-05 change 链路文案

> change 6+2+2+1 / change_writer 10+4 / task 1 / scan_docs 1 / workflow 2+1 / knowledge 2 共 31 处改中文。test_dispatch.py 5 处英文断言同步。

## 验收标准

- 模块 pytest 全绿
- ruff 过
- PENDING 划除 11 文件

## 验证

逐文件扫描 → 改写 → 断言同步 → pytest app/modules/change app/modules/change_writer app/modules/task app/modules/workflow app/modules/knowledge tests/modules/change → ruff → PENDING 划掉 11 文件。
