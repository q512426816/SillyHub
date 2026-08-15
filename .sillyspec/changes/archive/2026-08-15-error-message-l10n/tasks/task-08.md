---
id: "task-08"
title: "llm_provider + tool/git 文案"
title_zh: "llm_provider + tool/git 文案"
status: "pending"
goal: "llm_provider 11+12+2 / tool_gateway 8 / git_gateway 10 / git_identity 5 共 48 处改中文。test_dangerous.py 45 处 + test_service.py 断言同步（最大工作量）。"
implementation: "逐文件扫描 → 改写 → 断言同步 → pytest app/modules/llm_provider app/modules/tool_gateway app/modules/git_gateway app/modules/git_identity → ruff → PENDING 划掉 6 文件。"
acceptance: [模块 pytest 全绿, ruff 过, PENDING 划除 6 文件]
verify: "ruff"
constraints: [文案范式：中文短语+行动指引，ID 移 details, code/http_status/契约零变更, 只改 allowed_paths 内文件]
allowed_paths: [backend/app/modules/llm_provider/service.py, backend/app/modules/llm_provider/usage_handlers.py, backend/app/modules/llm_provider/schema.py, backend/app/modules/tool_gateway/service.py, backend/app/modules/git_gateway/service.py, backend/app/modules/git_identity/service.py, backend/app/modules/git_gateway/tests/test_dangerous.py, backend/app/modules/git_gateway/tests/test_service.py]
---

# task-08 llm_provider + tool/git 文案

> llm_provider 11+12+2 / tool_gateway 8 / git_gateway 10 / git_identity 5 共 48 处改中文。test_dangerous.py 45 处 + test_service.py 断言同步（最大工作量）。

## 验收标准

- 模块 pytest 全绿
- ruff 过
- PENDING 划除 6 文件

## 验证

逐文件扫描 → 改写 → 断言同步 → pytest app/modules/llm_provider app/modules/tool_gateway app/modules/git_gateway app/modules/git_identity → ruff → PENDING 划掉 6 文件。
